/**
 * iPhone Safari/PWA: "Can't find variable: Shareable".
 * Shareable is a React Native worklets global — it does not exist on iOS web.
 * Recover once: drop the service worker + Cache Storage, then reload.
 */

export const SHAREABLE_RUNTIME_RE =
  /Can't find variable:\s*Shareable|Shareable is not defined|ReferenceError:\s*Shareable/i;

export const IOS_SHAREABLE_PAGE_MESSAGE =
  "아이폰 웹 화면을 다시 불러오는 중입니다. 잠시 후 새로고침됩니다.";

const RECOVER_KEY = "safenex.ios-shareable-recover";
export const IOS_SHAREABLE_RECOVER_COOLDOWN_MS = 15_000;

export function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name} ${err.message}`;
  if (typeof err === "string") return err;
  try {
    return String(err ?? "");
  } catch {
    return "";
  }
}

export function isShareableRuntimeError(err: unknown): boolean {
  return SHAREABLE_RUNTIME_RE.test(errorText(err));
}

export function isIosWebWindow(win: Window = window): boolean {
  try {
    const ua = win.navigator?.userAgent || "";
    if (!/iphone|ipad|ipod/i.test(ua)) return false;
    const cap = (win as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.()) return false;
    return true;
  } catch {
    return false;
  }
}

export function shouldRecoverIosShareable(lastAt: number, now: number): boolean {
  if (!Number.isFinite(lastAt) || lastAt <= 0) return true;
  return now - lastAt >= IOS_SHAREABLE_RECOVER_COOLDOWN_MS;
}

export async function recoverIosWebRuntimeOnce(win: Window = window): Promise<boolean> {
  if (!isIosWebWindow(win)) return false;
  try {
    const last = Number(win.sessionStorage?.getItem(RECOVER_KEY) || "0");
    const now = Date.now();
    if (!shouldRecoverIosShareable(last, now)) return false;
    win.sessionStorage?.setItem(RECOVER_KEY, String(now));
  } catch {
    /* private mode: still try once */
  }

  try {
    const regs = await win.navigator.serviceWorker?.getRegistrations();
    for (const reg of regs || []) {
      await reg.unregister();
    }
  } catch {
    /* ignore */
  }
  try {
    const keys = await win.caches?.keys();
    for (const key of keys || []) {
      await win.caches.delete(key);
    }
  } catch {
    /* ignore */
  }

  try {
    win.location.reload();
  } catch {
    return false;
  }
  return true;
}

export function installIosShareableGuard(win: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    const err = event.error || event.message;
    if (!isShareableRuntimeError(err) && !isShareableRuntimeError(event.message)) return;
    void recoverIosWebRuntimeOnce(win);
  };
  const onReject = (event: PromiseRejectionEvent) => {
    if (!isShareableRuntimeError(event.reason)) return;
    void recoverIosWebRuntimeOnce(win);
  };
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onReject);
  return () => {
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onReject);
  };
}
