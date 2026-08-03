import { Capacitor } from "@capacitor/core";

/** True inside Capacitor iOS/Android shell (not browser / PWA). */
export function isNativeApp(): boolean {
  try {
    return !!Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

const NATIVE_PERMS_KEY = "safenex.nativePermissions.v1";

export function hasCompletedNativePermissions(): boolean {
  try {
    return localStorage.getItem(NATIVE_PERMS_KEY) === "done";
  } catch {
    return false;
  }
}

export function markNativePermissionsDone(): void {
  try {
    localStorage.setItem(NATIVE_PERMS_KEY, "done");
  } catch {
    /* ignore */
  }
}
