# AlarmVolume (Android Capacitor local plugin)

Forces `STREAM_ALARM` + `STREAM_MUSIC` to max during danger-zone alerts and plays the siren with `USAGE_ALARM`.

## Install

```bash
bash capacitor-plugins/alarm-volume/install.sh
npx cap sync android
```

Requires a local `android/` project (`npx cap add android`). Store rebuild needed — not OTA-deployable.
