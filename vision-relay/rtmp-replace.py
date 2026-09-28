#!/usr/bin/env python3
"""Accept a camera's next RTMP session, and publish browser HLS.

A VIGI camera opens a new RTMP session every few seconds. The previous
publisher is dropped so the new session is accepted. nginx-rtmp records
that session, including its keyframe. hls-publish.py copies the picture
into the public playlist.

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


def start_publisher() -> None:
    stop_pid(PUBLISH_PID)
    time.sleep(0.4)
    proc = subprocess.Popen(
        ["python3", str(ROOT / "hls-publish.py")],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        PUBLISH_PID.parent.mkdir(parents=True, exist_ok=True)
        PUBLISH_PID.write_text(str(proc.pid))
    except Exception:
        pass
    note(f"publisher {proc.pid}")


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        fields = urllib.parse.parse_qs(body)
        name = (fields.get("name") or [""])[0].strip().lower()
        app = (fields.get("app") or ["live"])[0]
        if name and app == "live" and KEY_RE.fullmatch(name):
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
    start_publisher()
    ThreadingHTTPServer(("127.0.0.1", 8099), Handler).serve_forever()
