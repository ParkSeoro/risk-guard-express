// 네이티브(Capacitor) 실행 여부 헬퍼
export function isNativeApp(): boolean {
  const cap: any = (globalThis as any).Capacitor;
  return !!(cap?.isNativePlatform?.());
}
export function nativePlatform(): "ios" | "android" | "web" {
  const cap: any = (globalThis as any).Capacitor;
  const p = cap?.getPlatform?.() ?? "web";
  return p === "ios" || p === "android" ? p : "web";
}
