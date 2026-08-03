/** Play Store / 앱 설치 링크 — 내부·정식 공통 패키지 ID */
export const PLAY_STORE_PACKAGE_ID = "org.safenex.app";

export function playStoreWebUrl(): string {
  const fromEnv = (import.meta.env.VITE_PLAY_STORE_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  return `https://play.google.com/store/apps/details?id=${PLAY_STORE_PACKAGE_ID}`;
}

/** Android intent-style market URL (앱/브라우저가 스토어로 넘김) */
export function playStoreMarketUrl(): string {
  return `market://details?id=${PLAY_STORE_PACKAGE_ID}`;
}

export function openPlayStore(): void {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isAndroid = /Android/i.test(ua);
  const web = playStoreWebUrl();
  if (isAndroid) {
    // Try market:// then fall back to https
    window.location.href = playStoreMarketUrl();
    window.setTimeout(() => {
      window.location.href = web;
    }, 800);
    return;
  }
  window.open(web, "_blank", "noopener,noreferrer");
}
