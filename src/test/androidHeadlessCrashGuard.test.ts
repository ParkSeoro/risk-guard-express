import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  resolve(process.cwd(), "capacitor-plugins/headless-track/HeadlessTrackService.java"),
  "utf8",
);
const alarm = readFileSync(
  resolve(process.cwd(), "capacitor-plugins/alarm-volume/AlarmVolumePlugin.java"),
  "utf8",
);

describe("HeadlessTrackService crash-loop guards", () => {
  it("does not sticky-restart when startForeground fails", () => {
    expect(service).toContain("startForeground failed");
    expect(service).toMatch(/if \(!startAsForeground\(\)\)[\s\S]*return START_NOT_STICKY/);
  });

  it("never requests GPS without a usable-provider check", () => {
    expect(service).toContain("providerUsable");
    expect(service).toContain("requestSafe(LocationManager.GPS_PROVIDER");
    expect(service).not.toMatch(
      /locationManager\.requestLocationUpdates\(\s*LocationManager\.GPS_PROVIDER/,
    );
  });

  it("swallows location callbacks after the executor is shut down", () => {
    expect(service).toContain("drop location after shutdown");
    expect(service).toContain("private volatile boolean running");
  });
});

describe("AlarmVolumePlugin activity-null guard", () => {
  it("does not call getActivity().runOnUiThread without a null check", () => {
    expect(alarm).not.toMatch(/getActivity\(\)\.runOnUiThread/);
    expect(alarm).toContain("private void runOnUi");
  });
});
