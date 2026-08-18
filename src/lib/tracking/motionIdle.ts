import { haversineM } from "@/lib/tracking/gpsCalibration";

export const DEFAULT_MOVE_THRESHOLD_M = 12;
export const DEFAULT_IDLE_AFTER_MS = 2 * 60_000;

export type LatLng = { lat: number; lng: number };

export type MotionIdleState = {
  /** Last sample that counted as a significant move (or the first sample). */
  origin: LatLng | null;
  lastMovedAt: number;
};

export function createMotionIdleState(now = Date.now()): MotionIdleState {
  return { origin: null, lastMovedAt: now };
}

/**
 * Idle detection shared by native and web trackers (F-11).
 *
 * Displacement is measured from the last significant-move origin, not from
 * the previous sample (native) or last server ping (web). Slow walking of
 * 4–8 m per fix therefore still accumulates until 12 m and keeps high-rate
 * tracking. GPS jitter inside ~12 m does not reset the idle timer.
 */
export function nextMotionIdle(
  state: MotionIdleState,
  here: LatLng,
  now: number,
  opts?: { thresholdM?: number; idleAfterMs?: number },
): { idle: boolean; state: MotionIdleState } {
  const thresholdM = opts?.thresholdM ?? DEFAULT_MOVE_THRESHOLD_M;
  const idleAfterMs = opts?.idleAfterMs ?? DEFAULT_IDLE_AFTER_MS;

  if (!state.origin) {
    return {
      idle: false,
      state: { origin: here, lastMovedAt: now },
    };
  }

  const displaced = haversineM(state.origin, here);
  let origin = state.origin;
  let lastMovedAt = state.lastMovedAt;
  if (displaced >= thresholdM) {
    origin = here;
    lastMovedAt = now;
  }

  return {
    idle: now - lastMovedAt >= idleAfterMs,
    state: { origin, lastMovedAt },
  };
}
