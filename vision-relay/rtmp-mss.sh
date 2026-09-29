#!/usr/bin/env bash
# The camera hangs up when full-size RTMP replies are lost on the way back.
# Clamp that port to 1200 bytes and let TCP probe a smaller path MTU.
set -euo pipefail

sysctl -w net.ipv4.tcp_mtu_probing=1 >/dev/null
sysctl -w net.core.rmem_max=16777216 >/dev/null
sysctl -w net.core.wmem_max=16777216 >/dev/null
sysctl -w net.ipv4.tcp_rmem="4096 131072 16777216" >/dev/null
sysctl -w net.ipv4.tcp_wmem="4096 65536 16777216" >/dev/null

if ! command -v iptables >/dev/null 2>&1; then
  echo "iptables가 없어 RTMP 패킷 크기를 줄이지 못했습니다." >&2
  exit 0
fi

add() {
  iptables -t mangle -C "$@" 2>/dev/null || iptables -t mangle -A "$@"
}

# Incoming SYN: what the camera says it can receive.
add INPUT -p tcp --dport 1935 --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200
# Our SYN-ACK: what we ask the camera to send.
add OUTPUT -p tcp --sport 1935 --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200
