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
