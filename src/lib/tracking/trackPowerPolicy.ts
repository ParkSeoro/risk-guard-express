/**
 * GPS power policy — one place so the map, headless Android service,
 * and WebView tracker do not drift.
 *
 * Foreground (screen on): adaptive. Danger / 80m-near stays hot for sirens.
 * Background (Android headless, iOS BG plugin): 3-minute heartbeat + distance
 * filter. That is enough to move a gate check-in dot onto the pad, and it
 * stays inside the 5-minute "실시간" window. 45s all-day would be ~640
 * wakes / 8h; 180s is ~160.
 *
 * Web / PWA cannot keep a listener after the tab is frozen — the map must
 * label those points as 출근 위치, not live.
 */

export const TRACK_FG_DANGER_MS = 5_000;
export const TRACK_FG_NEAR_MS = 12_000;
export const TRACK_FG_NEAR_IDLE_MS = 60_000;
export const TRACK_FG_ECO_MOVING_MS = 45_000;
export const TRACK_FG_ECO_IDLE_MS = 180_000;

/** Last-position heartbeat when the app is not in the foreground. */
export const TRACK_BG_HEARTBEAT_MS = 180_000;
/** OS may batch fixes until the worker moves this far (metres). */
export const TRACK_BG_DISTANCE_FILTER_M = 30;
export const TRACK_BG_MIN_DISTANCE_M = 15;

export function defaultTrackerIntervals() {
  return {
    moving: TRACK_FG_NEAR_MS,
    idle: TRACK_FG_NEAR_IDLE_MS,
    danger: TRACK_FG_DANGER_MS,
    ecoMoving: TRACK_FG_ECO_MOVING_MS,
    ecoIdle: TRACK_FG_ECO_IDLE_MS,
  };
}

export function backgroundFixesPerShiftHours(hours = 8): number {
  return Math.floor((hours * 3_600_000) / TRACK_BG_HEARTBEAT_MS);
}
