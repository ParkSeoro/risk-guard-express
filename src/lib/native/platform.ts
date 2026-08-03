// 네이티브(Capacitor) 실행 여부 헬퍼 — SSOT is isNativeApp.ts
export { isNativeApp } from "./isNativeApp";
import { Capacitor } from "@capacitor/core";

export function nativePlatform(): "ios" | "android" | "web" {
  try {
    const p = Capacitor?.getPlatform?.() ?? "web";
    return p === "ios" || p === "android" ? p : "web";
  } catch {
    return "web";
  }
}
