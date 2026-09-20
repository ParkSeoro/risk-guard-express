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

docker compose up -d

cat <<EOF

===============================
 SafeNex 비전 관제 → 중계 저장에 넣을 값
    ${PUB}

 VIGI RTMP 서버 주소 (H.264, RTMP)
    rtmp://${PUB}:1935/live

 브라우저 HLS (자동 HTTPS)
    https://${HLS_HOST}

 이 서버에서 열 포트
    1935 (RTMP), 80, 443 (HLS 인증서)
===============================

사무실 PC/공유기 NAT는 쓰지 마세요. VPS 방화벽에서 위 포트만 열면 됩니다.
EOF
