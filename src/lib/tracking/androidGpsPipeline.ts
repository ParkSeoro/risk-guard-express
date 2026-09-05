/**
 * Android must never run BackgroundGeolocation (or WebView watch) and
 * HeadlessTrackService at the same time. That overlap is the same defect as
 * the old 15s web-worker tick: eco-idle 180s is overwritten, lastEvent edges
 * flicker, worker_last_positions writes amplify.
 *
 * Owner while the activity is in the foreground: WebView / BG plugin.
 * Owner after appStateChange isActive=false (includes recents swipe): headless
 * at TRACK_BG_HEARTBEAT_MS (3 min). Prefs stay armed so onTaskRemoved can
 * restart after a recents swipe without a second JS start.
 *
 * HeadlessTrackService must never crash the process: START_STICKY + an uncaught
 * GPS_PROVIDER / startForeground exception is the Android "keeps stopping" loop.
 */

export type AndroidGpsPipelineOwner = "webview" | "headless";

export function androidGpsPipelineOwner(isAppActive: boolean): AndroidGpsPipelineOwner {
  return isAppActive ? "webview" : "headless";
}
