#!/usr/bin/env python3
"""Accept a camera's next RTMP session.

A VIGI camera opens a new RTMP session every few seconds. The previous
publisher is dropped so the new session is accepted. relay-one.sh copies
that video, without audio, straight into the browser playlist.

A second publish in the same few seconds is refused. Accepting it would
cut off the session that just started.

The 10-minute idle notice is enforced in the player. It does not stop this relay.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import signal
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import re

ROOT = Path(__file__).resolve().parent
CONTROL = "http://127.0.0.1:8088/control/drop/publisher"
LOG = Path("/var/log/rtmp-replace.log")
PUBLISH_PID = Path("/var/run/vision-hls-publish.pid")
KEY_RE = re.compile(r"^[0-9a-f]{16}$")
SEED = (
    "d3b63068716a4269",
    "a67c1652889b974e",
    "0edfed08baf964c1",
    "23f744a86693fb55",
    "e476e5c98aeb5b45",
)
LAST_SESSION: dict[str, float] = {}
LOCK = threading.Lock()


def note(message: str) -> None:
    try:
        with LOG.open("a") as handle:
            handle.write(message + "\n")
    except Exception:
        pass


def claim(name: str) -> bool:
    """False means a session for this camera was accepted in the last few seconds."""
    with LOCK:
        now = time.monotonic()
        if now - LAST_SESSION.get(name, 0) < 4:
            return False
        LAST_SESSION[name] = now
        return True


def stop_pid(path: Path) -> None:
    try:
        pid = int(path.read_text().strip())
    except Exception:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    except PermissionError:
        pass


def ensure(name: str) -> None:
    if not KEY_RE.fullmatch(name):
        return
    subprocess.Popen(
        [str(ROOT / "relay-one.sh"), name],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def wipe_old_playlists() -> None:
    root = Path("/var/hls")
    if not root.exists():
        return
    for child in root.iterdir():
        if not child.is_dir() or not KEY_RE.fullmatch(child.name):
            continue
        for path in child.glob("*"):
            if path.is_file():
                path.unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        fields = urllib.parse.parse_qs(body)
        name = (fields.get("name") or [""])[0].strip().lower()
        app = (fields.get("app") or ["live"])[0]
        if name and app == "live" and KEY_RE.fullmatch(name):
            ensure(name)
            if not claim(name):
                self.send_response(409)
                self.end_headers()
                self.wfile.write(b"busy")
                return
            url = f"{CONTROL}?app=live&name={urllib.parse.quote(name)}"
            try:
                urllib.request.urlopen(url, timeout=1).read()
            except Exception:
                pass
            note(f"accept {name}")
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    stop_pid(PUBLISH_PID)
    wipe_old_playlists()
    for key in SEED:
        ensure(key)
    ThreadingHTTPServer(("127.0.0.1", 8099), Handler).serve_forever()
