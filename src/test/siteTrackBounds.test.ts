import { describe, expect, it } from "vitest";
import {
  DANGER_PROXIMITY_M,
  isDefinitelyOutsideSite,
  SITE_EXIT_STREAK,
  SITE_TRACK_EXIT_M,
  SITE_TRACK_MAX_M,
  SITE_TRACK_RESUME_M,
} from "@/lib/tracking/siteTrackBounds";
import { minDistanceToRestrictedZoneEdge } from "@/lib/tracking/restrictedZoneGeom";

describe("siteTrackBounds", () => {
  it("uses a wide default fence (not 100m office pin)", () => {
    expect(SITE_TRACK_EXIT_M).toBeGreaterThanOrEqual(400);
    expect(SITE_TRACK_RESUME_M).toBeLessThan(SITE_TRACK_EXIT_M);
    expect(SITE_TRACK_MAX_M).toBeGreaterThan(SITE_TRACK_EXIT_M);
    expect(SITE_EXIT_STREAK).toBeGreaterThanOrEqual(3);
    expect(DANGER_PROXIMITY_M).toBeGreaterThan(30);
  });

  it("does not treat poor accuracy as outside", () => {
    const fence = { lat: 37.5, lng: 127.0, radiusM: 500 };
    // ~600m north
    const r = isDefinitelyOutsideSite(fence, 37.5054, 127.0, 80);
    expect(r.outside).toBe(false);
  });

  it("flags clear outside beyond fence + accuracy pad", () => {
    const fence = { lat: 37.5, lng: 127.0, radiusM: 500 };
    const r = isDefinitelyOutsideSite(fence, 37.51, 127.0, 20); // ~1.1km
    expect(r.outside).toBe(true);
    expect(r.distanceM).toBeGreaterThan(500);
  });

  it("keeps on-site points inside", () => {
    const fence = { lat: 37.5, lng: 127.0, radiusM: 500 };
    const r = isDefinitelyOutsideSite(fence, 37.501, 127.0, 15); // ~111m
    expect(r.outside).toBe(false);
  });
});

describe("minDistanceToRestrictedZoneEdge", () => {
  it("returns 0 inside radius zone", () => {
    const d = minDistanceToRestrictedZoneEdge(37.5, 127.0, [
      {
        id: "z1",
        name: "A",
        geometry_type: "radius",
        geo_polygon: null,
        center_lat: 37.5,
        center_lng: 127.0,
        radius_m: 20,
        banned_worker_ids: null,
        banned_company_ids: null,
        banned_job_types: null,
      },
    ]);
    expect(d).toBe(0);
  });

  it("returns positive distance outside", () => {
    const d = minDistanceToRestrictedZoneEdge(37.501, 127.0, [
      {
        id: "z1",
        name: "A",
        geometry_type: "radius",
        geo_polygon: null,
        center_lat: 37.5,
        center_lng: 127.0,
        radius_m: 20,
        banned_worker_ids: null,
        banned_company_ids: null,
        banned_job_types: null,
      },
    ]);
    expect(d).toBeGreaterThan(50);
  });
});
