import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { batteryPromptResult } from "@/lib/native/batteryOptimization";

describe("batteryPromptResult", () => {
  it("treats an already-unrestricted app as done", () => {
    expect(batteryPromptResult({ ignoring: true })).toBe("already");
  });

  it("waits when the system allow dialog opened", () => {
    expect(batteryPromptResult({ ignoring: false, prompted: true })).toBe("prompted");
  });

  it("does not send older apps into the settings tree", () => {
    expect(batteryPromptResult({ unavailable: true })).toBe("unavailable");
    expect(batteryPromptResult(null)).toBe("unavailable");
    expect(batteryPromptResult({ prompted: false })).toBe("unavailable");
  });
});

describe("HeadlessTrack battery dialog", () => {
  const java = readFileSync(
    resolve(process.cwd(), "capacitor-plugins/headless-track/HeadlessTrackPlugin.java"),
    "utf8",
  );

  it("opens the system ignore-battery dialog", () => {
    expect(java).toContain("ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS");
    expect(java).not.toContain("ACTION_APPLICATION_DETAILS_SETTINGS");
  });
});
