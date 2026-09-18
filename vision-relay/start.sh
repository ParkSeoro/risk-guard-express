#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker가 없습니다. Docker Desktop 또는 docker.io를 설치하세요."
  exit 1
fi

docker compose up -d
PUB="$(curl -fsS https://api.ipify.org || true)"
PUB="${PUB:-여기.공인.IP}"

cat <<EOF

===============================
 1) SafeNex 비전 관제에 붙여넣을 중계주소
    http://${PUB}:8888

 2) 카메라 RTMP 서버 주소 (H.264, 한 대씩)
    rtmp://${PUB}:1935/cam1
    rtmp://${PUB}:1935/cam2
    rtmp://${PUB}:1935/cam3
    rtmp://${PUB}:1935/cam4
===============================

공인 IP가 틀리면 공유기에서 1935, 8888 포트포워드를 이 컴퓨터로 열어 주세요.
EOF
