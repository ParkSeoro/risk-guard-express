/**
 * Danger-zone alarm audio: siren (1–2s) → Korean TTS.
 *
 * Volume / silent behavior:
 * - Android native (Capacitor): AlarmVolume plugin → STREAM_ALARM + STREAM_MUSIC
 *   forced to max for the alert duration, siren via USAGE_ALARM (bypasses silent
 *   for alarm stream on most OEMs). Volume restored on stop.
 * - iOS native: NativeAudio focus/playback (ignores mute switch; follows hardware vol).
 * - Web/PWA: cannot force system volume — app-relative 1.0 + haptics (see alarmHaptics).
 */

import { Capacitor } from "@capacitor/core";
import { NativeAudio } from "@capacitor-community/native-audio";
import { buildDangerTtsMessage, type AlarmRoleInput } from "@/lib/alarmRoleLabel";
import {
  boostAlarmVolumeMax,
  isAndroidNativeAlarmAvailable,
  playNativeAlarmSiren,
  restoreAlarmVolume,
  stopNativeAlarmSiren,
} from "@/lib/alarmVolume";

const SIREN_ASSET_ID = "danger_siren";
const SIREN_WEB_PATH = "/sounds/siren.wav";
const SIREN_DURATION_MS = 2000;

export const DANGER_MESSAGE =
  "경고. 위험 구역에 진입했습니다. 즉시 이탈하십시오.";

let audioCtx: AudioContext | null = null;
let nativeReady: Promise<boolean> | null = null;
let htmlSiren: HTMLAudioElement | null = null;
let cancelled = false;
let volumeBoosted = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  return audioCtx;
}

/** Unlock / resume AudioContext after a user gesture when possible. */
export async function unlockAlarmAudio(): Promise<void> {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") await ctx.resume();
  } catch {
    /* ignore */
  }
}

async function ensureNativeSiren(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  // Android uses AlarmVolume plugin (STREAM_ALARM) — skip media-stream native-audio
  if (isAndroidNativeAlarmAvailable()) return false;
  if (!nativeReady) {
    nativeReady = (async () => {
      try {
        await NativeAudio.configure({ fade: false, focus: true });
        await NativeAudio.preload({
          assetId: SIREN_ASSET_ID,
          assetPath: "public/sounds/siren.wav",
          audioChannelNum: 1,
          isUrl: false,
          volume: 1.0,
        });
        await NativeAudio.setVolume({ assetId: SIREN_ASSET_ID, volume: 1.0 });
        return true;
      } catch (e) {
        console.warn("[alarm] native-audio preload failed, falling back to web", e);
        try {
          await NativeAudio.preload({
            assetId: SIREN_ASSET_ID,
            assetPath: SIREN_WEB_PATH,
            audioChannelNum: 1,
            isUrl: true,
            volume: 1.0,
          });
          await NativeAudio.setVolume({ assetId: SIREN_ASSET_ID, volume: 1.0 });
          return true;
        } catch (e2) {
          console.warn("[alarm] native-audio url preload failed", e2);
          return false;
        }
      }
    })();
  }
  return nativeReady;
}

function playSirenViaWebAudio(): Promise<void> {
  return new Promise((resolve) => {
    const ctx = getAudioContext();
    if (!ctx) {
      resolve();
      return;
    }
    const start = async () => {
      try {
        if (ctx.state === "suspended") await ctx.resume();
        const gain = ctx.createGain();
        gain.gain.value = 1.0;
        gain.connect(ctx.destination);

        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.connect(oscGain);
        oscGain.connect(gain);
        osc.type = "sawtooth";

        const now = ctx.currentTime;
        const end = now + SIREN_DURATION_MS / 1000;
        osc.frequency.setValueAtTime(880, now);
        for (let t = 0.25; t < SIREN_DURATION_MS / 1000; t += 0.25) {
          osc.frequency.setValueAtTime(t % 0.5 < 0.25 ? 1175 : 880, now + t);
        }
        // Louder envelope for web (still capped by system volume)
        oscGain.gain.setValueAtTime(0.0001, now);
        oscGain.gain.exponentialRampToValueAtTime(0.85, now + 0.05);
        oscGain.gain.setValueAtTime(0.85, end - 0.08);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, end);

        osc.start(now);
        osc.stop(end);
        osc.onended = () => resolve();
        window.setTimeout(() => resolve(), SIREN_DURATION_MS + 80);
      } catch (e) {
        console.warn("[alarm] WebAudio siren failed", e);
        resolve();
      }
    };
    void start();
  });
}

