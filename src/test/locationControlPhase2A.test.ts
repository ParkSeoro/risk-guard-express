import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LOCATION_CONTROL_TABS,
  summarizeLocationControlKpis,
} from "@/lib/locationControlSummary";
import { isAllowedForContractor } from "@/lib/contractorRouteAccess";

describe("PR 2-A: Shared LocationControlBar & TrackingHealth/ZoneEvents role alignment", () => {
  describe("summarizeLocationControlKpis", () => {
    it("computes distinct on-site sum, GPS live percentage, unack danger count, and alarming zone count", () => {
      const res = summarizeLocationControlKpis({
        distributionRows: [
          { headcount: 12 },
          { headcount: "8" },
          { headcount: -3 },
          { headcount: null },
        ],
        trackingRows: [
          { bucket: "live" },
          { bucket: "live" },
          { bucket: "live" },
          { bucket: "delayed" },
          { bucket: "disconnected" },
        ],
        unackDangerCount: 2,
        restrictedZones: [
          { is_active: true, is_deleted: false, zone_category: "추락위험" },
          { is_active: true, is_deleted: false, zone_category: "화재위험" },
          // Korean presence categories must not count as alarming danger zones
          { is_active: true, is_deleted: false, zone_category: "일반" },
          { is_active: true, is_deleted: false, zone_category: "작업구역" },
          { is_active: false, is_deleted: false, zone_category: "추락위험" },
          { is_active: true, is_deleted: true, zone_category: "밀폐공간" },
        ],
      });

      expect(res).toEqual({
        onSiteCount: 20,
        trackingTotal: 5,
        trackingLive: 3,
        trackingDelayed: 1,
        trackingDisconnected: 1,
        trackingLivePct: 60,
        unackDangerCount: 2,
        activeDangerZoneCount: 2,
      });
    });

    it("returns null percentage and zero counts when site has no active workers or zones", () => {
      const res = summarizeLocationControlKpis({
        distributionRows: [],
        trackingRows: [],
        unackDangerCount: 0,
        restrictedZones: [],
      });
      expect(res.onSiteCount).toBe(0);
      expect(res.trackingTotal).toBe(0);
      expect(res.trackingLivePct).toBeNull();
      expect(res.unackDangerCount).toBe(0);
      expect(res.activeDangerZoneCount).toBe(0);
    });

    it("preserves null for failed queries so errors never masquerade as 0", () => {
      const res = summarizeLocationControlKpis({
        distributionRows: null,
        trackingRows: null,
        unackDangerCount: null,
        restrictedZones: null,
      });
      expect(res).toEqual({
        onSiteCount: null,
        trackingTotal: null,
        trackingLive: null,
        trackingDelayed: null,
        trackingDisconnected: null,
        trackingLivePct: null,
        unackDangerCount: null,
        activeDangerZoneCount: null,
      });
    });
  });

  describe("Location control tabs & role guards (multi-project hardened)", () => {
    it("exposes all 3 location monitoring tabs", () => {
      expect(LOCATION_CONTROL_TABS.map((t) => t.to)).toEqual([
        "/app/admin/worker-distribution",
        "/app/admin/zone-events",
        "/app/admin/admin/tracking-health",
      ]);
    });

    it("opens /admin/tracking-health to contractor managers while keeping setup routes blocked", () => {
      expect(isAllowedForContractor("/app/admin/admin/tracking-health")).toBe(true);
      expect(isAllowedForContractor("/admin/tracking-health")).toBe(true);
      expect(isAllowedForContractor("/app/admin/site-control-map")).toBe(false);
      expect(isAllowedForContractor("/app/admin/settings")).toBe(false);
      expect(isAllowedForContractor("/app/admin/safety-cost")).toBe(false);
    });

    it("enforces management RoleGuard + active-project canView guard on location routes and screens", () => {
      const routesSrc = readFileSync("src/routes/AdminAppRoutes.tsx", "utf8").replace(/\r\n/g, "\n");
      const zoneIdx = routesSrc.indexOf('path="zone-events"');
      const healthIdx = routesSrc.indexOf('path="admin/tracking-health"');
      expect(zoneIdx).toBeGreaterThan(-1);
      expect(healthIdx).toBeGreaterThan(-1);
      const zoneBlock = routesSrc.slice(zoneIdx, zoneIdx + 360);
      const healthBlock = routesSrc.slice(healthIdx, healthIdx + 360);
      for (const block of [zoneBlock, healthBlock]) {
        expect(block).toContain("RoleGuard");
        expect(block).toContain("allowContractorCompany");
        expect(block).toContain('"site_manager"');
        expect(block).toContain('"site_supervisor"');
      }

      const zoneSrc = readFileSync("src/pages/ZoneEvents.tsx", "utf8").replace(/\r\n/g, "\n");
      const healthSrc = readFileSync("src/pages/AdminTrackingHealth.tsx", "utf8").replace(/\r\n/g, "\n");
      expect(zoneSrc).toContain("canViewWorkerDistribution(access?.userRole, isMaster)");
      expect(healthSrc).toContain("canViewWorkerDistribution(userRole, isMaster)");
    });

    it("enforces active-project management role_new inside all 3 location RPCs in SQL migration", () => {
      const sql = readFileSync(
        "supabase/migrations/20261122142000_location_rpcs_project_role_guard.sql",
        "utf8",
      ).replace(/\r\n/g, "\n");
      for (const fn of [
        "public.get_gps_tracking_health",
        "public.get_worker_distribution_counts",
        "public.get_worker_distribution_positions",
      ]) {
        const idx = sql.indexOf(fn);
        expect(idx).toBeGreaterThan(-1);
        const body = sql.slice(idx, idx + 1500);
        expect(body).toContain("pm.role_new::text IN");
        expect(body).toContain("'site_supervisor'");
        expect(body).toContain("RAISE EXCEPTION 'FORBIDDEN'");
      }
    });

    it("mounts LocationControlBar across all 3 location screens and adds distribution CTA on SiteControlMap", () => {
      const distSrc = readFileSync("src/pages/WorkerDistribution.tsx", "utf8").replace(/\r\n/g, "\n");
      const zoneSrc = readFileSync("src/pages/ZoneEvents.tsx", "utf8").replace(/\r\n/g, "\n");
      const healthSrc = readFileSync("src/pages/AdminTrackingHealth.tsx", "utf8").replace(/\r\n/g, "\n");
      const mapSrc = readFileSync("src/pages/SiteControlMap.tsx", "utf8").replace(/\r\n/g, "\n");

      expect(distSrc).toContain("<LocationControlBar");
      expect(distSrc).toContain("showManageLink={!isContractorCo}");
      expect(zoneSrc).toContain("<LocationControlBar");
      expect(healthSrc).toContain("<LocationControlBar");
      expect(mapSrc).toContain("편집 전용");
      expect(mapSrc).toContain("/app/admin/worker-distribution");
    });

    it("documents Phase 2-A location role alignment in docs/access-policy.md", () => {
      const doc = readFileSync("docs/access-policy.md", "utf8").replace(/\r\n/g, "\n");
      expect(doc).toContain("위치 관제 3화면(`/worker-distribution`, `/zone-events`, `/admin/tracking-health`)");
      expect(doc).toContain("선택 현장의 관리 역할");
    });
  });
});
