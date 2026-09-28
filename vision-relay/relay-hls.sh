#!/bin/bash
# One HLS relay supervisor for every VIGI stream key.
# The 10-minute screen lock is a player setting. This process keeps running.
set -u
cd "$(dirname "$0")"
exec python3 ./rtmp-replace.py
