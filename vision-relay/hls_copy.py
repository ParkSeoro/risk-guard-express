#!/usr/bin/env python3
"""Copy SRS publishers to HLS using wall-clock timestamps.

VIGI DTS does not advance, so native HLS never closes a segment.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.request

API = os.environ.get("SRS_API", "http://srs:1985/api/v1/streams/").rstrip("/") + "/"
RTMP = os.environ.get("SRS_RTMP", "rtmp://srs:1935/live").rstrip("/")
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


def fix_playlist(key: str) -> None:
    folder = os.path.join(OUT, key)
    try:
        names = [
            name
            for name in os.listdir(folder)
            if name.endswith(".ts") and os.path.getsize(os.path.join(folder, name)) > 1000
        ]
    except FileNotFoundError:
        return
    if not names:
        return
    names.sort()
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:2",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:EVENT",
    ]
    for name in names[-6:]:
        lines.extend(["#EXTINF:2.000,", name])
    lines.append("#EXT-X-ENDLIST")
    with open(os.path.join(folder, "index.m3u8"), "w", encoding="ascii") as handle:
        handle.write("\n".join(lines) + "\n")


def start(key: str) -> subprocess.Popen:
    out = os.path.join(OUT, key)
    os.makedirs(out, exist_ok=True)
    return subprocess.Popen(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-rw_timeout",
            "12000000",
            "-probesize",
            "1048576",
            "-analyzeduration",
            "1000000",
            "-fflags",
            "+genpts+discardcorrupt+igndts",
            "-use_wallclock_as_timestamps",
            "1",
            "-timeout",
            "8000000",
            "-i",
            f"http://srs:8080/live/{key}.flv",
            "-map",
            "0:v:0",
            "-c:v",
            "copy",
            "-an",
            "-muxdelay",
            "0",
            "-muxpreload",
            "0",
            "-f",
            "hls",
            "-hls_time",
            "1",
            "-hls_list_size",
            "6",
            "-hls_flags",
            "delete_segments+omit_endlist+temp_file",
            "-hls_segment_filename",
            f"{out}/s%d.ts",
            f"{out}/_src.m3u8",
        ]
    )


def main() -> None:
    while True:
        live = live_keys()
        for key, proc in list(_procs.items()):
            if proc.poll() is not None:
                fix_playlist(key)
        for key in live:
            proc = _procs.get(key)
            if proc is None or proc.poll() is not None:
                _procs[key] = start(key)
                print(f"copy {key}", flush=True)
            else:
                fix_playlist(key)
        time.sleep(0.2)


if __name__ == "__main__":
    main()
