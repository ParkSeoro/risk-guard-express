/**
 * Pre-login Capgo handshake only.
 * Do NOT download or apply a bundle here. This function only sends the Capgo ready
 * signal, and it gives up after a few seconds.
 * A newer bundle is handled by runPreLoginOta before the login screen mounts.
 * That path has its own deadline and never stays on the splash forever.
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
