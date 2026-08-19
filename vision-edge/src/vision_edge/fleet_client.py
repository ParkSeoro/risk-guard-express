"""SafeNex Vision Fleet control plane API client.

모든 호출은 Gateway가 생성한 outbound HTTPS 연결이며, Master가 현장 NVR에 직접
접속하는 경로를 만들지 않는다.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from .models import CommandAck, HeartbeatPayload, SafetyEvent


class FleetApiError(RuntimeError):
    def __init__(self, message: str, retryable: bool = True, status_code: int | None = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.status_code = status_code


@dataclass
class CachedToken:
    value: str
    expires_at: datetime

    @property
    def valid(self) -> bool:
        return datetime.now(UTC) < self.expires_at - timedelta(seconds=30)


class FleetClient:
    """Production-oriented REST client with mTLS and bounded timeouts.

    The current Master API is not deployed yet, so calls fail closed with actionable errors.
    Operators may use a short-lived ``VISION_EDGE_ACCESS_TOKEN`` only for integration testing;
    production must configure an mTLS client-credentials token endpoint.
    """

    def __init__(
        self,
        base_url: str | None,
        gateway_id: str,
        certificate_path: str | None,
        private_key_path: str | None,
        ca_bundle_path: str | None,
        token_url: str | None,
        client_id: str | None,
    ) -> None:
        self._base_url = base_url.rstrip("/") if base_url else None
        self._gateway_id = gateway_id
        self._token_url = token_url
        self._client_id = client_id
        self._cached_token: CachedToken | None = None
        self._lock = asyncio.Lock()
        cert: tuple[str, str] | None = None
        if certificate_path and private_key_path:
            cert = (certificate_path, private_key_path)
        verify: bool | str = ca_bundle_path if ca_bundle_path else True
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=8.0, read=20.0, write=20.0, pool=8.0),
            cert=cert,
            verify=verify,
            headers={"User-Agent": "SafeNex-Vision-Edge/0.1"},
        )

    @property
    def configured(self) -> bool:
        return self._base_url is not None

    async def close(self) -> None:
        await self._client.aclose()

    async def _access_token(self) -> str:
        static_token = os.getenv("VISION_EDGE_ACCESS_TOKEN")
        if static_token:
            return static_token
        if self._cached_token and self._cached_token.valid:
            return self._cached_token.value
        if not self._token_url or not self._client_id:
            raise FleetApiError(
                "Fleet mTLS token endpoint is not configured; set fleet_token_url and fleet_client_id",
                retryable=False,
            )
        async with self._lock:
            if self._cached_token and self._cached_token.valid:
                return self._cached_token.value
            try:
                response = await self._client.post(
                    self._token_url,
                    data={
                        "grant_type": "client_credentials",
                        "client_id": self._client_id,
                        "scope": "gateway.heartbeat gateway.events gateway.state:read gateway.commands:read gateway.commands:ack",
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
            except httpx.HTTPError as exc:
                raise FleetApiError(f"token request failed: {exc}") from exc
            if response.status_code >= 400:
                raise FleetApiError(
                    f"token request rejected: {response.status_code}",
                    retryable=response.status_code >= 500,
                    status_code=response.status_code,
                )
            payload = response.json()
            token = payload.get("access_token")
            expires_in = payload.get("expires_in", 300)
            if not isinstance(token, str) or not token:
                raise FleetApiError("token response did not contain access_token", retryable=False)
            if not isinstance(expires_in, int) or expires_in <= 0:
                raise FleetApiError("token response contains invalid expires_in", retryable=False)
            self._cached_token = CachedToken(
                value=token,
                expires_at=datetime.now(UTC) + timedelta(seconds=expires_in),
            )
            return token

    async def _request(self, method: str, path: str, *, json: dict[str, Any] | None = None) -> httpx.Response:
        if not self._base_url:
            raise FleetApiError("Fleet endpoint is not configured", retryable=True)
        token = await self._access_token()
        try:
            response = await self._client.request(
                method,
                f"{self._base_url}{path}",
                json=json,
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-Gateway-Id": self._gateway_id,
                    "X-Request-Id": _request_id(),
                },
            )
        except httpx.HTTPError as exc:
            raise FleetApiError(f"Fleet request failed: {exc}", retryable=True) from exc
        if response.status_code >= 400:
            retryable = response.status_code in {408, 429, 500, 502, 503, 504}
            raise FleetApiError(
                f"Fleet request rejected: {response.status_code} {response.text[:300]}",
                retryable=retryable,
                status_code=response.status_code,
            )
        return response

    async def send_heartbeat(self, payload: HeartbeatPayload) -> None:
        await self._request(
            "POST",
            f"/v1/gateways/{self._gateway_id}/heartbeats",
            json=payload.model_dump(mode="json"),
        )

    async def send_events(self, events: list[SafetyEvent]) -> list[str]:
        if not events:
            return []
        response = await self._request(
            "POST",
            f"/v1/gateways/{self._gateway_id}/events:batch",
            json={"events": [event.model_dump(mode="json") for event in events]},
        )
        try:
            data = response.json().get("data", {})
            accepted = data.get("accepted_event_ids")
            if isinstance(accepted, list) and all(isinstance(value, str) for value in accepted):
                return accepted
        except ValueError:
            pass
        # 202 with an empty body is still an accepted batch by contract.
        return [str(event.event_id) for event in events]

    async def fetch_desired_state(self, current_version: int | None) -> dict[str, Any] | None:
        suffix = "" if current_version is None else f"?current_version={current_version}"
        response = await self._request("GET", f"/v1/gateways/{self._gateway_id}/desired-state{suffix}")
        if response.status_code == 304:
            return None
        try:
            payload = response.json()
        except ValueError as exc:
            raise FleetApiError("desired state response is not JSON", retryable=True) from exc
        if not isinstance(payload, dict):
            raise FleetApiError("desired state response must be an object", retryable=True)
        document = payload.get("data", payload)
        if not isinstance(document, dict):
            raise FleetApiError("desired state data must be an object", retryable=True)
        return document

    async def send_command_ack(self, acknowledgement: CommandAck) -> None:
        await self._request(
            "POST",
            f"/v1/gateways/{self._gateway_id}/command-acks",
            json=acknowledgement.model_dump(mode="json"),
        )


def _request_id() -> str:
    # UUID4 is used only as a trace identifier; safety event IDs are domain identifiers in models.py.
    from uuid import uuid4

    return str(uuid4())
