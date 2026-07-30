# AlarmVolume (Android + iOS Capacitor local plugin)

Danger-zone alarm helpers for native shells.

| Platform | Behavior |
|----------|----------|
| **Android** | `STREAM_ALARM` + `STREAM_MUSIC` → max; siren via `USAGE_ALARM` |
| **iOS** | `AVAudioSession.playback` (ignores mute switch); optional **Critical Alerts** push |
| **Web/PWA** | Cannot force system volume — JS falls back to web audio + haptics |

## Install

```bash
bash capacitor-plugins/alarm-volume/install.sh android
bash capacitor-plugins/alarm-volume/install.sh ios
# or: bash capacitor-plugins/alarm-volume/install.sh all
npx cap sync
```

Store rebuild required — not OTA-deployable.

## iOS Critical Alerts (Apple approval required)

1. Request **Critical Alerts** for App ID `org.safenex.app` in [Apple Developer](https://developer.apple.com) (Capabilities → Critical Alerts). Justify: construction-site geofence / life-safety warnings.
2. After approval, merge `ios/App.critical-alerts.entitlements.example` into the App entitlements and enable Critical Alerts on the provisioning profile.
3. Set `SafenexCriticalAlertsEnabled` = `YES` in `Info.plist` (see `Info.plist.snippet.xml`).
4. Rebuild. Without the entitlement, leave the plist flag `false` — requesting `.criticalAlert` is ignored / unsupported.
5. Add `sounds/siren.wav` to the iOS app bundle for critical push sound name `siren.wav`.

Foreground in-app alarms work via `AVAudioSession` regardless of Critical Alerts.
Silent-mode **push** breakthrough needs the entitlement.
