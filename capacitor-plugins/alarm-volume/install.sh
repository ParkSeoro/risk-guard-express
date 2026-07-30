#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:-all}" # android | ios | all

install_android() {
  DEST="$ROOT/android/app/src/main/java/org/safenex/app"
  if [[ ! -d "$ROOT/android/app" ]]; then
    echo "android/ missing — run: npx cap add android && npx cap sync"
    return 1
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
}

install_ios() {
  DEST="$ROOT/ios/App/App"
  if [[ ! -d "$DEST" ]]; then
    echo "ios/App/App missing — run: npx cap add ios && npx cap sync"
    return 1
  fi
  cp "$ROOT/capacitor-plugins/alarm-volume/ios/AlarmVolumePlugin.swift" "$DEST/"
  mkdir -p "$DEST/sounds"
  if [[ -f "$ROOT/public/sounds/siren.wav" ]]; then
    cp "$ROOT/public/sounds/siren.wav" "$DEST/sounds/siren.wav"
  fi
  # Example entitlements (do not auto-merge — signing fails without Apple approval)
  cp "$ROOT/capacitor-plugins/alarm-volume/ios/App.critical-alerts.entitlements.example" \
     "$DEST/App.critical-alerts.entitlements.example"
  cp "$ROOT/capacitor-plugins/alarm-volume/ios/Info.plist.snippet.xml" \
     "$DEST/Info.plist.snippet.critical-alerts.xml"

  echo "Copied AlarmVolumePlugin.swift → ios/App/App/"
  echo "NEXT (Xcode):"
  echo "  1. Add AlarmVolumePlugin.swift to the App target (File → Add Files if needed)"
  echo "  2. Add sounds/siren.wav to the App bundle (Copy Bundle Resources)"
  echo "  3. After Apple Critical Alerts approval:"
  echo "     - Merge App.critical-alerts.entitlements.example into App.entitlements"
  echo "     - Set SafenexCriticalAlertsEnabled=YES in Info.plist (see snippet)"
  echo "     - Regenerate provisioning profiles with Critical Alerts capability"
}

case "$TARGET" in
  android) install_android ;;
  ios) install_ios ;;
  all)
    install_android || true
    install_ios || true
    ;;
  *)
    echo "Usage: $0 [android|ios|all]"
    exit 1
    ;;
esac
