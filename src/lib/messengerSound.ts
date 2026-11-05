/**
 * SafeNex Messenger Sound & Notification Helper
 * Provides a gentle 2-tone synthesized chime via Web Audio API
 * and system / toast notifications for incoming chat messages.
 */

let lastSoundPlayedAt = 0;

/**
 * Plays a pleasant, gentle 2-tone chime (D5 -> A5) using Web Audio API.
 * Rate-limited to prevent sound spam when multiple messages arrive at once.
 */
export function playMessengerChime(volume = 0.3): void {
  if (typeof window === "undefined") return;
  const nowMs = Date.now();
  if (nowMs - lastSoundPlayedAt < 1000) return; // 1s throttle
  lastSoundPlayedAt = nowMs;

  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const vol = Math.max(0.05, Math.min(1.0, volume));

    // Tone 1: D5 (587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.linearRampToValueAtTime(vol * 0.8, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.23);

    // Tone 2: A5 (880 Hz) - slightly higher, warm ending
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.1);
    gain2.gain.setValueAtTime(0.001, now + 0.1);
    gain2.gain.linearRampToValueAtTime(vol, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.43);

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 600);
  } catch {
    /* audio autoplay might be blocked before first user gesture */
  }
}
