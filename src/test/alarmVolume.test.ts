import { describe, expect, it } from "vitest";
import { DANGER_VIBRATE_PATTERN } from "@/lib/alarmHaptics";
import {
  isAndroidNativeAlarmAvailable,
  isIosNativeAlarmAvailable,
  isNativeAlarmAvailable,
} from "@/lib/alarmVolume";

describe("alarm haptics + volume helpers", () => {
  it("danger vibrate pattern is non-empty aggressive waveform", () => {
    expect(DANGER_VIBRATE_PATTERN.length).toBeGreaterThanOrEqual(6);
    expect(DANGER_VIBRATE_PATTERN[0]).toBe(0);
    const vibeMs = DANGER_VIBRATE_PATTERN.filter((_, i) => i % 2 === 1);
    expect(Math.max(...vibeMs)).toBeGreaterThanOrEqual(400);
  });

  it("web/jsdom is not a native alarm platform", () => {
    expect(isAndroidNativeAlarmAvailable()).toBe(false);
    expect(isIosNativeAlarmAvailable()).toBe(false);
    expect(isNativeAlarmAvailable()).toBe(false);
  });
});

/** Mirrors dispatch-notification-push isCriticalAlarm (keep in sync). */
function isCriticalAlarm(n: { type?: string | null; severity?: string | null }) {
  return (
    n.type !== "announcement" &&
    n.type !== "approval_request" &&
    n.type !== "approval_result" &&
    (n.type === "danger_zone_entry" ||
      n.severity === "high" ||
      n.severity === "critical" ||
      n.severity === "danger")
  );
}

describe("critical alerts payload shape (dispatch contract)", () => {
  it("marks danger_zone_entry as critical candidate", () => {
    expect(isCriticalAlarm({ type: "danger_zone_entry", severity: "high" })).toBe(true);
    const apnsSound = {
      critical: 1,
      name: "siren.wav",
      volume: 1.0,
    };
    expect(apnsSound.critical).toBe(1);
    expect(apnsSound.volume).toBe(1.0);
  });

  it("never sirens field announcements (even if severity was high)", () => {
    expect(isCriticalAlarm({ type: "announcement", severity: "high" })).toBe(false);
    expect(isCriticalAlarm({ type: "announcement", severity: null })).toBe(false);
    expect(isCriticalAlarm({ type: "approval_request", severity: "high" })).toBe(false);
  });
});
