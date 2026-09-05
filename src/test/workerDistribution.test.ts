import { describe, expect, it } from "vitest";
import {
  canViewWorkerDistribution,
  distributionScopeLabel,
} from "@/hooks/useDistributionAccess";
import {
  distributionDotJitter,
  distributionImagePoint,
  distributionZoneId,
  matchDistributionZone,
  zoneCategoryToType,
} from "@/lib/workerDistribution";
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

  it("jitters stacked dots away from the first", () => {
    expect(distributionDotJitter(0)).toEqual({ dx: 0, dy: 0 });
    expect(distributionDotJitter(1).dx).not.toBe(0);
  });
});
