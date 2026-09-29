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
fi
# An older nginx publisher binds 1935 on the host and hides MediaMTX.
docker rm -f vision-rtmp >/dev/null 2>&1 || true

bash "$(dirname "$0")/rtmp-mss.sh"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3가 없습니다. 화면을 볼 때만 업로드를 받으려면 python3가 필요합니다."
  exit 1
fi
# The gate has to come back on reboot. MediaMTX refuses every upload when it is down.
install -m 644 "$(dirname "$0")/viewer-gate.service" /etc/systemd/system/safenex-viewer-gate.service
systemctl daemon-reload
systemctl enable --now safenex-viewer-gate
systemctl restart safenex-viewer-gate
python3 - <<'PY'
import socket, time
for _ in range(25):
    try:
        socket.create_connection(("127.0.0.1", 9197), 0.2).close()
        break
    except OSError:
        time.sleep(0.2)
else:
    raise SystemExit("viewer gate did not listen on 127.0.0.1:9197")
PY

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
