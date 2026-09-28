#!/bin/bash
# Read one camera and write HLS until the camera stops.
# Video is copied. G.711 from the camera is stored as AAC.
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

next_start() {
  local last
  last=$(grep -E '^seg[0-9]+\.ts$' "$OUT/index.m3u8" 2>/dev/null | tail -n 1 | grep -oE '[0-9]+' | head -n 1 || true)
  if [ -n "${last:-}" ]; then
    echo $((last + 1))
  else
    echo 0
  fi
}

while true; do
  start=$(next_start)
  # Audio is optional: some sessions announce video before the first sound packet.
  # 1/1000 clock, 25 fps. Counted from zero so a camera clock reset
  # does not stop the file.
  ffmpeg -nostdin -hide_banner -loglevel warning \
    -fflags +nobuffer+genpts+igndts+discardcorrupt \
    -flags low_delay \
    -probesize 32 -analyzeduration 300000 \
    -rw_timeout 15000000 \
    -i "rtmp://127.0.0.1:1935/live/$KEY" \
    -max_interleave_delta 0 -muxdelay 0 -muxpreload 0 \
    -c:v copy -bsf:v "setts=pts=N*40:dts=N*40:duration=40" \
    -af asetpts=NB_CONSUMED_SAMPLES/SR/TB \
    -c:a aac -ar 44100 -ac 1 -b:a 64k \
    -f hls -hls_time 1 -hls_list_size 8 \
    -start_number "$start" \
    -hls_segment_filename "$OUT/seg%d.ts" \
    -hls_flags delete_segments+omit_endlist+split_by_time \
    "$OUT/index.m3u8" &
  echo $! >"$OUT/ffmpeg.pid"
  wait $! || true
  sleep 0.05
done
