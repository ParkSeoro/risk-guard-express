/**
 * TTS helper for danger-zone voice alerts.
 * Primary: Web Speech API (works in Capacitor WebView + browser PWA).
 * No native TTS plugin required — Korean voices are available on Android/iOS WebViews.
 */

const DANGER_MESSAGE =
  "경고. 위험 구역에 진입했습니다. 즉시 이탈하십시오.";

export function speakDangerAlert(message: string = DANGER_MESSAGE): void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    console.warn("[tts] speechSynthesis unavailable");
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(message);
    utter.lang = "ko-KR";
    utter.rate = 0.95;
    utter.pitch = 1.05;
    utter.volume = 1;

    const voices = window.speechSynthesis.getVoices();
    const ko = voices.find((v) => v.lang?.startsWith("ko"));
    if (ko) utter.voice = ko;

    // Some WebViews load voices asynchronously — retry once after voiceschanged
    if (!ko && voices.length === 0) {
      const onVoices = () => {
        window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
        const later = window.speechSynthesis.getVoices().find((v) => v.lang?.startsWith("ko"));
        if (later) utter.voice = later;
        window.speechSynthesis.speak(utter);
      };
      window.speechSynthesis.addEventListener("voiceschanged", onVoices);
      // Still speak immediately as fallback
      window.speechSynthesis.speak(utter);
      return;
    }

    window.speechSynthesis.speak(utter);
  } catch (e) {
    console.warn("[tts] speak failed", e);
  }
}

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

export { DANGER_MESSAGE };
