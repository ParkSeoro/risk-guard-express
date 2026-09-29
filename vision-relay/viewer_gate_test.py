#!/usr/bin/env python3
import unittest

import viewer_gate


class ViewerGateTest(unittest.TestCase):
    def setUp(self) -> None:
        with viewer_gate._lock:
            viewer_gate._last_read.clear()

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
        self.assertTrue(viewer_gate.publish_allowed(path, now=119))
        self.assertFalse(viewer_gate.publish_allowed(path, now=121))

    def test_read_is_always_allowed(self) -> None:
        self.assertTrue(viewer_gate.decide("read", "live/abc"))
        self.assertTrue(viewer_gate.decide("publish", "live/abc"))

    def test_empty_publish_is_refused(self) -> None:
        self.assertFalse(viewer_gate.decide("publish", ""))


if __name__ == "__main__":
    unittest.main()
