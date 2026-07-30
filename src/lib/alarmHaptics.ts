/**
 * Danger-zone haptics — best-effort on web/PWA + Android native plugin.
 * Cannot raise speaker volume on web; vibration still helps when muted.
 */

import { nativeAlarmVibrate, isAndroidNativeAlarmAvailable } from "@/lib/alarmVolume";

/** Aggressive pattern: short bursts then longer pulse (ms). */
export const DANGER_VIBRATE_PATTERN: number[] = [0, 400, 200, 400, 200, 600, 200, 400, 200, 800];

let vibrateTimer: number | null = null;

export async function pulseDangerHaptics(): Promise<void> {
  if (isAndroidNativeAlarmAvailable()) {
    const ok = await nativeAlarmVibrate();
    if (ok) return;
  }
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(DANGER_VIBRATE_PATTERN);
    }
  } catch {
    /* ignore — unsupported / permission */
  }
}

export function startDangerHapticsLoop(intervalMs = 10_000): () => void {
  void pulseDangerHaptics();
  if (vibrateTimer != null) window.clearInterval(vibrateTimer);
  vibrateTimer = window.setInterval(() => {
    void pulseDangerHaptics();
  }, intervalMs);
  return () => {
    if (vibrateTimer != null) {
      window.clearInterval(vibrateTimer);
      vibrateTimer = null;
    }
    try {
      navigator.vibrate?.(0);
    } catch {
      /* ignore */
    }
  };
}
