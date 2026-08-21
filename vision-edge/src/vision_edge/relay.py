"""Outbound-only media relay stubs.

A full WebRTC/HLS SFU is a separate service and must not live in SafeNex `src/`.
Gateway announces a publish URL to Fleet after a signed stream grant exists.
"""

from __future__ import annotations


def stub_publish_url(grant_id: str) -> str:
    """Loopback placeholder. Browsers never receive RTSP from this helper."""
    safe = grant_id.replace("/", "")
    return f"https://127.0.0.1/vision-relay/outbound/{safe}"
