/**
 * Pre-login Capgo handshake only.
 * Do NOT download/apply OTA here — CapacitorUpdater.download can stall the WebView
 * so JS timers never fire and a splash with "업데이트가 있으면 받는 중…" hangs forever
 * (seen on fresh Play 474 installs). OTA runs after React mounts via initOtaUpdater.
 */
import { isNativeApp } from "./platform";

/** Kept for tests / callers; boot no longer waits on download. */
export const BOOT_OTA_GATE_TIMEOUT_MS = 3_000;

export type BootOtaPhase =
  | "idle"
  | "checking"
  | "downloading"
  | "applying"
  | "ready"
  | "skipped"
  | "error";

export type BootOtaProgress = {
  phase: BootOtaPhase;
  message: string;
  version?: string;
};

type Listener = (p: BootOtaProgress) => void;

/**
 * Mark Capgo bundle ready, then return immediately so login UI can mount.
 * Download/apply is deferred (see initOtaUpdater).
 */
export async function runBootOtaGate(
  opts: {
    onProgress?: Listener;
    strict?: boolean;
    paint?: boolean;
    timeoutMs?: number;
    preferImmediate?: boolean;
    silent?: boolean;
    shouldAbort?: () => boolean;
  } = {},
): Promise<BootOtaProgress> {
  if (!isNativeApp()) {
    return {
      phase: "skipped",
      message: "웹/미리보기는 업데이트 게이트를 건너뜁니다.",
    };
  }

  const timeoutMs = opts.timeoutMs ?? BOOT_OTA_GATE_TIMEOUT_MS;

  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    await Promise.race([
      CapacitorUpdater.notifyAppReady(),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("notifyAppReady timeout")), timeoutMs);
      }),
    ]);
  } catch (e) {
    console.warn("[bootOtaGate] notifyAppReady skipped", e);
  }

  const done: BootOtaProgress = {
    phase: "ready",
    message: "앱을 시작합니다.",
  };
  opts.onProgress?.(done);
  return done;
}