function playSirenViaHtmlAudio(): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (!htmlSiren) {
        htmlSiren = new Audio(SIREN_WEB_PATH);
        htmlSiren.preload = "auto";
      }
      const el = htmlSiren;
      el.pause();
      el.currentTime = 0;
      el.volume = 1.0;
      el.setAttribute("playsinline", "true");
      (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;

      const done = () => {
        el.removeEventListener("ended", done);
        el.removeEventListener("error", done);
        resolve();
      };
      el.addEventListener("ended", done);
      el.addEventListener("error", done);
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.catch(() => {
          void playSirenViaWebAudio().then(resolve);
        });
      }
      window.setTimeout(done, SIREN_DURATION_MS + 120);
    } catch {
      void playSirenViaWebAudio().then(resolve);
    }
  });
}

async function playSiren(): Promise<void> {
  await unlockAlarmAudio();

  // Android Capacitor: STREAM_ALARM at system max
  if (isAndroidNativeAlarmAvailable()) {
    const boosted = await boostAlarmVolumeMax();
    volumeBoosted = boosted || volumeBoosted;
    const played = await playNativeAlarmSiren(SIREN_DURATION_MS);
    if (played) {
      await new Promise((r) => setTimeout(r, SIREN_DURATION_MS));
      await stopNativeAlarmSiren();
      return;
    }
  }

  if (Capacitor.isNativePlatform()) {
    const ok = await ensureNativeSiren();
    if (ok) {
      try {
        await NativeAudio.setVolume({ assetId: SIREN_ASSET_ID, volume: 1.0 });
        await NativeAudio.play({ assetId: SIREN_ASSET_ID });
        await new Promise((r) => setTimeout(r, SIREN_DURATION_MS));
        try {
          await NativeAudio.stop({ assetId: SIREN_ASSET_ID });
        } catch {
          /* ignore */
        }
        return;
      } catch (e) {
        console.warn("[alarm] native siren play failed", e);
      }
    }
  }
  await playSirenViaHtmlAudio();
}

function speakTts(message: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      console.warn("[tts] speechSynthesis unavailable");
      resolve();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(message);
      utter.lang = "ko-KR";
      utter.rate = 0.95;
      utter.pitch = 1.05;
      utter.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const ko = voices.find((v) => v.lang?.startsWith("ko"));
      if (ko) utter.voice = ko;

      utter.onend = () => resolve();
      utter.onerror = () => resolve();

      if (!ko && voices.length === 0) {
        const onVoices = () => {
          window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
          const later = window.speechSynthesis.getVoices().find((v) => v.lang?.startsWith("ko"));
          if (later) utter.voice = later;
          window.speechSynthesis.speak(utter);
        };
        window.speechSynthesis.addEventListener("voiceschanged", onVoices);
      }
      window.speechSynthesis.speak(utter);
      window.setTimeout(() => resolve(), 12_000);
    } catch (e) {
      console.warn("[tts] speak failed", e);
      resolve();
    }
  });
}

export type DangerAlarmOpts = {
  message?: string;
  displayName?: string | null;
  role?: AlarmRoleInput;
  /** Skip siren (TTS only). Default false. */
  skipSiren?: boolean;
};

/**
 * Full alarm sequence: (optional) siren → TTS.
 * On Android native, boosts system alarm/media volume for the whole sequence.
 */
export async function playDangerAlarm(opts: DangerAlarmOpts = {}): Promise<void> {
  cancelled = false;
  const message =
    opts.message ||
    buildDangerTtsMessage({ displayName: opts.displayName, role: opts.role });

  // Ensure volume boost covers TTS (media stream) as well as siren
  if (isAndroidNativeAlarmAvailable() && !volumeBoosted) {
    volumeBoosted = await boostAlarmVolumeMax();
  }

  try {
    if (!opts.skipSiren) {
      await playSiren();
      if (cancelled) return;
    }
    await speakTts(message);
  } finally {
    // Keep boost until stopSpeaking / modal dismiss (repeat loop may re-enter)
  }
}

/** Back-compat sync entry — fires async sequence without awaiting. */
export function speakDangerAlert(message: string = DANGER_MESSAGE): void {
  void playDangerAlarm({ message, skipSiren: false });
}

export function stopSpeaking(): void {
  cancelled = true;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  try {
    htmlSiren?.pause();
    if (htmlSiren) htmlSiren.currentTime = 0;
  } catch {
    /* ignore */
  }
  if (Capacitor.isNativePlatform()) {
    void NativeAudio.stop({ assetId: SIREN_ASSET_ID }).catch(() => undefined);
  }
  void stopNativeAlarmSiren();
  if (volumeBoosted) {
    volumeBoosted = false;
    void restoreAlarmVolume();
  }
}

export { buildDangerTtsMessage };
