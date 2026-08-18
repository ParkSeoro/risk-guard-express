# HeadlessTrack (Android)

Foreground location service that POSTs to `track-location` **without the WebView**.
Unlike `@capacitor-community/background-geolocation`, this service is **started** (START_STICKY), not bound — so swiping the app from Recents does not stop GPS.

The TypeScript tracker starts this service only when the app is **backgrounded**
(`appStateChange isActive=false`) and stops it on foreground. Do not run it
alongside BackgroundGeolocation / WebView watch.

Leaving the site fence does **not** `stopSelf()`. The service switches to a
low-power watch (resume poll interval from JS, same hysteresis as
`isInsideResumeFence`) and resumes posting when the device is back inside.

iOS force-quit still stops location (OS limitation). Store rebuild required.

## Install

Copied by `capacitor-plugins/headless-track/install.sh` and the AAB workflow (same pattern as AlarmVolume).
