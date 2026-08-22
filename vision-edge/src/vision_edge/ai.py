"""지능형 CCTV의 모델 비종속 안전 규칙 엔진.

실제 모델 실행기는 검증된 ONNX/DeepStream adapter로 교체할 수 있도록 분리한다.
이 모듈은 단일 프레임의 탐지 결과를 바로 경보하지 않고, 객체 추적·신뢰도·지속시간·ROI·cooldown을
결합해 감사 가능한 안전 이벤트로 승격한다.
"""

from __future__ import annotations

import os
from collections import defaultdict, deque
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol

from .models import SafetyEvent, Severity


@dataclass(frozen=True)
class Detection:
    label: str
    confidence: float
    track_id: str
    bbox: tuple[float, float, float, float]
    observed_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass(frozen=True)
class SafetyPolicy:
    policy_id: str = "ppe-standard-kr-v1"
    model_version: str = "unconfigured"
    min_confidence: float = 0.72
    sustained_seconds: int = 4
    cooldown_seconds: int = 60
    required_ppe: frozenset[str] = frozenset({"helmet", "vest"})
    restricted_zone_enabled: bool = False
    harness_review_only: bool = True


class InferenceAdapter(Protocol):
    async def detect(self, frame: bytes) -> list[Detection]: ...


class DisabledInferenceAdapter:
    """모델 artifact가 없는 상태에서 안전하게 비활성인 기본 adapter."""

    async def detect(self, frame: bytes) -> list[Detection]:
        del frame
        return []


class OnnxInferenceAdapter:
    """Optional ONNX Runtime adapter. Missing/invalid artifacts yield no detections."""

    def __init__(self, model_path: str) -> None:
        self.model_path = model_path
        self._session: object | None = None
        try:
            import onnxruntime as ort  # type: ignore[import-not-found]

            self._session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        except Exception:
            self._session = None

    @property
    def ready(self) -> bool:
        return self._session is not None

    async def detect(self, frame: bytes) -> list[Detection]:
        # A measured FP/FN lab must map tensors to Detection labels before this emits.
        # Until then the adapter is a no-op even if a session loaded.
        del frame
        return []


def build_inference_adapter(model_path: str | None = None) -> InferenceAdapter:
    path = model_path or os.getenv("VISION_EDGE_ONNX_MODEL")
    if path and Path(path).is_file():
        return OnnxInferenceAdapter(path)
    return DisabledInferenceAdapter()


def high_severity_push_allowed(*, measured_fp_fn: bool, alarm_interlock_enabled: bool) -> bool:
    """High/critical vision push is allowed only after lab FP/FN and site interlock."""
    return bool(measured_fp_fn and alarm_interlock_enabled)


@dataclass
class ObservationWindow:
    first_seen: datetime
    last_seen: datetime
    labels: set[str] = field(default_factory=set)
    max_confidence: float = 0.0


class SafetyRuleEngine:
    def __init__(self, gateway_id: str, tenant_id: str, site_id: str, policy: SafetyPolicy) -> None:
        self._gateway_id = gateway_id
        self._tenant_id = tenant_id
        self._site_id = site_id
        self._policy = policy
        self._tracks: dict[str, ObservationWindow] = {}
        self._last_emitted: dict[tuple[str, str], datetime] = {}
        self._recent: deque[SafetyEvent] = deque(maxlen=500)

    @property
    def policy(self) -> SafetyPolicy:
        return self._policy

    def update_policy(self, policy: SafetyPolicy) -> None:
        self._policy = policy
        self._tracks.clear()

    def process(self, camera_id: str, detections: Iterable[Detection], in_restricted_zone: bool = False) -> list[SafetyEvent]:
        grouped: dict[str, list[Detection]] = defaultdict(list)
        for detection in detections:
            if detection.confidence >= self._policy.min_confidence:
                grouped[detection.track_id].append(detection)

        events: list[SafetyEvent] = []
        for track_id, items in grouped.items():
            timestamp = max(item.observed_at for item in items)
            labels = {item.label.lower() for item in items}
            confidence = max(item.confidence for item in items)
            window = self._tracks.get(track_id)
            if window is None or timestamp - window.last_seen > timedelta(seconds=self._policy.sustained_seconds * 2):
                window = ObservationWindow(first_seen=timestamp, last_seen=timestamp)
                self._tracks[track_id] = window
            window.last_seen = timestamp
            window.labels.update(labels)
            window.max_confidence = max(window.max_confidence, confidence)

            sustained = timestamp - window.first_seen >= timedelta(seconds=self._policy.sustained_seconds)
            if not sustained:
                continue
            if "person" not in window.labels:
                continue

            missing_ppe = self._policy.required_ppe - window.labels
            if missing_ppe:
                event = self._emit_if_allowed(
                    camera_id=camera_id,
                    track_id=track_id,
                    rule="ppe_missing",
                    severity=Severity.HIGH,
                    confidence=window.max_confidence,
                    attributes={"missing_ppe": sorted(missing_ppe), "track_id": track_id},
                    requires_human_review=True,
                )
                if event:
                    events.append(event)

            if self._policy.restricted_zone_enabled and in_restricted_zone:
                event = self._emit_if_allowed(
                    camera_id=camera_id,
                    track_id=track_id,
                    rule="restricted_zone_entry",
                    severity=Severity.HIGH,
                    confidence=window.max_confidence,
                    attributes={"track_id": track_id},
                    requires_human_review=True,
                )
                if event:
                    events.append(event)

            # Harness/lanyard recognition is deliberately treated as a review signal.
            # A general wide-angle CCTV image alone must not create a punitive "unhooked" verdict.
            if "harness_uncertain" in window.labels and self._policy.harness_review_only:
                event = self._emit_if_allowed(
                    camera_id=camera_id,
                    track_id=track_id,
                    rule="harness_review_required",
                    severity=Severity.MEDIUM,
                    confidence=window.max_confidence,
                    attributes={"track_id": track_id, "classification": "review_only"},
                    requires_human_review=True,
                )
                if event:
                    events.append(event)
        self._recent.extend(events)
        return events

    def _emit_if_allowed(
        self,
        *,
        camera_id: str,
        track_id: str,
        rule: str,
        severity: Severity,
        confidence: float,
        attributes: dict[str, object],
        requires_human_review: bool,
    ) -> SafetyEvent | None:
        now = datetime.now(UTC)
        key = (camera_id, f"{track_id}:{rule}")
        previous = self._last_emitted.get(key)
        if previous and now - previous < timedelta(seconds=self._policy.cooldown_seconds):
            return None
        self._last_emitted[key] = now
        return SafetyEvent(
            event_type="ai.safety_detected",
            severity=severity,
            gateway_id=self._gateway_id,
            tenant_id=self._tenant_id,
            site_id=self._site_id,
            camera_id=camera_id,
            policy_version=self._policy.policy_id,
            model_version=self._policy.model_version,
            confidence=confidence,
            rule_outcome=rule,
            requires_human_review=requires_human_review,
            attributes=attributes,
        )

    def recent_events(self) -> list[SafetyEvent]:
        return list(self._recent)
