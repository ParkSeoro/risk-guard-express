import { describe, expect, it } from "vitest";
import {
  BATTERY_UNRESTRICTED_STEPS_KO,
  canMarkNativePermissionsDone,
  isForegroundLocationGranted,
  isPushGranted,
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
});
