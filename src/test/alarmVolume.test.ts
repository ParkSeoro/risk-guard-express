import { describe, expect, it } from "vitest";
import { DANGER_VIBRATE_PATTERN } from "@/lib/alarmHaptics";
import { isAndroidNativeAlarmAvailable } from "@/lib/alarmVolume";

describe("alarm haptics + volume helpers", () => {
  it("danger vibrate pattern is non-empty aggressive waveform", () => {
    expect(DANGER_VIBRATE_PATTERN.length).toBeGreaterThanOrEqual(6);
    expect(DANGER_VIBRATE_PATTERN[0]).toBe(0);
    const vibeMs = DANGER_VIBRATE_PATTERN.filter((_, i) => i % 2 === 1);
    expect(Math.max(...vibeMs)).toBeGreaterThanOrEqual(400);
  });

  it("web/jsdom is not Android native alarm platform", () => {
    expect(isAndroidNativeAlarmAvailable()).toBe(false);
  });
});
