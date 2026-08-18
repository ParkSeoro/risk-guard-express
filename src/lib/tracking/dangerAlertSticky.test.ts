import { afterEach, describe, expect, it } from "vitest";
import {
  clearStickyDangerAlert,
  isLiveRestrictedZoneId,
  loadStickyDangerAlert,
  saveStickyDangerAlert,
  shouldRestoreStickyDangerAlert,
} from "@/lib/tracking/dangerAlertSticky";

describe("sticky danger alert restore", () => {
  afterEach(() => {
    clearStickyDangerAlert();
  });

  const zones = [{ id: "z-live" }, { id: "z-other" }];

  it("rejects deleted / placeholder zone ids", () => {
    expect(isLiveRestrictedZoneId("z-gone", zones)).toBe(false);
    expect(isLiveRestrictedZoneId("zone", zones)).toBe(false);
    expect(isLiveRestrictedZoneId("z-live", zones)).toBe(true);
  });

  it("does not restore from sessionStorage alone", () => {
    saveStickyDangerAlert({
      projectId: "p1",
      zoneId: "z-live",
      zoneName: "굴착구",
      at: Date.now(),
    });
    const sticky = loadStickyDangerAlert("p1");
    expect(
      shouldRestoreStickyDangerAlert({
        sticky,
        liveZones: zones,
        gpsInsideZoneId: undefined,
      }),
    ).toBe(false);
  });

  it("does not restore when the zone was deleted from the map", () => {
    const sticky = {
      projectId: "p1",
      zoneId: "z-deleted",
      zoneName: "옛 위험구역",
      at: Date.now(),
    };
    expect(
      shouldRestoreStickyDangerAlert({
        sticky,
        liveZones: zones,
        gpsInsideZoneId: "z-deleted",
      }),
    ).toBe(false);
  });

  it("restores only when GPS is still inside the live zone", () => {
    const sticky = {
      projectId: "p1",
      zoneId: "z-live",
      zoneName: "굴착구",
      at: Date.now(),
    };
    expect(
      shouldRestoreStickyDangerAlert({
        sticky,
        liveZones: zones,
        gpsInsideZoneId: "z-other",
      }),
    ).toBe(false);
    expect(
      shouldRestoreStickyDangerAlert({
        sticky,
        liveZones: zones,
        gpsInsideZoneId: "z-live",
      }),
    ).toBe(true);
  });
});
