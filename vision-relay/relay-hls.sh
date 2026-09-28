#!/bin/bash
set -u
KEY=0edfed08baf964c1
OUT=/var/hls/$KEY
mkdir -p "$OUT"
python3 "$(dirname "$0")/rtmp-replace.py" >/var/log/rtmp-replace.log 2>&1 &

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
  ffmpeg -nostdin -hide_banner -loglevel warning \
    -use_wallclock_as_timestamps 1 -fflags +genpts -rw_timeout 8000000 \
    -i "rtmp://127.0.0.1:1935/live/$KEY" \
    -c:v copy -c:a aac -ar 44100 -ac 1 -b:a 64k \
    -f hls -hls_time 1 -hls_list_size 12 \
    -start_number "$start" \
    -hls_segment_filename "$OUT/seg%d.ts" \
    -hls_flags delete_segments+omit_endlist+independent_segments+append_list \
    "$OUT/index.m3u8" || true
  sleep 0.3
done
