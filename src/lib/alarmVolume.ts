/**
 * Capacitor AlarmVolume plugin bridge.
 * - Android: STREAM_ALARM max + USAGE_ALARM siren
 * - iOS: AVAudioSession playback (mute-switch bypass) + Critical Alerts request API
 * - Web: ok:false → fall back to web audio + haptics
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export type BoostMaxResult = {
  ok: boolean;
  previousAlarm?: number;
  previousMusic?: number;
  maxAlarm?: number;
  maxMusic?: number;
  note?: string;
};

export type PlaySirenResult = {
  ok: boolean;
  source?: string;
};

export type CriticalAlertsRequestResult = {
  ok: boolean;
  granted?: boolean;
  criticalAlertsEnabledInPlist?: boolean;
  criticalAlertSetting?: string;
  note?: string;
};

export type CriticalAlertsStatusResult = {
  plistFlag?: boolean;
  criticalAlertSetting?: string;
  authorizationStatus?: number;
};

export type SpeakResult = {
  ok: boolean;
  source?: string;
  note?: string;
};

export interface AlarmVolumePlugin {
  boostMax(): Promise<BoostMaxResult>;
  restore(): Promise<{ ok: boolean }>;
  playSiren(options?: { durationMs?: number }): Promise<PlaySirenResult>;
  /** Native Korean (or lang) TTS — more reliable than WebView speechSynthesis. */
  speak(options: { text: string; lang?: string }): Promise<SpeakResult>;
  vibrate(): Promise<{ ok: boolean }>;
  stop(): Promise<{ ok: boolean }>;
  requestCriticalAlerts(): Promise<CriticalAlertsRequestResult>;
  criticalAlertsStatus(): Promise<CriticalAlertsStatusResult>;
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
    async speak() {
      return { ok: false, note: "web — use speechSynthesis" };
    },
    async vibrate() {
      return { ok: false };
    },
    async stop() {
      return { ok: false };
    },
    async requestCriticalAlerts() {
      return {
        ok: false,
        note: "Critical Alerts require the iOS native app + Apple entitlement",
      };
    },
    async criticalAlertsStatus() {
      return { criticalAlertSetting: "notSupported" };
    },
  }),
});

export function isAndroidNativeAlarmAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function isIosNativeAlarmAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

/** Android STREAM_ALARM or iOS AVAudioSession playback plugin. */
export function isNativeAlarmAvailable(): boolean {
  return isAndroidNativeAlarmAvailable() || isIosNativeAlarmAvailable();
}

export async function boostAlarmVolumeMax(): Promise<boolean> {
  if (!isNativeAlarmAvailable()) return false;
  try {
    const r = await AlarmVolume.boostMax();
    return !!r.ok;
  } catch (e) {
    console.warn("[AlarmVolume] boostMax failed", e);
    return false;
  }
}

export async function restoreAlarmVolume(): Promise<void> {
  if (!isNativeAlarmAvailable()) return;
  try {
    await AlarmVolume.restore();
  } catch (e) {
    console.warn("[AlarmVolume] restore failed", e);
  }
}

export async function playNativeAlarmSiren(durationMs = 2000): Promise<boolean> {
  if (!isNativeAlarmAvailable()) return false;
  try {
    const r = await AlarmVolume.playSiren({ durationMs });
    return !!r.ok;
  } catch (e) {
    console.warn("[AlarmVolume] playSiren failed", e);
    return false;
  }
}

export async function stopNativeAlarmSiren(): Promise<void> {
  if (!isNativeAlarmAvailable()) return;
  try {
    await AlarmVolume.stop();
  } catch {
    /* ignore */
  }
}

/** Native TTS (Android TextToSpeech / iOS AVSpeech). Falls back to false on web. */
export async function playNativeTts(text: string, lang = "ko-KR"): Promise<boolean> {
  if (!isNativeAlarmAvailable() || !text?.trim()) return false;
  try {
    const r = await AlarmVolume.speak({ text: text.trim(), lang });
    return !!r.ok;
  } catch (e) {
    console.warn("[AlarmVolume] speak failed", e);
    return false;
  }
}

export async function nativeAlarmVibrate(): Promise<boolean> {
  if (!isNativeAlarmAvailable()) return false;
  try {
    const r = await AlarmVolume.vibrate();
    return !!r.ok;
  } catch {
    return false;
  }
}

/** iOS only — no-ops / false on other platforms. */
export async function requestIosCriticalAlerts(): Promise<CriticalAlertsRequestResult> {
  if (!isIosNativeAlarmAvailable()) {
    return { ok: false, note: "iOS native only" };
  }
  try {
    return await AlarmVolume.requestCriticalAlerts();
  } catch (e: any) {
    return { ok: false, note: e?.message || String(e) };
  }
}

export async function getIosCriticalAlertsStatus(): Promise<CriticalAlertsStatusResult | null> {
  if (!isIosNativeAlarmAvailable()) return null;
  try {
    return await AlarmVolume.criticalAlertsStatus();
  } catch {
    return null;
  }
}

export { AlarmVolume };
