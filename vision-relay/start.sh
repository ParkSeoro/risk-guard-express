#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker가 없습니다. Ubuntu면: sudo apt-get install -y docker.io docker-compose-v2"
  exit 1
fi

PUB="$(curl -fsS https://api.ipify.org || true)"
PUB="${PUB:-여기.공인.IP}"
HLS_HOST="${HLS_HOST:-${PUB//./-}.sslip.io}"
export HLS_HOST

if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now vision-hls >/dev/null 2>&1 || true
  systemctl disable --now safenex-viewer-gate >/dev/null 2>&1 || true
fi

# Stop any legacy containers binding port 1935 or 8888
docker rm -f vision-rtmp mediamtx vision-relay-mediamtx-1 vision-relay-viewer-gate-1 >/dev/null 2>&1 || true

docker compose down --remove-orphans >/dev/null 2>&1 || true
docker compose up -d

cat <<EOF

===============================
 SafeNex 비전 관제 (arut/nginx-rtmp-module 기반 중계)
    서버 공인 IP: ${PUB}

 VIGI / NVR RTMP 송출 주소 (H.264)
    rtmp://${PUB}:1935/live/<카메라_스트림_키>

 브라우저 HLS 재생 주소 (자동 HTTPS)
    https://${HLS_HOST}/live/<카메라_스트림_키>/index.m3u8

 AWS Lightsail / VPS 방화벽 필수 오픈 포트
    - 1935 (TCP): RTMP 카메라 송출
    - 80   (TCP): Let's Encrypt 인증서 발급
    - 443  (TCP): 브라우저 HTTPS 스트리밍
===============================

사무실 PC/공유기 NAT는 쓰지 마세요. VPS 방화벽에서 위 포트(1935, 80, 443)만 열면 됩니다.
EOF
