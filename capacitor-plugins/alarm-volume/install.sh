#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/android/app/src/main/java/org/safenex/app"
if [[ ! -d "$ROOT/android/app" ]]; then
  echo "android/ missing — run: npx cap add android && npx cap sync"
  exit 1
fi
mkdir -p "$DEST"
cp "$ROOT/capacitor-plugins/alarm-volume/AlarmVolumePlugin.java" "$DEST/"
cp "$ROOT/capacitor-plugins/alarm-volume/MainActivity.java" "$DEST/"
MANIFEST="$ROOT/android/app/src/main/AndroidManifest.xml"
if [[ -f "$MANIFEST" ]] && ! grep -q 'MODIFY_AUDIO_SETTINGS' "$MANIFEST"; then
  python3 - <<'PY'
from pathlib import Path
p = Path("android/app/src/main/AndroidManifest.xml")
t = p.read_text()
perms = '''    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.VIBRATE" />
'''
if "MODIFY_AUDIO_SETTINGS" not in t:
    t = t.replace("</manifest>", perms + "</manifest>")
    p.write_text(t)
    print("Added MODIFY_AUDIO_SETTINGS + VIBRATE to AndroidManifest")
PY
fi
mkdir -p "$ROOT/android/app/src/main/assets/public/sounds"
if [[ -f "$ROOT/public/sounds/siren.wav" ]]; then
  cp "$ROOT/public/sounds/siren.wav" "$ROOT/android/app/src/main/assets/public/sounds/"
fi
echo "AlarmVolume plugin installed into android/"
