import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  projectRadiusZoneToUvPolygon,
  type DistributionCorners,
} from "@/lib/workerDistribution";
import { isAllowedForContractor } from "@/lib/contractorRouteAccess";

const CORNERS: DistributionCorners = {
  tl: { lat: 37.501, lng: 127.0 },
  tr: { lat: 37.501, lng: 127.002 },
  bl: { lat: 37.499, lng: 127.0 },
};

describe("PR 1-E: Distribution radius projection & contractor PC location access", () => {
  describe("projectRadiusZoneToUvPolygon", () => {
    it("projects a valid WGS84 circle into a closed UV ring inside 0..1", () => {
      const ring = projectRadiusZoneToUvPolygon(37.5, 127.001, 30, CORNERS, 16);
      expect(ring.length).toBe(16);
      const avgX = ring.reduce((s, p) => s + p.x, 0) / ring.length;
      const avgY = ring.reduce((s, p) => s + p.y, 0) / ring.length;
      expect(avgX).toBeCloseTo(0.5, 2);
      expect(avgY).toBeCloseTo(0.5, 2);
      // Radius 30m should span > 0 in both x and y
      const xs = ring.map((p) => p.x);
      const ys = ring.map((p) => p.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.1);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.1);
    });

    it("returns empty array for invalid center or non-positive radius", () => {
      expect(projectRadiusZoneToUvPolygon(37.5, 127.001, 0, CORNERS)).toEqual([]);
      expect(projectRadiusZoneToUvPolygon(37.5, 127.001, -10, CORNERS)).toEqual([]);
      expect(projectRadiusZoneToUvPolygon(Number.NaN, 127.001, 20, CORNERS)).toEqual([]);
    });
  });

  describe("ContractorGate & AppSidebar PC alignment", () => {
    it("allows contractor admins to open /worker-distribution and /zone-events on PC", () => {
      expect(isAllowedForContractor("/app/admin/worker-distribution")).toBe(true);
      expect(isAllowedForContractor("/worker-distribution")).toBe(true);
      expect(isAllowedForContractor("/app/admin/zone-events")).toBe(true);
      expect(isAllowedForContractor("/app/admin/zone-events?project=abc")).toBe(true);
      // Still blocks admin-only site setup & tracking-health in Phase 1
      expect(isAllowedForContractor("/app/admin/site-control-map")).toBe(false);
      expect(isAllowedForContractor("/app/admin/admin/tracking-health")).toBe(false);
    });

    it("wires radius projection in WorkerDistribution and contractor menu in AppSidebar", () => {
      const distSrc = readFileSync("src/pages/WorkerDistribution.tsx", "utf8").replace(/\r\n/g, "\n");
      const sidebarSrc = readFileSync("src/components/AppSidebar.tsx", "utf8").replace(/\r\n/g, "\n");
      expect(distSrc).toContain("projectRadiusZoneToUvPolygon");
      expect(sidebarSrc).toContain("canViewContractorLocation");
      expect(sidebarSrc).toContain("'/worker-distribution', '/zone-events'");
    });
  });
});
