import { describe, expect, it } from "vitest";
import {
  shouldSkipLegacySiteDangerMatch,
  siteZoneEntryEventType,
} from "@/lib/tracking/zoneAlarmPolicy";

describe("legacy site_zones vs unified restricted_zones SSOT", () => {
  it("skips leftover danger polygons after the unified map was used", () => {
    expect(
      shouldSkipLegacySiteDangerMatch({
        unifiedRestrictedZoneCount: 1,
        siteZoneType: "danger",
      }),
    ).toBe(true);
    expect(
      shouldSkipLegacySiteDangerMatch({
        unifiedRestrictedZoneCount: 1,
        siteZoneType: "restricted",
      }),
    ).toBe(true);
  });

  it("still allows site/work polygons for enter/exit", () => {
    expect(
      shouldSkipLegacySiteDangerMatch({
        unifiedRestrictedZoneCount: 3,
        siteZoneType: "work",
      }),
    ).toBe(false);
  });

  it("keeps legacy GPS sirens only when the project never used the unified map", () => {
    expect(
      siteZoneEntryEventType({ unifiedSsot: false, siteZoneType: "danger" }),
    ).toBe("unauthorized_entry");
    expect(
      siteZoneEntryEventType({ unifiedSsot: true, siteZoneType: "danger" }),
    ).toBe("entry");
    expect(
      siteZoneEntryEventType({ unifiedSsot: true, siteZoneType: "work" }),
    ).toBe("entry");
  });
});
