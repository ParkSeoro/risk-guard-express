#!/usr/bin/env bash
# Build an offline-installable Ubuntu amd64 package for SafeNex Vision Edge.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n 's/^version = "\(.*\)"$/\1/p' "$ROOT_DIR/pyproject.toml" | head -n 1)"
ARCH="$(dpkg --print-architecture)"
BUILD_ROOT="$ROOT_DIR/dist/debian-root"
OUTPUT_DIR="$ROOT_DIR/dist"
PACKAGE_NAME="safenex-vision-edge_${VERSION}_${ARCH}.deb"

if [[ "$ARCH" != "amd64" ]]; then
  echo "This package definition is currently qualified for amd64 Ubuntu NVR hosts only." >&2
  exit 1
fi

rm -rf "$BUILD_ROOT"
mkdir -p "$BUILD_ROOT" "$OUTPUT_DIR"
cp -a "$ROOT_DIR/packaging/debian/." "$BUILD_ROOT/"

install -d "$BUILD_ROOT/opt/safenex-vision-edge/defaults"
install -d "$BUILD_ROOT/opt/safenex-vision-edge/wheelhouse"
install -d "$BUILD_ROOT/opt/safenex-vision-edge/docs"
install -m 0644 "$ROOT_DIR/packaging/defaults/vision-edge.json" \
  "$BUILD_ROOT/opt/safenex-vision-edge/defaults/vision-edge.json"
install -m 0644 "$ROOT_DIR/systemd/safenex-vision-edge.service" \
  "$BUILD_ROOT/lib/systemd/system/safenex-vision-edge.service"
install -m 0644 "$ROOT_DIR/README.md" "$BUILD_ROOT/opt/safenex-vision-edge/docs/README.md"

python3 -m pip wheel --no-deps --wheel-dir "$BUILD_ROOT/opt/safenex-vision-edge/wheelhouse" "$ROOT_DIR"
python3 -m pip wheel --wheel-dir "$BUILD_ROOT/opt/safenex-vision-edge/wheelhouse" \
  'fastapi>=0.110,<1.0' \
  'uvicorn[standard]>=0.27,<1.0' \
  'httpx>=0.27,<1.0' \
  'cryptography>=42,<51' \
  'pydantic>=2.6,<3'

chmod 0755 "$BUILD_ROOT/DEBIAN/postinst" "$BUILD_ROOT/DEBIAN/prerm" "$BUILD_ROOT/DEBIAN/postrm"
chmod 0755 "$BUILD_ROOT/usr/bin/safenex-vision-edge-ui"

rm -f "$OUTPUT_DIR/$PACKAGE_NAME"
dpkg-deb --root-owner-group --build "$BUILD_ROOT" "$OUTPUT_DIR/$PACKAGE_NAME"
sha256sum "$OUTPUT_DIR/$PACKAGE_NAME" | tee "$OUTPUT_DIR/$PACKAGE_NAME.sha256"
printf '\nBuilt package: %s\n' "$OUTPUT_DIR/$PACKAGE_NAME"
printf 'Install on Ubuntu NVR host: sudo apt install ./%s\n' "$PACKAGE_NAME"
