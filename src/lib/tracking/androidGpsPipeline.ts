/**
 * Android must never run BackgroundGeolocation (or WebView watch) and
 * HeadlessTrackService at the same time. That overlap is the same defect as
 * the old 15s web-worker tick: eco-idle 180s is overwritten, lastEvent edges
 * flicker, worker_last_positions writes amplify.
 *
 * Owner while the activity is in the foreground: WebView / BG plugin.
 * Owner after appStateChange isActive=false (includes recents swipe): headless.
 */

export type AndroidGpsPipelineOwner = "webview" | "headless";

export function androidGpsPipelineOwner(isAppActive: boolean): AndroidGpsPipelineOwner {
  return isAppActive ? "webview" : "headless";
}
