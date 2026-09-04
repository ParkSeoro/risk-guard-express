import { describe, expect, it } from "vitest";
import { distributionZoneId } from "@/lib/workerDistribution";

describe("distributionZoneId", () => {
  const now = new Date("2026-09-05T07:30:00+09:00");

  it("uses a zone only when the last GPS fix is within 12 hours", () => {
    expect(
      distributionZoneId({
        lastFixAt: "2026-09-05T06:50:00+09:00",
        zoneId: "zone-a",
        now,
      }),
    ).toBe("zone-a");
    expect(
      distributionZoneId({
        lastFixAt: "2026-09-04T18:00:00+09:00",
        zoneId: "zone-a",
        now,
      }),
    ).toBeNull();
    expect(distributionZoneId({ lastFixAt: null, zoneId: "zone-a", now })).toBeNull();
  });
});
