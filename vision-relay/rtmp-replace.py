#!/usr/bin/env python3
"""Keep a browser HLS copy for every camera that publishes to this relay.

A VIGI camera opens a new RTMP session every few seconds. Dropping the previous
publisher lets the new session in. The HLS reader stays up for as long as the
camera has power.

The 10-minute idle notice is enforced in the player. It does not stop this relay.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import signal
import subprocess
import urllib.parse
import urllib.request
import re

ROOT = Path(__file__).resolve().parent
KEYS = Path("/var/hls/stream-keys")
CONTROL = "http://127.0.0.1:8088/control/drop/publisher"
KEY_RE = re.compile(r"^[0-9a-f]{16}$")
# Cameras already registered. A later camera is added on its first publish.
SEED = (
    "d3b63068716a4269",
    "a67c1652889b974e",
    "0edfed08baf964c1",
    "23f744a86693fb55",
    "e476e5c98aeb5b45",
)


def remember(name: str) -> None:
    KEYS.parent.mkdir(parents=True, exist_ok=True)
    existing = set()
    if KEYS.exists():
        existing = {line.strip() for line in KEYS.read_text().splitlines() if line.strip()}
    if name not in existing:
        with KEYS.open("a") as handle:
            handle.write(name + "\n")


def ensure(name: str) -> None:
    if not KEY_RE.fullmatch(name):
        return
    remember(name)
    subprocess.Popen(
        [str(ROOT / "relay-one.sh"), name],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        fields = urllib.parse.parse_qs(body)
        name = (fields.get("name") or [""])[0].strip().lower()
        app = (fields.get("app") or ["live"])[0]
        if name and app == "live":
            url = f"{CONTROL}?app=live&name={urllib.parse.quote(name)}"
            try:
                urllib.request.urlopen(url, timeout=1).read()
            except Exception:
                pass
            ensure(name)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    # Short-lived retries must not pile up as zombies.
    signal.signal(signal.SIGCHLD, signal.SIG_IGN)
    for key in SEED:
        ensure(key)
    if KEYS.exists():
        for line in KEYS.read_text().splitlines():
            ensure(line.strip().lower())
    ThreadingHTTPServer(("127.0.0.1", 8099), Handler).serve_forever()
