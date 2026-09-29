#!/usr/bin/env python3
"""Copy SRS publishers to HLS using wall-clock timestamps.

VIGI DTS does not advance, so native HLS never closes a segment.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SRS = os.environ.get("SRS_HTTP", "http://srs:1985").rstrip("/")
API = os.environ.get("SRS_API", f"{SRS}/api/v1/streams/").rstrip("/") + "/"
OUT = os.environ.get("OUT_ROOT", "/var/hls")

_procs: dict[str, subprocess.Popen] = {}


def live_keys() -> set[str]:
    try:
        data = json.loads(urllib.request.urlopen(API, timeout=2).read().decode())
    except Exception:
        return set()
    keys: set[str] = set()
    for item in data.get("streams") or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("app") or "") not in ("", "live"):
            continue
        pub = item.get("publish")
        if not isinstance(pub, dict) or not pub.get("active"):
            continue
        if not item.get("video"):
            continue
        name = str(item.get("name") or "")
        if name:
            keys.add(name)
    return keys


def start(key: str) -> subprocess.Popen:
    out = os.path.join(OUT, key)
    os.makedirs(out, exist_ok=True)
    # Copy keeps every frame on the camera clock, which does not move, so the
    # browser finishes one picture and stops. Re-time at 960p and leave the
    # playlist open so the next second replaces the picture.
    return subprocess.Popen(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-probesize",
            "1048576",
            "-analyzeduration",
            "500000",
            "-fflags",
            "+genpts+discardcorrupt+igndts",
            "-use_wallclock_as_timestamps",
            "1",
            "-i",
            f"http://srs:8080/live/{key}.flv",
            "-vf",
            "scale=960:-2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-g",
            "8",
            "-keyint_min",
            "8",
            "-an",
            "-f",
            "hls",
            "-hls_time",
            "1",
            "-hls_list_size",
            "6",
            "-hls_flags",
            "delete_segments+omit_endlist+independent_segments+temp_file",
            "-hls_segment_filename",
            f"{out}/p{time.time_ns()}-%d.ts",
            f"{out}/_ffmpeg.m3u8",
        ]
    )


_seen: dict[str, list[str]] = {}


def refresh_playlist(key: str) -> None:
    folder = os.path.join(OUT, key)
    try:
        names = [
            name
            for name in os.listdir(folder)
            if name.endswith(".ts") and os.path.getsize(os.path.join(folder, name)) > 5000
        ]
    except FileNotFoundError:
        return
    if not names:
        return
    names.sort(key=lambda name: os.path.getmtime(os.path.join(folder, name)))
    seen = _seen.setdefault(key, [])
    for name in names:
        if name not in seen:
            seen.append(name)
    existing = [name for name in seen if os.path.exists(os.path.join(folder, name))]
    window = existing[-4:]
    if not window:
        return
    for name in existing[:-6]:
        try:
            os.remove(os.path.join(folder, name))
        except OSError:
            pass
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:2",
        f"#EXT-X-MEDIA-SEQUENCE:{seen.index(window[0])}",
    ]
    for name in window:
        if os.path.exists(os.path.join(folder, name)):
            lines.extend(["#EXTINF:1.000,", name])
    tmp = os.path.join(folder, ".index.m3u8")
    with open(tmp, "w", encoding="ascii") as handle:
        handle.write("\n".join(lines) + "\n")
    os.replace(tmp, os.path.join(folder, "index.m3u8"))


def _get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=2) as res:
        data = json.loads(res.read().decode())
    return data if isinstance(data, dict) else {}


def kick_previous_camera(ip: str) -> None:
    """VIGI opens a second RTMP line. SRS then answers StreamBusy and the camera drops both.

    Drop the previous line from this camera before the new publish, so the new line is accepted.
    """
    if not ip or ip.startswith("172.") or ip.startswith("127.") or ip == "::1":
        return
    try:
        data = _get_json(f"{SRS}/api/v1/clients/")
    except Exception as exc:
        print(f"clients: {exc}", flush=True)
        return
    for client in data.get("clients") or []:
        if not isinstance(client, dict):
            continue
        if client.get("ip") != ip or not client.get("publish"):
            continue
        cid = str(client.get("id") or "")
        if not cid:
            continue
        kick = urllib.request.Request(f"{SRS}/api/v1/clients/{cid}", method="DELETE")
        try:
            urllib.request.urlopen(kick, timeout=2).read()
            print(f"kick {ip} {cid}", flush=True)
        except Exception as exc:
            print(f"kick failed {ip}: {exc}", flush=True)


class Hook(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            body = {}
        if self.path.split("?", 1)[0] == "/connect":
            kick_previous_camera(str(body.get("ip") or ""))
        raw_out = b"0"
        self.send_response(200)
        self.send_header("Content-Length", str(len(raw_out)))
        self.end_headers()
        self.wfile.write(raw_out)

    def log_message(self, fmt: str, *args) -> None:
        return


def main() -> None:
    while True:
        live = live_keys()
        for key in live:
            proc = _procs.get(key)
            if proc is None or proc.poll() is not None:
                _procs[key] = start(key)
                print(f"copy {key}", flush=True)
            refresh_playlist(key)
        time.sleep(0.5)


if __name__ == "__main__":
    main()
