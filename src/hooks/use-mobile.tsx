import * as React from "react";

export const MOBILE_BREAKPOINT = 768;
const FORCE_DESKTOP_KEY = "forceDesktopUI";

/** Sync viewport check (safe for non-React routing helpers). */
export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
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
 */
export function prefersMobileAppShell(): boolean {
  return isMobileViewport() && !isForceDesktop();
}

/**
 * Responsive mobile flag.
 * Initialize from window width on the client so the first paint matches.
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
