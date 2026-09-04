import { describe, expect, it } from "vitest";
import {
  distributionDotJitter,
  distributionImagePoint,
  distributionZoneId,
  zoneCategoryToType,
} from "@/lib/workerDistribution";

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

describe("distributionImagePoint", () => {
  // GSC 여수 보정맵 (KakaoTalk_20260621_150548581)
  const gsc = {
    tl: { lat: 34.8521088961543, lng: 127.69936804114556 },
    tr: { lat: 34.853486399680634, lng: 127.70123573140279 },
    bl: { lat: 34.8513944003194, lng: 127.7006028685973 },
  };

  it("places this morning's check-in GPS on the GSC photo", () => {
    const p = distributionImagePoint(34.8515221, 127.700508, gsc);
    expect(p).not.toBeNull();
    expect(p!.x).toBeGreaterThan(0);
    expect(p!.x).toBeLessThan(100);
    expect(p!.y).toBeGreaterThan(0);
    expect(p!.y).toBeLessThan(100);
  });

  it("rejects a point far from the site", () => {
    expect(distributionImagePoint(37.5, 127.0, gsc)).toBeNull();
  });
});

describe("zoneCategoryToType / jitter", () => {
  it("maps unified zone categories", () => {
    expect(zoneCategoryToType("공정(위험)구역")).toBe("danger");
    expect(zoneCategoryToType("제한구역")).toBe("restricted");
    expect(zoneCategoryToType("작업구역")).toBe("work");
    expect(zoneCategoryToType(null)).toBe("normal");
  });

  it("jitters stacked dots away from the first", () => {
    expect(distributionDotJitter(0)).toEqual({ dx: 0, dy: 0 });
    expect(distributionDotJitter(1).dx).not.toBe(0);
  });
});
