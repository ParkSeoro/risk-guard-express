#!/usr/bin/env bash
# SafeNex Vision Edge local installation helper.
# Run on the approved Gateway host as an operator with sudo privileges.
set -euo pipefail

SOURCE_DIR="${1:-$(pwd)}"
INSTALL_DIR="/opt/safenex-vision-edge"
CONFIG_DIR="/etc/safenex-vision-edge"
STATE_DIR="/var/lib/safenex-vision-edge"
SERVICE_USER="safenex-vision"

if [[ ! -f "$SOURCE_DIR/pyproject.toml" ]]; then
  echo "Run from the vision-edge directory or pass its absolute path." >&2
  exit 1
fi

if [[ -z "${VISION_EDGE_MASTER_KEY:-}" ]]; then
  echo "VISION_EDGE_MASTER_KEY must be supplied for production installation." >&2
  echo "Use a 32-byte urlsafe base64 Fernet key managed by the organization's secret process." >&2
  exit 1
fi

sudo install -d -m 0750 "$INSTALL_DIR" "$CONFIG_DIR" "$STATE_DIR"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  sudo useradd --system --home "$STATE_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
sudo rsync -a --delete --exclude '.venv' --exclude '__pycache__' "$SOURCE_DIR/" "$INSTALL_DIR/"
sudo python3 -m venv "$INSTALL_DIR/.venv"
sudo "$INSTALL_DIR/.venv/bin/pip" install --upgrade pip
sudo "$INSTALL_DIR/.venv/bin/pip" install "$INSTALL_DIR"

if [[ ! -f "$CONFIG_DIR/vision-edge.json" ]]; then
  sudo install -m 0600 "$INSTALL_DIR/config/vision-edge.example.json" "$CONFIG_DIR/vision-edge.json"
  echo "Configuration template copied to $CONFIG_DIR/vision-edge.json"
fi

sudo bash -c "printf 'VISION_EDGE_MASTER_KEY=%q\n' '$VISION_EDGE_MASTER_KEY' > '$CONFIG_DIR/edge.env'"
sudo chmod 0600 "$CONFIG_DIR/edge.env" "$CONFIG_DIR/vision-edge.json"
sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR" "$STATE_DIR"
sudo install -m 0644 "$INSTALL_DIR/systemd/safenex-vision-edge.service" /etc/systemd/system/safenex-vision-edge.service
sudo systemctl daemon-reload
sudo systemctl enable safenex-vision-edge.service

echo "Installation complete. Before start, set certificate paths, Fleet endpoints and NVR camera secret references."
echo "Then run: sudo systemctl start safenex-vision-edge && sudo systemctl status safenex-vision-edge"
