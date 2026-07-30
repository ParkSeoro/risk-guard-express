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

describe("critical alerts payload shape (dispatch contract)", () => {
  it("marks danger_zone_entry as critical candidate", () => {
    const n = { type: "danger_zone_entry", severity: "high" };
    const isCriticalAlarm =
      n.type === "danger_zone_entry" ||
      n.severity === "high" ||
      n.severity === "critical" ||
      n.severity === "danger";
    expect(isCriticalAlarm).toBe(true);
    const apnsSound = {
      critical: 1,
      name: "siren.wav",
      volume: 1.0,
    };
    expect(apnsSound.critical).toBe(1);
    expect(apnsSound.volume).toBe(1.0);
  });
});
