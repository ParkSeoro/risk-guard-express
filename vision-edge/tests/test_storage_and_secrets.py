from __future__ import annotations

from pathlib import Path

from vision_edge.models import SafetyEvent, Severity
from vision_edge.secret_store import SecretStore
from vision_edge.storage import EdgeStore


def make_event() -> SafetyEvent:
    return SafetyEvent(
        event_type="ai.safety_detected",
        severity=Severity.HIGH,
        gateway_id="gw-1",
        tenant_id="tenant-1",
        site_id="site-1",
        camera_id="camera-1",
        rule_outcome="ppe_missing",
        attributes={"missing_ppe": ["helmet"]},
    )


def test_secret_store_encrypts_values_and_hides_plaintext(tmp_path: Path) -> None:
    store = SecretStore(tmp_path, allow_local_key_generation=True)
    store.put("camera-1-url", "rtsp://operator:password@10.10.0.10/stream")

    assert store.get("camera-1-url").startswith("rtsp://")
    encrypted = (tmp_path / "secrets" / "secrets.enc").read_text(encoding="utf-8")
    assert "password" not in encrypted
    assert "rtsp://" not in encrypted


def test_event_spool_is_idempotent_and_acknowledges_events(tmp_path: Path) -> None:
    database = EdgeStore(tmp_path / "edge.db")
    event = make_event()

    assert database.enqueue_event(event) is True
    assert database.enqueue_event(event) is False
    pending = database.pending_events()
    assert len(pending) == 1
    assert pending[0].event_id == event.event_id

    database.mark_event_attempt([str(event.event_id)])
    database.mark_events_accepted([str(event.event_id)])
    assert database.event_spool_depth() == 0
    database.close()
