/**
 * iPhone/iPad product path: Safari (or any iOS browser) → same /app/worker shell as Android app.
 * No App Store build — Play Store CTAs must not lead iOS users.
 */
import { isNativeApp } from "@/lib/native/isNativeApp";

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
}

/** Browser on iPhone/iPad (Capacitor native shell excluded). */
export function isIosWebClient(): boolean {
  return isIosDevice() && !isNativeApp();
}

export function isWebStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}
