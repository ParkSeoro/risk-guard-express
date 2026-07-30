/**
 * Capacitor AlarmVolume plugin bridge.
 * Android native: STREAM_ALARM max + USAGE_ALARM siren.
 * Web/iOS: methods return ok:false — callers fall back to web audio + haptics.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export type BoostMaxResult = {
  ok: boolean;
  previousAlarm?: number;
  previousMusic?: number;
  maxAlarm?: number;
  maxMusic?: number;
};

export type PlaySirenResult = {
  ok: boolean;
  source?: string;
};

export interface AlarmVolumePlugin {
  boostMax(): Promise<BoostMaxResult>;
  restore(): Promise<{ ok: boolean }>;
  playSiren(options?: { durationMs?: number }): Promise<PlaySirenResult>;
  vibrate(): Promise<{ ok: boolean }>;
  stop(): Promise<{ ok: boolean }>;
}

const AlarmVolume = registerPlugin<AlarmVolumePlugin>("AlarmVolume", {
  web: () => ({
    async boostMax() {
      return { ok: false };
    },
    async restore() {
      return { ok: false };
    },
    async playSiren() {
      return { ok: false };
    },
    async vibrate() {
      return { ok: false };
    },
    async stop() {
      return { ok: false };
    },
  }),
});

export function isAndroidNativeAlarmAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function boostAlarmVolumeMax(): Promise<boolean> {
  if (!isAndroidNativeAlarmAvailable()) return false;
  try {
    const r = await AlarmVolume.boostMax();
    return !!r.ok;
  } catch (e) {
    console.warn("[AlarmVolume] boostMax failed", e);
    return false;
  }
}

export async function restoreAlarmVolume(): Promise<void> {
  if (!isAndroidNativeAlarmAvailable()) return;
  try {
    await AlarmVolume.restore();
  } catch (e) {
    console.warn("[AlarmVolume] restore failed", e);
  }
}

export async function playNativeAlarmSiren(durationMs = 2000): Promise<boolean> {
  if (!isAndroidNativeAlarmAvailable()) return false;
  try {
    const r = await AlarmVolume.playSiren({ durationMs });
    return !!r.ok;
  } catch (e) {
    console.warn("[AlarmVolume] playSiren failed", e);
    return false;
  }
}

export async function stopNativeAlarmSiren(): Promise<void> {
  if (!isAndroidNativeAlarmAvailable()) return;
  try {
    await AlarmVolume.stop();
  } catch {
    /* ignore */
  }
}

export async function nativeAlarmVibrate(): Promise<boolean> {
  if (!isAndroidNativeAlarmAvailable()) return false;
  try {
    const r = await AlarmVolume.vibrate();
    return !!r.ok;
  } catch {
    return false;
  }
}

export { AlarmVolume };
