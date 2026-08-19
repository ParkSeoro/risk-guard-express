"""Vision Edge Gateway 공통 도메인 모델.

본 모듈은 Master와 Gateway 사이의 API 계약을 로컬 런타임에서 검증할 수 있는
명시적 타입으로 표현한다. NVR 비밀값과 원본 영상은 도메인 이벤트에 포함하지 않는다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


class RuntimeStatus(StrEnum):
    ONLINE = "online"
    DEGRADED = "degraded"
    OFFLINE_DEPENDENCY = "offline_dependency"
    MAINTENANCE = "maintenance"


class Severity(StrEnum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class RiskLevel(StrEnum):
    GREEN = "green"
    YELLOW = "yellow"
    RED = "red"


class CommandStatus(StrEnum):
    RECEIVED = "received"
    REJECTED = "rejected"
    ACCEPTED = "accepted"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


class GatewayIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gateway_id: str = Field(min_length=3, max_length=128)
    tenant_id: str = Field(min_length=3, max_length=128)
    site_id: str = Field(min_length=3, max_length=128)
    fleet_base_url: HttpUrl | None = None


class CameraConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    camera_id: str = Field(min_length=3, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    nvr_id: str = Field(min_length=3, max_length=128)
    stream_url_secret_ref: str = Field(min_length=1, max_length=255)
    enabled: bool = True
    expected_fps: float = Field(default=10.0, ge=0.1, le=120.0)
    ai_profile: str = Field(default="ppe-standard-kr-v1", min_length=3, max_length=128)


class NvrConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nvr_id: str = Field(min_length=3, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    vendor: str = Field(default="generic-onvif", min_length=1, max_length=128)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=554, ge=1, le=65535)
    read_only: bool = True


class LocalConfig(BaseModel):
    """비밀을 제외한 Gateway 런타임 구성."""

    model_config = ConfigDict(extra="forbid")

    identity: GatewayIdentity
    listen_host: str = "127.0.0.1"
    listen_port: int = Field(default=8787, ge=1, le=65535)
    state_dir: str = "./data"
    certificate_path: str | None = None
    private_key_path: str | None = None
    ca_bundle_path: str | None = None
    fleet_token_url: HttpUrl | None = None
    fleet_client_id: str | None = Field(default=None, min_length=3, max_length=255)
    master_public_key_path: str | None = None
    heartbeat_interval_seconds: int = Field(default=30, ge=5, le=3600)
    event_flush_interval_seconds: int = Field(default=10, ge=2, le=3600)
    ffprobe_timeout_seconds: int = Field(default=8, ge=1, le=120)
    allow_local_key_generation: bool = False
    cameras: list[CameraConfig] = Field(default_factory=list)
    nvrs: list[NvrConfig] = Field(default_factory=list)


class RuntimeMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cpu_percent: float = Field(ge=0.0, le=100.0)
    disk_free_bytes: int = Field(ge=0)
    event_spool_depth: int = Field(ge=0)
    uptime_seconds: int = Field(ge=0)
    time_synchronized: bool


class CameraHealth(BaseModel):
    model_config = ConfigDict(extra="forbid")

    camera_id: str
    state: Literal["online", "offline", "degraded", "unknown"]
    last_frame_at: datetime | None = None
    observed_fps: float | None = Field(default=None, ge=0.0)
    detail: str | None = Field(default=None, max_length=500)


class HeartbeatPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gateway_id: str
    observed_at: datetime
    sequence: int = Field(ge=0)
    connection_state: RuntimeStatus
    runtime: RuntimeMetrics
    camera_health: list[CameraHealth]
    applied_state: dict[str, str | int | None]


class EvidenceReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["snapshot", "clip", "none"] = "none"
    object_ref: str | None = Field(default=None, max_length=512)
    retention_class: str | None = Field(default=None, max_length=64)


class SafetyEvent(BaseModel):
    """중앙으로 전송 가능한 AI/장비 이벤트. 비밀·RTSP URL은 포함하지 않는다."""

    model_config = ConfigDict(extra="forbid")

    event_id: UUID = Field(default_factory=uuid4)
    event_type: str = Field(min_length=3, max_length=128)
    severity: Severity
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    gateway_id: str
    tenant_id: str
    site_id: str
    camera_id: str | None = None
    policy_version: str | None = None
    model_version: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    rule_outcome: str = Field(default="observed", max_length=128)
    requires_human_review: bool = True
    trace_id: UUID = Field(default_factory=uuid4)
    evidence: EvidenceReference = Field(default_factory=EvidenceReference)
    attributes: dict[str, Any] = Field(default_factory=dict)

    @field_validator("attributes")
    @classmethod
    def prevent_secret_like_keys(cls, value: dict[str, Any]) -> dict[str, Any]:
        forbidden = {"password", "secret", "token", "rtsp_url", "private_key"}
        if any(key.lower() in forbidden for key in value):
            raise ValueError("event attributes must not contain secrets or stream URLs")
        return value


class DesiredState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=1)
    issued_at: datetime
    expires_at: datetime
    policy_bundle_id: str
    policy_digest: str
    model_bundle_id: str | None = None
    model_digest: str | None = None
    rollout_stage: Literal["canary", "pilot", "regional", "nationwide"]
    allow_activation: bool = False
    signature: str = Field(min_length=1)
    key_id: str = Field(min_length=1)


class GatewayCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    command_type: Literal[
        "diagnostic.collect",
        "camera.test_connection",
        "policy.apply",
        "runtime.restart",
        "model.stage",
        "model.activate",
        "alarm.test",
    ]
    target_tenant_id: str
    target_site_id: str
    target_gateway_id: str
    risk_level: RiskLevel
    issued_at: datetime
    expires_at: datetime
    idempotency_key: UUID
    payload_digest: str = Field(min_length=16, max_length=128)
    payload: dict[str, Any] = Field(default_factory=dict)
    approval_refs: list[str] = Field(default_factory=list)
    signature: str = Field(min_length=1)
    key_id: str = Field(min_length=1)


class CommandAck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    status: CommandStatus
    observed_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    detail: str | None = Field(default=None, max_length=500)
    before_state_version: int | None = None
    after_state_version: int | None = None
    error_code: str | None = None
    trace_id: UUID = Field(default_factory=uuid4)
