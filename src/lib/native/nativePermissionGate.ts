/** Pure helpers for native OS-permission onboarding. No Capacitor imports. */

export type CapPermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | "prompt-with-rationale"
  | string;

export function isForegroundLocationGranted(status: {
  location?: CapPermissionState;
  coarseLocation?: CapPermissionState;
}): boolean {
  // Fine location is required for check-in / geofence. Coarse-only is not enough.
  return status.location === "granted";
}

/**
 * `prompt` is not a denial. Treating it as false greys out 출근하기
 * so the worker can never tap to open the system permission sheet.
 */
export function locationPermissionTriState(status: {
  location?: CapPermissionState;
  coarseLocation?: CapPermissionState;
}): boolean | null {
  if (status.location === "granted") return true;
  if (status.location === "denied") return false;
  return null;
}

export function isPushGranted(status: { receive?: CapPermissionState }): boolean {
  return status.receive === "granted";
}

/**
 * Android keeps foreground location as a hard gate to leave onboarding.
 * On iOS (App Store Guideline 5.1.1(iv)), users must be able to proceed even if
 * they decline permission; location-dependent features inform them and link to Settings.
 */
export function canMarkNativePermissionsDone(opts: {
  locationGranted: boolean;
  platform?: "android" | "ios" | "web" | string;
}): boolean {
  if (opts.platform === "ios") return true;
  return opts.locationGranted === true;
}

/** Shown above the one-tap system Allow dialog. No settings-menu path. */
export const BATTERY_ALLOW_DIALOG_KO = "다음 창에서 허용을 누르세요.";

/** Exact taps on the Android system sheet / 앱 설정. */
export const ANDROID_LOCATION_TAP_STEPS_KO = [
  "팝업에서 「정확한 위치」를 켜세요. 「대략적 위치」만으로는 출근이 안 됩니다.",
  "「앱 사용 중에만 허용」이 아니라 「항상 허용」을 누르세요.",
  "안 보이면: 설정 → 위치 → SafeNex → 항상 허용",
] as const;

/**
 * iOS pre-permission guidance must remain neutral (App Store Guideline 5.1.1(iv)):
 * explain why location is used without directing users to tap "Allow".
 */
export const IOS_LOCATION_TAP_STEPS_KO = [
  "위치 정보는 현장 출근 확인과 위험구역 안전 알림에 사용됩니다.",
  "권한 허용 여부는 다음 화면에서 직접 선택할 수 있습니다.",
  "권한은 언제든지 기기 설정 → SafeNex → 위치에서 변경할 수 있습니다.",
] as const;

export function locationTapStepsKo(platform: "android" | "ios" | "web"): readonly string[] {
  if (platform === "ios") return IOS_LOCATION_TAP_STEPS_KO;
  if (platform === "web") {
    return ["브라우저/PWA는 화면을 끄면 점이 멈춥니다. Play에서 앱을 설치하고 위치를 「항상 허용」하세요."];
  }
  return ANDROID_LOCATION_TAP_STEPS_KO;
}

/** Check-in needs a live fix. Denied OS location is a hard stop. */
export function checkInBlockedByLocation(opts: {
  osLocationGranted: boolean | null;
  hasFix: boolean;
}): { blocked: boolean; reason: "os" | "fix" | null } {
  if (opts.osLocationGranted === false) return { blocked: true, reason: "os" };
  if (!opts.hasFix) return { blocked: true, reason: "fix" };
  return { blocked: false, reason: null };
}

/** Home coach: denied OS, or checked-in and still needs the Always-allow reminder. */
export function shouldShowGpsConsentCoach(opts: {
  osLocationGranted: boolean | null;
  isCheckedIn: boolean;
  alwaysAllowDismissedToday: boolean;
}): boolean {
  if (opts.osLocationGranted === false) return true;
  if (opts.isCheckedIn && !opts.alwaysAllowDismissedToday) return true;
  return false;
}
