#!/usr/bin/env python3
"""Publish a browser playlist from the relay's raw HLS fragments.

nginx-rtmp keeps each camera's picture across reconnects, including the
keyframe. It also labels G.711 as AAC with no channels. A browser treats
that audio as fatal and shows a black screen, so the public files are
video only.

The 10-minute idle notice is a player setting. This process keeps running.
"""
from pathlib import Path
import fcntl
import re
import subprocess
import time

RAW = Path("/var/hls/_raw")
LIVE = Path("/var/hls")
LOG = Path("/var/log/vision-hls/publish.log")
KEY_RE = re.compile(r"^[0-9a-f]{16}$")
MIN_BYTES = 8000
KEEP = 8


def note(message: str) -> None:
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a") as handle:
            handle.write(message + "\n")
    except Exception:
        pass


def parse_playlist(text: str) -> list[tuple[bool, float, str]]:
    items: list[tuple[bool, float, str]] = []
    disc = False
    dur: float | None = None
    for line in text.splitlines():
        if line.startswith("#EXT-X-DISCONTINUITY"):
            disc = True
            continue
        if line.startswith("#EXTINF:"):
            try:
                dur = float(line.split(":", 1)[1].split(",", 1)[0])
            except ValueError:
                dur = None
            continue
        if line and not line.startswith("#"):
            items.append((disc, dur if dur and dur > 0 else 2.0, line.strip()))
            disc = False
            dur = None
    return items


def wipe_public() -> None:
    if not LIVE.exists():
        return
    for child in LIVE.iterdir():
        if not child.is_dir() or not KEY_RE.fullmatch(child.name):
            continue
        for path in child.iterdir():
            if path.is_file():
                path.unlink(missing_ok=True)
            elif path.is_dir():
                for nested in path.rglob("*"):
                    if nested.is_file():
                        nested.unlink(missing_ok=True)
                for nested in sorted(path.rglob("*"), reverse=True):
                    if nested.is_dir():
                        nested.rmdir()
                path.rmdir()


def duration_seconds(path: Path) -> float:
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nw=1:nk=1",
                str(path),
            ],
            timeout=4,
            stderr=subprocess.DEVNULL,
        )
        return float(out.decode().strip() or "0")
    except Exception:
        return 0.0


def remux(src: Path, dst: Path) -> bool:
    tmp = dst.with_suffix(".ts.part")
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(src),
                "-map",
                "0:v:0",
                "-c:v",
                "copy",
                "-an",
                "-f",
                "mpegts",
                str(tmp),
            ],
            timeout=8,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        tmp.unlink(missing_ok=True)
        return False
    if not tmp.exists() or tmp.stat().st_size < MIN_BYTES:
        tmp.unlink(missing_ok=True)
        return False
    tmp.replace(dst)
    return True


def write_playlist(directory: Path, sequence: int, entries: list[tuple[bool, float, str]]) -> None:
    if not entries:
        return
    target = max(1, int(max(item[1] for item in entries) + 0.999))
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-INDEPENDENT-SEGMENTS",
        f"#EXT-X-TARGETDURATION:{target}",
        f"#EXT-X-MEDIA-SEQUENCE:{sequence}",
    ]
    for disc, dur, name in entries:
        if disc:
            lines.append("#EXT-X-DISCONTINUITY")
        lines.append(f"#EXTINF:{dur:.3f},")
        lines.append(name)
    text = "\n".join(lines) + "\n"
    tmp = directory / "index.m3u8.next"
    tmp.write_text(text)
    tmp.replace(directory / "index.m3u8")
    keep = {name for _, _, name in entries}
    for old in directory.glob("v*.ts"):
        if old.name not in keep:
            old.unlink(missing_ok=True)


def main() -> None:
    lock = Path("/var/lock/vision-hls-publish.lock").open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    wipe_public()
    # source name -> mtime copied. The fragment nginx is still writing is skipped.
    seen: dict[str, dict[str, float]] = {}
    windows: dict[str, list[tuple[bool, float, str]]] = {}
    sequence: dict[str, int] = {}
    counter: dict[str, int] = {}
    note("publisher up")
    while True:
        if RAW.exists():
            for playlist in RAW.glob("*/index.m3u8"):
                key = playlist.parent.name
                if not KEY_RE.fullmatch(key):
                    continue
                try:
                    items = parse_playlist(playlist.read_text())
                except OSError:
                    continue
                seen.setdefault(key, {})
                windows.setdefault(key, [])
                sequence.setdefault(key, 0)
                counter.setdefault(key, 0)
                changed = False
                # The last name is the fragment nginx is still writing.
                closed = items[:-1] if len(items) > 1 else []
                for disc, dur, name in closed:
                    src = playlist.parent / name
                    try:
                        stat = src.stat()
                    except OSError:
                        continue
                    if stat.st_size < MIN_BYTES:
                        continue
                    previous = seen[key].get(name)
                    if previous is not None and abs(stat.st_mtime - previous) < 1:
                        continue
                    live = LIVE / key
                    live.mkdir(parents=True, exist_ok=True)
                    dest_name = f"v{counter[key]}.ts"
                    dest = live / dest_name
                    if not remux(src, dest):
                        seen[key][name] = stat.st_mtime
                        note(f"skip {key} {name}")
                        continue
                    measured = duration_seconds(dest)
                    if 0.4 <= measured <= 12:
                        dur = measured
                    elif dur < 0.4 or dur > 12:
                        dur = 2.0
                    windows[key].append((disc, dur, dest_name))
                    counter[key] += 1
                    seen[key][name] = stat.st_mtime
                    while len(windows[key]) > KEEP:
                        windows[key].pop(0)
                        sequence[key] += 1
                    changed = True
                    note(f"took {key} {name} -> {dest_name} {dest.stat().st_size}")
                if changed:
                    write_playlist(LIVE / key, sequence[key], windows[key])
        time.sleep(0.3)


if __name__ == "__main__":
    main()
