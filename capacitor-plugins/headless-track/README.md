# HeadlessTrack (Android)

Foreground location service that POSTs to `track-location` **without the WebView**.
Unlike `@capacitor-community/background-geolocation`, this service is **started** (START_STICKY), not bound — so swiping the app from Recents does not stop GPS.

iOS force-quit still stops location (OS limitation). Store rebuild required.

## Install

Copied by `capacitor-plugins/headless-track/install.sh` and the AAB workflow (same pattern as AlarmVolume).
