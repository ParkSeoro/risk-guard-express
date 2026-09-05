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

export function isPushGranted(status: { receive?: CapPermissionState }): boolean {
  return status.receive === "granted";
}

/** Only foreground location is a hard gate to leave onboarding. */
export function canMarkNativePermissionsDone(opts: {
  locationGranted: boolean;
}): boolean {
  return opts.locationGranted === true;
}

export const BATTERY_UNRESTRICTED_STEPS_KO = [
  "앱 설정 → 배터리 (삼성: 「제한 없음」)",
  "샤오미 등: 배터리 최적화에서 SafeNex 제외",
  "위치는 「항상 허용」이어야 화면을 꺼도 금지구역이 울립니다",
] as const;

/** Exact taps on the Android system sheet / 앱 설정. */
export const ANDROID_LOCATION_TAP_STEPS_KO = [
  "팝업에서 「정확한 위치」를 켜세요. 「대략적 위치」만으로는 출근이 안 됩니다.",
  "「앱 사용 중에만 허용」이 아니라 「항상 허용」을 누르세요.",
  "안 보이면: 설정 → 위치 → SafeNex → 항상 허용",
] as const;

export const IOS_LOCATION_TAP_STEPS_KO = [
  "「앱을 사용하는 동안」이 아니라 「항상」을 누르세요.",
  "다음에 「정확한 위치」를 켜세요.",
  "안 보이면: 설정 → SafeNex → 위치 → 항상",
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
