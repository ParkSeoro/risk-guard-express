import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  backgroundFixesPerShiftHours,
  defaultTrackerIntervals,
  TRACK_BG_DISTANCE_FILTER_M,
  TRACK_BG_HEARTBEAT_MS,
  TRACK_FG_ECO_IDLE_MS,
} from "@/lib/tracking/trackPowerPolicy";

describe("track power policy", () => {
  it("uses a 3-minute background heartbeat, not 45s all day", () => {
    expect(TRACK_BG_HEARTBEAT_MS).toBe(180_000);
    expect(TRACK_BG_HEARTBEAT_MS).toBe(TRACK_FG_ECO_IDLE_MS);
    expect(backgroundFixesPerShiftHours(8)).toBe(160);
    expect(backgroundFixesPerShiftHours(8)).toBeLessThan(640);
  });

  it("keeps foreground danger/near faster than the background heartbeat", () => {
    const i = defaultTrackerIntervals();
    expect(i.danger).toBeLessThan(TRACK_BG_HEARTBEAT_MS);
    expect(i.moving).toBeLessThan(TRACK_BG_HEARTBEAT_MS);
    expect(i.ecoIdle).toBe(TRACK_BG_HEARTBEAT_MS);
  });

  it("keeps the Android service default in lockstep", () => {
    const service = readFileSync(
      resolve(process.cwd(), "capacitor-plugins/headless-track/HeadlessTrackService.java"),
      "utf8",
    );
    const plugin = readFileSync(
      resolve(process.cwd(), "capacitor-plugins/headless-track/HeadlessTrackPlugin.java"),
      "utf8",
    );
    const activity = readFileSync(
      resolve(process.cwd(), "capacitor-plugins/alarm-volume/MainActivity.java"),
      "utf8",
    );
    const tracker = readFileSync(
      resolve(process.cwd(), "src/lib/tracking/locationTracker.ts"),
      "utf8",
    );
    expect(service).toContain("interval_ms\", 180_000");
    expect(service).toContain("watchMode ? 40f : 15f");
    expect(plugin).toContain("public void arm(");
    expect(plugin).toContain("call.getBoolean(\"disarm\")");
    expect(activity).toContain("onTaskRemoved");
    expect(activity).toContain("HeadlessTrackService.ACTION_START");
    expect(tracker).toContain("TRACK_BG_HEARTBEAT_MS");
    expect(tracker).toContain("armHeadlessCompanion");
    expect(tracker).toContain("distanceFilter: TRACK_BG_DISTANCE_FILTER_M");
    expect(TRACK_BG_DISTANCE_FILTER_M).toBe(30);
  });
});
