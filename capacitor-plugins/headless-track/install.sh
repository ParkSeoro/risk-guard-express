#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/android/app/src/main/java/org/safenex/app"
MANIFEST="$ROOT/android/app/src/main/AndroidManifest.xml"

if [[ ! -d "$ROOT/android/app" ]]; then
  echo "android/ missing — run: npx cap add android && npx cap sync"
  exit 0
fi

mkdir -p "$DEST"
cp "$ROOT/capacitor-plugins/headless-track/HeadlessTrackPlugin.java" "$DEST/"
cp "$ROOT/capacitor-plugins/headless-track/HeadlessTrackService.java" "$DEST/"

if [[ -f "$MANIFEST" ]] && ! grep -q 'HeadlessTrackService' "$MANIFEST"; then
  python3 - <<'PY'
from pathlib import Path
p = Path("android/app/src/main/AndroidManifest.xml")
t = p.read_text()
svc = '''
        <service
            android:name="org.safenex.app.HeadlessTrackService"
            android:exported="false"
            android:foregroundServiceType="location"
            android:stopWithTask="false" />
'''
if "HeadlessTrackService" not in t:
    t = t.replace("</application>", svc + "    </application>")
    p.write_text(t)
    print("Registered HeadlessTrackService in AndroidManifest")
PY
fi

echo "HeadlessTrack plugin installed into android/"
