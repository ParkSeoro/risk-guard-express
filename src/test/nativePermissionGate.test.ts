import { describe, expect, it } from "vitest";
import {
  ANDROID_LOCATION_TAP_STEPS_KO,
  BATTERY_UNRESTRICTED_STEPS_KO,
  canMarkNativePermissionsDone,
  checkInBlockedByLocation,
  isForegroundLocationGranted,
  isPushGranted,
  locationTapStepsKo,
  shouldShowGpsConsentCoach,
} from "@/lib/native/nativePermissionGate";

describe("nativePermissionGate", () => {
  it("requires fine location, not coarse-only", () => {
    expect(isForegroundLocationGranted({ location: "granted" })).toBe(true);
    expect(
      isForegroundLocationGranted({ location: "denied", coarseLocation: "granted" }),
    ).toBe(false);
    expect(isForegroundLocationGranted({ location: "prompt" })).toBe(false);
  });

  it("does not mark onboarding done without location", () => {
    expect(canMarkNativePermissionsDone({ locationGranted: false })).toBe(false);
    expect(canMarkNativePermissionsDone({ locationGranted: true })).toBe(true);
  });

  it("treats push receive granted as allowed", () => {
    expect(isPushGranted({ receive: "granted" })).toBe(true);
    expect(isPushGranted({ receive: "denied" })).toBe(false);
  });

  it("keeps battery copy for Samsung unrestricted", () => {
    expect(BATTERY_UNRESTRICTED_STEPS_KO.some((s) => s.includes("제한 없음"))).toBe(
      true,
    );
  });

  it("tells Android workers to tap 정확한 위치 and 항상 허용", () => {
    expect(ANDROID_LOCATION_TAP_STEPS_KO.some((s) => s.includes("정확한 위치"))).toBe(true);
    expect(ANDROID_LOCATION_TAP_STEPS_KO.some((s) => s.includes("항상 허용"))).toBe(true);
    expect(ANDROID_LOCATION_TAP_STEPS_KO.some((s) => s.includes("앱 사용 중에만"))).toBe(true);
    expect(locationTapStepsKo("ios").some((s) => s.includes("항상"))).toBe(true);
  });

  it("blocks check-in when OS location is denied", () => {
    expect(checkInBlockedByLocation({ osLocationGranted: false, hasFix: true })).toEqual({
      blocked: true,
      reason: "os",
    });
    expect(checkInBlockedByLocation({ osLocationGranted: true, hasFix: false })).toEqual({
      blocked: true,
      reason: "fix",
    });
    expect(checkInBlockedByLocation({ osLocationGranted: true, hasFix: true }).blocked).toBe(false);
  });

  it("shows the home coach when permission is denied or after check-in", () => {
    expect(
      shouldShowGpsConsentCoach({
        osLocationGranted: false,
        isCheckedIn: false,
        alwaysAllowDismissedToday: true,
      }),
    ).toBe(true);
    expect(
      shouldShowGpsConsentCoach({
        osLocationGranted: true,
        isCheckedIn: true,
        alwaysAllowDismissedToday: false,
      }),
    ).toBe(true);
    expect(
      shouldShowGpsConsentCoach({
        osLocationGranted: true,
        isCheckedIn: true,
        alwaysAllowDismissedToday: true,
      }),
    ).toBe(false);
  });
});
