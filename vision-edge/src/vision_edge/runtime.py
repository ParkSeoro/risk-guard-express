"""Vision Edge의 장기 실행 runtime orchestration."""

from __future__ import annotations

import asyncio
import os
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .ai import SafetyPolicy, SafetyRuleEngine
from .fleet_client import FleetApiError, FleetClient
from .models import (
    CameraHealth,
    CommandAck,
    CommandStatus,
    DesiredState,
    GatewayCommand,
    HeartbeatPayload,
    RuntimeMetrics,
    RuntimeStatus,
    SafetyEvent,
    Severity,
)
from .nvr import CameraMonitor
from .secret_store import SecretStore
from .security import MasterCommandVerifier, VerificationError
from .storage import EdgeStore


class EdgeRuntime:
    def __init__(
        self,
        *,
        config: Any,
        store: EdgeStore,
        secret_store: SecretStore,
        camera_monitor: CameraMonitor,
        fleet_client: FleetClient,
        verifier: MasterCommandVerifier,
    ) -> None:
        self.config = config
        self.store = store
        self.secret_store = secret_store
        self.camera_monitor = camera_monitor
        self.fleet_client = fleet_client
        self.verifier = verifier
        self.started_monotonic = time.monotonic()
        self._camera_health: list[CameraHealth] = []
        self._last_fleet_error: str | None = None
        self._ai = SafetyRuleEngine(
            config.identity.gateway_id,
            config.identity.tenant_id,
            config.identity.site_id,
            SafetyPolicy(),
        )
        self._stop_event = asyncio.Event()

    async def reconfigure_fleet(self) -> None:
        """페어링 완료 후 mTLS Fleet client와 서명 검증기를 원자적으로 교체한다."""
        previous_client = self.fleet_client
        self.fleet_client = FleetClient(
            base_url=str(self.config.identity.fleet_base_url) if self.config.identity.fleet_base_url else None,
            gateway_id=self.config.identity.gateway_id,
            certificate_path=self.config.certificate_path,
            private_key_path=self.config.private_key_path,
            ca_bundle_path=self.config.ca_bundle_path,
            token_url=str(self.config.fleet_token_url) if self.config.fleet_token_url else None,
            client_id=self.config.fleet_client_id,
        )
        self.verifier = MasterCommandVerifier(
            self.config.identity,
            Path(self.config.master_public_key_path).expanduser() if self.config.master_public_key_path else None,
        )
        self._ai = SafetyRuleEngine(
            self.config.identity.gateway_id,
            self.config.identity.tenant_id,
            self.config.identity.site_id,
            SafetyPolicy(),
        )
        self._last_fleet_error = None
        await previous_client.close()

    @property
    def last_fleet_error(self) -> str | None:
        return self._last_fleet_error

    @property
    def ai_engine(self) -> SafetyRuleEngine:
        return self._ai

    async def refresh_camera_health(self) -> list[CameraHealth]:
        self._camera_health = await self.camera_monitor.health_all(self.config.cameras)
        for health in self._camera_health:
            if health.state in {"offline", "degraded"}:
                self.enqueue_event(
                    SafetyEvent(
                        event_type="camera.health_changed",
                        severity=self._health_severity(health.state),
                        gateway_id=self.config.identity.gateway_id,
                        tenant_id=self.config.identity.tenant_id,
                        site_id=self.config.identity.site_id,
                        camera_id=health.camera_id,
                        rule_outcome=health.state,
                        requires_human_review=False,
                        attributes={"detail": health.detail or ""},
                    )
                )
        return self._camera_health

    @staticmethod
    def _health_severity(state: str) -> Severity:
        return Severity.HIGH if state == "offline" else Severity.MEDIUM

    def heartbeat_payload(self) -> HeartbeatPayload:
        state_dir = Path(self.config.state_dir)
        disk = shutil.disk_usage(state_dir)
        load = os.getloadavg()[0] if hasattr(os, "getloadavg") else 0.0
        cpu_count = max(os.cpu_count() or 1, 1)
        approximate_cpu = min(100.0, round((load / cpu_count) * 100.0, 2))
        status = RuntimeStatus.ONLINE
        if any(item.state == "offline" for item in self._camera_health):
            status = RuntimeStatus.DEGRADED
        return HeartbeatPayload(
            gateway_id=self.config.identity.gateway_id,
            observed_at=datetime.now(UTC),
            sequence=self.store.next_heartbeat_sequence(),
            connection_state=status,
            runtime=RuntimeMetrics(
                cpu_percent=approximate_cpu,
                disk_free_bytes=disk.free,
                event_spool_depth=self.store.event_spool_depth(),
                uptime_seconds=int(time.monotonic() - self.started_monotonic),
                time_synchronized=True,
            ),
            camera_health=self._camera_health,
            applied_state={
                "policy_version": self.store.get_runtime_value("policy_version"),
                "model_version": self.store.get_runtime_value("model_version"),
                "gateway_release": "0.1.0",
            },
        )

    def enqueue_event(self, event: SafetyEvent) -> bool:
        return self.store.enqueue_event(event)

    async def send_heartbeat(self) -> None:
        if not self.fleet_client.configured:
            return
        try:
            await self.fleet_client.send_heartbeat(self.heartbeat_payload())
            self._last_fleet_error = None
        except FleetApiError as exc:
            self._last_fleet_error = str(exc)

    async def flush_events(self) -> int:
        events = self.store.pending_events()
        if not events or not self.fleet_client.configured:
            return 0
        self.store.mark_event_attempt([str(event.event_id) for event in events])
        try:
            accepted = await self.fleet_client.send_events(events)
            self.store.mark_events_accepted(accepted)
            self._last_fleet_error = None
            return len(accepted)
        except FleetApiError as exc:
            self._last_fleet_error = str(exc)
            return 0

    async def sync_desired_state(self) -> bool:
        if not self.fleet_client.configured:
            return False
        current_version = self.store.get_runtime_value("desired_state_version")
        try:
            document = await self.fleet_client.fetch_desired_state(current_version)
        except FleetApiError as exc:
            self._last_fleet_error = str(exc)
            return False
        if not document:
            return False
        try:
            desired = DesiredState.model_validate(document)
            signature_payload = desired.model_dump(mode="json", exclude={"signature"})
            self.verifier.verify_desired_state_signature(signature_payload, desired.signature)
            if desired.expires_at <= datetime.now(UTC):
                raise VerificationError("desired state is expired")
            if not desired.allow_activation:
                raise VerificationError("desired state activation is not permitted by rollout stage")
            previous_version = self.store.get_runtime_value("desired_state_version")
            self.store.set_runtime_value("desired_state_version", desired.version)
            self.store.set_runtime_value("policy_version", desired.policy_bundle_id)
            self.store.set_runtime_value("model_version", desired.model_bundle_id)
            self._ai.update_policy(
                SafetyPolicy(policy_id=desired.policy_bundle_id, model_version=desired.model_bundle_id or "unconfigured")
            )
            self.enqueue_event(
                SafetyEvent(
                    event_type="config.apply_result",
                    severity=self._health_severity("online"),
                    gateway_id=self.config.identity.gateway_id,
                    tenant_id=self.config.identity.tenant_id,
                    site_id=self.config.identity.site_id,
                    policy_version=desired.policy_bundle_id,
                    model_version=desired.model_bundle_id,
                    rule_outcome="applied",
                    requires_human_review=False,
                    attributes={"before_version": previous_version, "after_version": desired.version},
                )
            )
            return True
        except (VerificationError, ValueError) as exc:
            self.enqueue_event(
                SafetyEvent(
                    event_type="config.apply_result",
                    severity=self._health_severity("degraded"),
                    gateway_id=self.config.identity.gateway_id,
                    tenant_id=self.config.identity.tenant_id,
                    site_id=self.config.identity.site_id,
                    rule_outcome="rejected",
                    requires_human_review=True,
                    attributes={"reason": str(exc)[:240]},
                )
            )
            return False

    async def process_command(self, command: GatewayCommand) -> CommandAck:
        command_id = str(command.command_id)
        if self.store.command_idempotency_conflict(str(command.idempotency_key), command.payload_digest):
            return CommandAck(
                command_id=command.command_id,
                status=CommandStatus.REJECTED,
                detail="idempotency key is bound to a different payload",
                error_code="IDEMPOTENCY_CONFLICT",
            )
        prior_status = self.store.get_command_status(command_id)
        if prior_status is not None:
            return CommandAck(command_id=command.command_id, status=prior_status, detail="duplicate command ignored")

        try:
            self.verifier.verify(command)
        except VerificationError as exc:
            acknowledgement = CommandAck(
                command_id=command.command_id,
                status=CommandStatus.REJECTED,
                detail=str(exc),
                error_code="COMMAND_VERIFICATION_FAILED",
            )
            self.store.write_command_ack(acknowledgement, str(command.idempotency_key), command.payload_digest)
            return acknowledgement

        received = CommandAck(command_id=command.command_id, status=CommandStatus.RECEIVED)
        self.store.write_command_ack(received, str(command.idempotency_key), command.payload_digest)
        result = await self._execute_verified_command(command)
        self.store.write_command_ack(result, str(command.idempotency_key), command.payload_digest)
        return result

    async def _execute_verified_command(self, command: GatewayCommand) -> CommandAck:
        before_version = self.store.get_runtime_value("desired_state_version")
        if command.command_type == "diagnostic.collect":
            await self.refresh_camera_health()
            return CommandAck(
                command_id=command.command_id,
                status=CommandStatus.SUCCEEDED,
                detail="safe diagnostic collection completed; bundle upload requires a separate approved URL",
                before_state_version=before_version,
                after_state_version=before_version,
            )
        if command.command_type == "camera.test_connection":
            camera_id = str(command.payload.get("camera_id", ""))
            camera = next((item for item in self.config.cameras if item.camera_id == camera_id), None)
            if not camera:
                return CommandAck(
                    command_id=command.command_id,
                    status=CommandStatus.FAILED,
                    detail="camera is not registered locally",
                    error_code="CAMERA_NOT_FOUND",
                )
            health = await self.camera_monitor.health(camera)
            return CommandAck(
                command_id=command.command_id,
                status=CommandStatus.SUCCEEDED if health.state == "online" else CommandStatus.FAILED,
                detail=f"camera state: {health.state}",
                error_code=None if health.state == "online" else "CAMERA_UNAVAILABLE",
            )

        # Actual process restart, model artifact activation and PA/siren integration are intentionally
        # fail-closed until their local adapter, health gate and site interlock are configured.
        return CommandAck(
            command_id=command.command_id,
            status=CommandStatus.REJECTED,
            detail="command type is signed and allowlisted but the local safety adapter is not configured",
            error_code="LOCAL_ADAPTER_NOT_CONFIGURED",
            before_state_version=before_version,
            after_state_version=before_version,
        )

    async def background_loop(self) -> None:
        heartbeat_due = 0.0
        flush_due = 0.0
        refresh_due = 0.0
        while not self._stop_event.is_set():
            now = time.monotonic()
            if now >= refresh_due:
                await self.refresh_camera_health()
                refresh_due = now + self.config.heartbeat_interval_seconds
            if now >= heartbeat_due:
                await self.send_heartbeat()
                heartbeat_due = now + self.config.heartbeat_interval_seconds
            if now >= flush_due:
                await self.flush_events()
                await self.sync_desired_state()
                flush_due = now + self.config.event_flush_interval_seconds
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=1.0)
            except TimeoutError:
                pass

    def stop(self) -> None:
        self._stop_event.set()

    def status(self) -> dict[str, Any]:
        heartbeat = self.heartbeat_payload()
        return {
            "gateway_id": self.config.identity.gateway_id,
            "tenant_id": self.config.identity.tenant_id,
            "site_id": self.config.identity.site_id,
            "connection_state": heartbeat.connection_state.value,
            "runtime": heartbeat.runtime.model_dump(),
            "camera_health": [item.model_dump(mode="json") for item in self._camera_health],
            "applied_state": heartbeat.applied_state,
            "fleet_configured": self.fleet_client.configured,
            "last_fleet_error": self._last_fleet_error,
            "secret_store": self.secret_store.health(),
        }
