from __future__ import annotations

from datetime import UTC, datetime, timedelta

from vision_edge.ai import Detection, SafetyPolicy, SafetyRuleEngine


def test_ppe_event_requires_sustained_person_detection() -> None:
    engine = SafetyRuleEngine(
        "gw-1",
        "tenant-1",
        "site-1",
        SafetyPolicy(min_confidence=0.7, sustained_seconds=4, cooldown_seconds=60),
    )
    base = datetime(2026, 8, 19, tzinfo=UTC)
    initial = [
        Detection("person", 0.9, "worker-1", (0.1, 0.1, 0.2, 0.4), base),
        Detection("vest", 0.9, "worker-1", (0.1, 0.1, 0.2, 0.4), base),
    ]
    assert engine.process("camera-1", initial) == []

    sustained = [
        Detection("person", 0.9, "worker-1", (0.1, 0.1, 0.2, 0.4), base + timedelta(seconds=5)),
        Detection("vest", 0.9, "worker-1", (0.1, 0.1, 0.2, 0.4), base + timedelta(seconds=5)),
    ]
    events = engine.process("camera-1", sustained)

    assert len(events) == 1
    assert events[0].rule_outcome == "ppe_missing"
    assert events[0].attributes["missing_ppe"] == ["helmet"]
    assert events[0].requires_human_review is True


def test_harness_signal_is_explicitly_review_only() -> None:
    engine = SafetyRuleEngine(
        "gw-1",
        "tenant-1",
        "site-1",
        SafetyPolicy(min_confidence=0.7, sustained_seconds=0, cooldown_seconds=60),
    )
    events = engine.process(
        "camera-1",
        [
            Detection("person", 0.95, "worker-1", (0.1, 0.1, 0.2, 0.4)),
            Detection("helmet", 0.95, "worker-1", (0.1, 0.1, 0.2, 0.4)),
            Detection("vest", 0.95, "worker-1", (0.1, 0.1, 0.2, 0.4)),
            Detection("harness_uncertain", 0.8, "worker-1", (0.1, 0.1, 0.2, 0.4)),
        ],
    )
    assert len(events) == 1
    assert events[0].rule_outcome == "harness_review_required"
    assert events[0].severity.value == "medium"
    assert events[0].attributes["classification"] == "review_only"
