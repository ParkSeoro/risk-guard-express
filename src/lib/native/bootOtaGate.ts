/**
 * Pre-login OTA gate: check/download/apply before React auth UI mounts.
 * Web/preview: immediate no-op success.
 *
 * Hard timeout: a hung Capgo/bridge/network call must never leave workers
 * on the "업데이트가 있으면 받는 중…" splash forever.
 */
import { isNativeApp } from "./platform";
import { checkAndDownloadOta, type OtaCheckOptions } from "./otaUpdater";

/** Overall gate budget (check + download). Apply wait is separate. */
export const BOOT_OTA_GATE_TIMEOUT_MS = 20_000;

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

function clearBootOtaOwnership() {
  const root = document.getElementById("root");
  if (root) delete root.dataset.bootOta;
}

function paintSplash(p: BootOtaProgress) {
  const root = document.getElementById("root");
  if (!root) return;
  // Only paint while we own the boot screen (before React mount)
  if (root.dataset.bootOta !== "1" && p.phase !== "checking" && p.phase !== "downloading" && p.phase !== "applying") {
    return;
  }
  root.dataset.bootOta = "1";
  const title =
    p.phase === "error"
      ? "업데이트 확인 실패"
      : p.phase === "ready" || p.phase === "skipped"
        ? "SafeNex"
        : "SafeNex 업데이트";
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;font-family:system-ui,sans-serif;background:linear-gradient(165deg,#0f172a 0%,#1e293b 55%,#0f172a 100%);color:#f8fafc">
      <div style="max-width:360px;width:100%;text-align:center">
        <div style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin-bottom:8px">${title}</div>
        <p style="margin:0 0 20px;line-height:1.55;color:#cbd5e1;font-size:14px">${p.message}</p>
        ${
          p.phase === "checking" || p.phase === "downloading" || p.phase === "applying"
            ? `<div style="height:4px;border-radius:999px;background:#334155;overflow:hidden">
                 <div style="height:100%;width:40%;border-radius:999px;background:#34d399;animation:bootota 1.1s ease-in-out infinite"></div>
               </div>
               <style>@keyframes bootota{0%{transform:translateX(-120%)}100%{transform:translateX(280%)}}</style>`
            : ""
        }
        ${
          p.version
            ? `<div style="margin-top:14px;font-size:12px;color:#94a3b8">버전 ${p.version}</div>`
            : ""
        }
      </div>
    </div>
  `;
}

async function runBootOtaGateInner(
  opts: OtaCheckOptions & { onProgress?: Listener; strict?: boolean; paint?: boolean },
  emit: (p: BootOtaProgress) => void,
  isCancelled: () => boolean,
): Promise<BootOtaProgress> {
  emit({ phase: "checking", message: "새 화면이 있는지 확인하는 중…" });

  // Mark Capgo ready first (also done inside checkAndDownloadOta)
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    await CapacitorUpdater.notifyAppReady();
  } catch {
    /* plugin missing */
  }
  if (isCancelled()) {
    return { phase: "ready", message: "업데이트 확인이 지연되어 앱을 계속합니다." };
  }

  emit({ phase: "downloading", message: "업데이트가 있으면 받는 중…" });
  const r = await checkAndDownloadOta({
    silent: true,
    preferImmediate: opts.preferImmediate !== false,
    shouldAbort: isCancelled,
  });
  if (isCancelled()) {
    return { phase: "ready", message: "업데이트 확인이 지연되어 앱을 계속합니다." };
  }

  if (!r.ok) {
    const err: BootOtaProgress = {
      phase: "error",
      message: r.message || "업데이트 확인에 실패했습니다. 로그인을 계속합니다.",
    };
    emit(err);
    if (opts.strict) return err;
    clearBootOtaOwnership();
    return { ...err, phase: "ready", message: err.message };
  }

  if (r.apply === "immediate") {
    emit({
      phase: "applying",
      message: "새 화면을 적용하는 중… 잠시만 기다려 주세요.",
      version: r.version,
    });
    // CapacitorUpdater.set() normally reloads the WebView.
    // Give it a moment; if still here, caller may mount the current bundle.
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    clearBootOtaOwnership();
    return {
      phase: "applying",
      message: r.message,
      version: r.version,
    };
  }

  const done: BootOtaProgress = {
    phase: "ready",
    message: r.message || "최신 화면입니다.",
    version: r.version,
  };
  clearBootOtaOwnership();
  return done;
}

/**
 * Run OTA before app UI. Blocks until check finishes (or apply triggers reload).
 * Never blocks web. On failure/timeout, proceeds to login (non-fatal) unless opts.strict.
 */
export async function runBootOtaGate(
  opts: OtaCheckOptions & {
    onProgress?: Listener;
    strict?: boolean;
    paint?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<BootOtaProgress> {
  const paint = opts.paint !== false;
  const emit = (p: BootOtaProgress) => {
    opts.onProgress?.(p);
    if (paint) paintSplash(p);
  };

  if (!isNativeApp()) {
    return {
      phase: "skipped",
      message: "웹/미리보기는 업데이트 게이트를 건너뜁니다.",
    };
  }

  const timeoutMs = opts.timeoutMs ?? BOOT_OTA_GATE_TIMEOUT_MS;
  let cancelled = false;

  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<BootOtaProgress>((resolve) => {
      timeoutId = setTimeout(() => {
        cancelled = true;
        console.warn(`[bootOtaGate] timed out after ${timeoutMs}ms — continuing to app`);
        resolve({
          phase: "ready",
          message: "업데이트 확인이 지연되어 앱을 계속합니다.",
        });
      }, timeoutMs);
    });

    const result = await Promise.race([
      runBootOtaGateInner(opts, emit, () => cancelled),
      timedOut,
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    if (cancelled) {
      emit({
        phase: "error",
        message: "업데이트 확인이 지연되어 앱을 계속합니다.",
      });
      clearBootOtaOwnership();
    }
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const err: BootOtaProgress = {
      phase: "error",
      message: `업데이트 확인 오류: ${msg}`,
    };
    emit(err);
    clearBootOtaOwnership();
    return { phase: "ready", message: err.message };
  }
}
