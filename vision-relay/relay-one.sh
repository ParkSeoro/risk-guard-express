#!/bin/bash
# One pipe from the camera's RTMP session to the browser playlist.
# Video is copied as it arrives. Audio is left out.
# The 10-minute screen lock is a player setting. This loop keeps running.
set -u
KEY=${1:-}
if ! [[ "$KEY" =~ ^[0-9a-f]{16}$ ]]; then
  echo "stream key must be 16 hex chars" >&2
  exit 1
fi
OUT=/var/hls/$KEY
mkdir -p "$OUT" /var/lock /var/log/vision-hls
exec 9>"/var/lock/vision-hls-$KEY.lock"
flock -n 9 || exit 0
exec >>"/var/log/vision-hls/$KEY.log" 2>&1

while true; do
  stamp=$(date +%s)
  started=$(date +%s)
  ffmpeg -nostdin -hide_banner -loglevel warning \
    -rw_timeout 15000000 \
    -fflags +genpts+discardcorrupt \
    -probesize 65536 -analyzeduration 500000 \
    -copyts \
    -i "rtmp://127.0.0.1:1935/live/$KEY" \
    -map 0:v:0 -c:v copy -an \
    -muxdelay 0 -muxpreload 0 \
    -f hls -hls_time 2 -hls_list_size 6 \
    -hls_flags delete_segments+omit_endlist+independent_segments+append_list+discont_start \
    -hls_segment_filename "$OUT/s${stamp}-%d.ts" \
    "$OUT/index.m3u8" || true
  ended=$(date +%s)
  if (( ended - started < 2 )); then
    sleep 2
  fi
done
