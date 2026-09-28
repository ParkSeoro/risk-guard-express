#!/bin/bash
set -u
KEY=0edfed08baf964c1
OUT=/var/hls/$KEY
mkdir -p "$OUT"
while true; do
  ffmpeg -nostdin -hide_banner -loglevel warning \
    -rw_timeout 8000000 \
    -i "rtmp://127.0.0.1:1935/live/$KEY" \
    -c:v copy -an \
    -f hls -hls_time 1 -hls_list_size 8 \
    -hls_flags delete_segments+omit_endlist+independent_segments \
    "$OUT/index.m3u8" || true
  sleep 1
done
