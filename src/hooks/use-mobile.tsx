import * as React from "react";

export const MOBILE_BREAKPOINT = 768;
const FORCE_DESKTOP_KEY = "forceDesktopUI";

/** Sync viewport check (safe for non-React routing helpers). */
export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

/**
 * Phone/tablet-like device — UA + coarse pointer.
 * Used so landscape phones / "Request desktop site" do not force the admin shell.
 */
export function isLikelyPhoneDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iphone|ipod|android.*mobile|windows phone|webos|blackberry|bb10|opera mini/i.test(ua)) {
    return true;
  }
  // iPad / Android tablet — still prefer mobile app shell
  if (/ipad|android(?!.*mobile)|tablet|kindle|silk/i.test(ua)) {
    return true;
  }
  try {
    if (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 1100) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Opt-in desktop shell on a phone (set from MobileHome). */
export function isForceDesktop(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(FORCE_DESKTOP_KEY) === "1";
  } catch {
    return false;
  }
}

export function setForceDesktop(on: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (on) localStorage.setItem(FORCE_DESKTOP_KEY, "1");
    else localStorage.removeItem(FORCE_DESKTOP_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Prefer mobile worker UI for managers on a phone.
 * Roles are unchanged — this only picks the shell path.
 * Phone UA wins over brief landscape width ≥ 768 so AuthGuard does not kick to admin.
 */
export function prefersMobileAppShell(): boolean {
  if (isForceDesktop()) return false;
  if (isLikelyPhoneDevice()) return true;
  return isMobileViewport();
}

/**
 * Responsive mobile flag (CSS breakpoint).
 * Initialize from window width on the client so the first paint matches.
 * Shell routing should use prefersMobileAppShell() instead.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(isMobileViewport);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
