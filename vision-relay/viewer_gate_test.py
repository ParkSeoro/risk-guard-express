#!/usr/bin/env python3
import unittest

import viewer_gate


class ViewerGateTest(unittest.TestCase):
    def setUp(self) -> None:
        with viewer_gate._lock:
            viewer_gate._last_read.clear()
            viewer_gate._last_kick.clear()

    def test_playlist_and_publish_share_one_path(self) -> None:
        self.assertEqual(
            viewer_gate.canonical_path("/live/0edfed08baf964c1/index.m3u8"),
            "live/0edfed08baf964c1",
        )
        self.assertEqual(
            viewer_gate.canonical_path("live/0edfed08baf964c1"),
            "live/0edfed08baf964c1",
        )

    def test_publish_waits_for_a_viewer_and_expires(self) -> None:
        path = "live/0edfed08baf964c1"
        self.assertFalse(viewer_gate.publish_allowed(path, now=100))
        viewer_gate.note_read("/live/0edfed08baf964c1/index.m3u8", now=100)
        self.assertTrue(viewer_gate.publish_allowed(path, now=100 + viewer_gate.HOLD_S - 1))
        self.assertFalse(viewer_gate.publish_allowed(path, now=100 + viewer_gate.HOLD_S + 1))

    def test_read_is_always_allowed(self) -> None:
        self.assertTrue(viewer_gate.decide("read", "live/abc"))
        self.assertTrue(viewer_gate.decide("publish", "live/abc"))

    def test_empty_publish_is_refused(self) -> None:
        self.assertFalse(viewer_gate.decide("publish", ""))

    def test_open_reader_keeps_the_upload(self) -> None:
        path = "live/0edfed08baf964c1"
        self.assertFalse(viewer_gate.publish_allowed(path))
        viewer_gate.note_readers([{"name": path, "readers": []}])
        self.assertFalse(viewer_gate.publish_allowed(path))
        viewer_gate.note_readers([{"name": path, "readers": [{"type": "hlsMuxer"}]}])
        self.assertTrue(viewer_gate.publish_allowed(path))

    def test_kick_only_old_publishers_without_a_viewer(self) -> None:
        from datetime import datetime, timedelta, timezone

        path = "live/0edfed08baf964c1"
        now = 1_000_000.0
        wall = datetime.now(timezone.utc)
        idle = {
            "id": "idle-1",
            "path": "",
            "state": "idle",
            "created": wall.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        }
        young = {
            "id": "young-1",
            "path": path,
            "state": "publish",
            "created": (wall - timedelta(seconds=2)).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        }
        reconnect = {
            "id": "reconnect-1",
            "path": path,
            "state": "publish",
            "created": (wall - timedelta(seconds=12)).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        }
        old = {
            "id": "old-1",
            "path": path,
            "state": "publish",
            "created": (wall - timedelta(seconds=60)).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        }
        self.assertFalse(viewer_gate.should_kick_conn(idle, now=now))
        self.assertFalse(viewer_gate.should_kick_conn(young, now=now))
        self.assertTrue(viewer_gate.should_kick_conn(reconnect, now=now))
        self.assertTrue(viewer_gate.should_kick_conn(old, now=now))
        viewer_gate.note_read(path, now=now)
        self.assertFalse(viewer_gate.should_kick_conn(old, now=now))
        self.assertFalse(viewer_gate.should_kick_conn(reconnect, now=now))

    def test_recent_kick_explains_a_missing_picture(self) -> None:
        path = "live/0edfed08baf964c1"
        self.assertIsNone(viewer_gate.status_path("/health"))
        self.assertEqual(viewer_gate.status_path(f"/{path}/viewer-status"), path)
        self.assertFalse(viewer_gate.recent_idle_kick(path, now=200))
        viewer_gate.note_kick(path, now=100)
        self.assertTrue(viewer_gate.recent_idle_kick(path, now=100 + viewer_gate.RECENT_KICK_S - 1))
        self.assertFalse(viewer_gate.recent_idle_kick(path, now=100 + viewer_gate.RECENT_KICK_S + 1))


if __name__ == "__main__":
    unittest.main()
