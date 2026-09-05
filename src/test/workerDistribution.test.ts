import { describe, expect, it } from "vitest";
import {
  canViewWorkerDistribution,
  distributionScopeLabel,
} from "@/hooks/useDistributionAccess";
import {
  assignCheckedInDistribution,
  classifyDistributionFix,
  defaultGeneralZone,
  distributionDotJitter,
  distributionFixLabel,
  distributionImagePoint,
  distributionZoneId,
  matchDistributionZone,
  resolveDistributionZone,
  summarizeDistributionFixes,
  zoneCategoryToType,
} from "@/lib/workerDistribution";
import { GPS_DELAYED_MS, GPS_LIVE_MS } from "@/lib/tracking/gpsTrackingHealth";
import type { RestrictedZoneGeom } from "@/lib/tracking/restrictedZoneGeom";

describe("distribution access", () => {
  it("hides the map from field workers", () => {
    expect(canViewWorkerDistribution("worker")).toBe(false);
    expect(canViewWorkerDistribution("contractor")).toBe(false);
    expect(canViewWorkerDistribution("project_admin")).toBe(true);
    expect(canViewWorkerDistribution("safety_manager")).toBe(true);
    expect(canViewWorkerDistribution("site_supervisor")).toBe(true);
    expect(canViewWorkerDistribution("viewer", true)).toBe(true);
  });

  it("labels company scope", () => {
    expect(distributionScopeLabel({ isMaster: true })).toBe("전체 현장");
    expect(
      distributionScopeLabel({ role: "project_admin", companyType: "client", seesAll: true }),
    ).toBe("전체 현장");
    expect(distributionScopeLabel({ role: "project_admin", companyType: "gc" })).toBe("자사·협력사");
    expect(distributionScopeLabel({ role: "site_manager", companyType: "contractor" })).toBe("자사만");
  });
});

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
    expect(zoneCategoryToType("일반")).toBe("normal");
    expect(zoneCategoryToType(null)).toBe("normal");
  });

  it("auto-assigns GPS to a drawn work zone (not per-worker)", () => {
    const work: RestrictedZoneGeom = {
      id: "work-1",
      name: "작업구역",
      geometry_type: "polygon",
      geo_polygon: [
        { lat: 34.8513, lng: 127.7003 },
        { lat: 34.8513, lng: 127.7008 },
        { lat: 34.8517, lng: 127.7008 },
        { lat: 34.8517, lng: 127.7003 },
      ],
      center_lat: null,
      center_lng: null,
      radius_m: null,
      banned_worker_ids: [],
      banned_company_ids: [],
      banned_job_types: [],
      zone_category: "작업구역",
      is_active: true,
    };
    expect(matchDistributionZone(34.8515221, 127.700508, [work])?.id).toBe("work-1");
    expect(matchDistributionZone(37.5, 127.0, [work])).toBeNull();
  });

  it("treats the whole sitemap as 일반 — check-in GPS outside the drawn box is not 미지정", () => {
    const general: RestrictedZoneGeom = {
      id: "gen-1",
      name: "일반구역",
      geometry_type: "polygon",
      geo_polygon: [
        { lat: 34.8522, lng: 127.7006 },
        { lat: 34.8522, lng: 127.7012 },
        { lat: 34.8528, lng: 127.7012 },
        { lat: 34.8528, lng: 127.7006 },
      ],
      center_lat: null,
      center_lng: null,
      radius_m: null,
      banned_worker_ids: [],
      banned_company_ids: [],
      banned_job_types: [],
      zone_category: "일반",
      is_active: true,
    };
    const work: RestrictedZoneGeom = {
      ...general,
      id: "work-1",
      name: "작업구역",
      zone_category: "작업구역",
      geo_polygon: [
        { lat: 34.8513, lng: 127.7003 },
        { lat: 34.8513, lng: 127.7008 },
        { lat: 34.8517, lng: 127.7008 },
        { lat: 34.8517, lng: 127.7003 },
      ],
    };
    expect(defaultGeneralZone([work, general])?.id).toBe("gen-1");
    expect(resolveDistributionZone(34.85145, 127.70045, [general, work])?.id).toBe("work-1");
    expect(resolveDistributionZone(34.85145, 127.70045, [general])?.id).toBe("gen-1");
    const rows = assignCheckedInDistribution({
      companyTotals: [
        { companyId: "c1", name: "A", total: 50 },
        { companyId: "c2", name: "B", total: 5 },
      ],
      positions: [
        { company_id: "c1", lat: 34.85145, lng: 127.70045 },
        { company_id: "c1", lat: 37.5, lng: 127.0 },
      ],
      zones: [general, work],
    });
    expect(rows.find((r) => r.zoneId === "work-1")?.count).toBe(1);
    expect(rows.find((r) => r.companyId === "c1" && r.zoneId === "gen-1")?.count).toBe(49);
    expect(rows.find((r) => r.companyId === "c2" && r.zoneId === "gen-1")?.count).toBe(5);
    expect(rows.some((r) => r.zoneId == null)).toBe(false);
  });

  it("jitters stacked dots away from the first", () => {
    expect(distributionDotJitter(0)).toEqual({ dx: 0, dy: 0 });
    expect(distributionDotJitter(1).dx).not.toBe(0);
  });
});

describe("classifyDistributionFix", () => {
  const now = Date.parse("2026-09-05T09:30:00+09:00");

  it("treats a fresh check-in as live, then as 출근 위치", () => {
    expect(
      classifyDistributionFix({
        source: "checkin",
        updatedAt: new Date(now - 2 * 60_000).toISOString(),
        now,
      }),
    ).toBe("live");
    expect(
      classifyDistributionFix({
        source: "checkin",
        updatedAt: new Date(now - GPS_LIVE_MS - 1).toISOString(),
        now,
      }),
    ).toBe("checkin");
    expect(distributionFixLabel("checkin")).toBe("출근 위치");
  });

  it("keeps later GPS as recent until 30 minutes, then stale", () => {
    expect(
      classifyDistributionFix({
        source: "gps",
        updatedAt: new Date(now - 12 * 60_000).toISOString(),
        now,
      }),
    ).toBe("recent");
    expect(
      classifyDistributionFix({
        source: "gps",
        updatedAt: new Date(now - GPS_DELAYED_MS - 1).toISOString(),
        now,
      }),
    ).toBe("stale");
  });

  it("counts missing check-ins separately from plotted dots", () => {
    const sum = summarizeDistributionFixes(
      [
        { source: "checkin", updated_at: new Date(now - 2 * 3600_000).toISOString() },
        { source: "gps", updated_at: new Date(now - 60_000).toISOString() },
      ],
      now,
      55,
    );
    expect(sum.live).toBe(1);
    expect(sum.checkin).toBe(1);
    expect(sum.plotted).toBe(2);
    expect(sum.missing).toBe(53);
  });
});
