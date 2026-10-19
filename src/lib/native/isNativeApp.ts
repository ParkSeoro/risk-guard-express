import { Capacitor } from "@capacitor/core";

/** True inside Capacitor iOS/Android shell (not browser / PWA). */
export function isNativeApp(): boolean {
  try {
    return !!Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/** v2: location must actually be granted before this is marked done. */
const NATIVE_PERMS_KEY = "safenex.nativePermissions.v2";

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

export function clearNativePermissionsDone(): void {
  try {
    localStorage.removeItem(NATIVE_PERMS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * If the OS revoked location after we marked onboarding done (reinstall edge
 * cases, or "허용 안 함" in settings), clear the flag so /native-permissions runs again.
 */
export async function syncNativePermissionsFlagWithOs(): Promise<boolean> {
  if (!isNativeApp()) return true;
  if (!hasCompletedNativePermissions()) return false;
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const { isForegroundLocationGranted } = await import("@/lib/native/nativePermissionGate");
    const cur = await Geolocation.checkPermissions();
    if (!isForegroundLocationGranted(cur)) {
      clearNativePermissionsDone();
      return false;
    }
    return true;
  } catch {
    // Fail open — do not trap users if the plugin is missing.
    return hasCompletedNativePermissions();
  }
}
