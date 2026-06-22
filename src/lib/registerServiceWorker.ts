/**
 * Service Worker 안전 등록 — 푸시 알림 전용.
 *
 * Lovable preview / iframe / dev 환경에서는 등록하지 않고,
 * 기존 등록이 있으면 해제해 stale SW가 남지 않게 한다.
 * 운영(published) 환경과 로컬 build preview에서만 실제로 등록한다.
 */
export async function registerSWSafely(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;

  const host = window.location.hostname;
  const isPreviewHost =
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" || host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev");
  const inIframe = window.self !== window.top;
  const killSwitch = new URLSearchParams(window.location.search).has("sw") &&
    new URLSearchParams(window.location.search).get("sw") === "off";

  // 차단 조건이면 기존 등록 제거 후 종료
  if (!import.meta.env.PROD || isPreviewHost || inIframe || killSwitch) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        if (r.active?.scriptURL?.endsWith("/sw.js")) await r.unregister();
      }
    } catch {/* ignore */}
    return null;
  }

  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (e) {
    console.warn("[push] SW register failed", e);
    return null;
  }
}
