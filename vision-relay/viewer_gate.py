#!/usr/bin/env python3
"""Allow a camera to publish only while a browser is reading that path.

MediaMTX asks this process on every publish and every read. A read means
the picture is open. An HLS session that is still reading also counts, even
when MediaMTX does not ask again for each segment. A publish is refused 45
seconds after the last read, and the open upload is kicked so the modem
stops sending video.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOLD_S = 45
API = os.environ.get("MTX_API", "http://mediamtx:9997").rstrip("/")
LISTEN = ("0.0.0.0", 9197)

_last_read: dict[str, float] = {}
_lock = threading.Lock()


def canonical_path(path: str) -> str:
    cleaned = (path or "").split("?", 1)[0].strip("/")
    parts = [part for part in cleaned.split("/") if part]
    if len(parts) >= 2 and parts[0] == "live":
        return f"live/{parts[1]}"
    return cleaned


def note_read(path: str, now: float | None = None) -> None:
    key = canonical_path(path)
    if not key:
        return
    with _lock:
        _last_read[key] = time.monotonic() if now is None else now


def publish_allowed(path: str, now: float | None = None, hold_s: float = HOLD_S) -> bool:
    key = canonical_path(path)
    if not key:
        return False
    moment = time.monotonic() if now is None else now
    with _lock:
        seen = _last_read.get(key)
    return seen is not None and (moment - seen) <= hold_s


def decide(action: str, path: str) -> bool:
    if action == "publish":
        return publish_allowed(path)
    if action in ("read", "playback"):
        note_read(path)
        return True
    return True


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != "/auth":
            self._reply(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            body = {}
        action = str(body.get("action") or "")
        path = str(body.get("path") or "")
        allowed = decide(action, path)
        if action == "publish":
            print(f"publish {canonical_path(path)} {'allow' if allowed else 'deny'}", flush=True)
        self._reply(200 if allowed else 403, {"status": "ok" if allowed else "no viewer"})

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/health":
            self._reply(200, {"status": "ok"})
            return
        self._reply(404, {"error": "not found"})

    def _reply(self, code: int, payload: dict) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt: str, *args) -> None:
        return


def _get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=2) as res:
        data = json.loads(res.read().decode())
    return data if isinstance(data, dict) else {}


def note_readers(items) -> None:
    for item in items or []:
        if not isinstance(item, dict):
            continue
        if item.get("readers"):
            note_read(str(item.get("name") or ""))


def _note_open_viewers() -> None:
    page = 0
    while True:
        data = _get_json(f"{API}/v3/paths/list?page={page}&itemsPerPage=100")
        note_readers(data.get("items"))
        page += 1
        if page >= int(data.get("pageCount") or 1):
            return


def _kick_idle_once() -> None:
    try:
        _note_open_viewers()
    except Exception as exc:
        print(f"readers: {exc}", flush=True)
    page = 0
    while True:
        data = _get_json(f"{API}/v3/rtmpconns/list?page={page}&itemsPerPage=100")
        for item in data.get("items") or []:
            if not isinstance(item, dict):
                continue
            path = str(item.get("path") or "")
            conn_id = str(item.get("id") or "")
            if not path or not conn_id or publish_allowed(path):
                continue
            kick = urllib.request.Request(
                f"{API}/v3/rtmpconns/kick/{urllib.parse.quote(conn_id, safe='')}",
                method="POST",
            )
            try:
                urllib.request.urlopen(kick, timeout=2).read()
                print(f"kick {canonical_path(path)}", flush=True)
            except Exception as exc:
                print(f"kick failed {canonical_path(path)}: {exc}", flush=True)
        page += 1
        if page >= int(data.get("pageCount") or 1):
            return


def _kick_loop() -> None:
    while True:
        time.sleep(2)
        try:
            _kick_idle_once()
        except Exception as exc:
            print(f"kick loop: {exc}", flush=True)


def main() -> None:
    threading.Thread(target=_kick_loop, daemon=True).start()
    ThreadingHTTPServer(LISTEN, Handler).serve_forever()


if __name__ == "__main__":
    main()
