/**
 * Foreground WebView / BG plugin owns sirens and adaptive ticks.
 * HeadlessTrackService stays started at TRACK_BG_HEARTBEAT_MS (3 min) so a
 * recents swipe can restart from Service.onTaskRemoved without a second JS start.
 * Capacitor 8 BridgeActivity has no onTaskRemoved — do not put that hook there.
 *
 * HeadlessTrackService must never crash the process: START_STICKY + an uncaught
 * GPS_PROVIDER / startForeground exception is the Android "keeps stopping" loop.
 */

export type AndroidGpsPipelineOwner = "webview" | "headless";

export function androidGpsPipelineOwner(isAppActive: boolean): AndroidGpsPipelineOwner {
  return isAppActive ? "webview" : "headless";
}
