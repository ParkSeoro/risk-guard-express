import { describe, expect, it } from "vitest";
import {
  buildSiteFence,
  DANGER_PROXIMITY_M,
  isDefinitelyOutsideSite,
  SITE_CHECKIN_MAP_PAD_M,
  SITE_CHECKIN_MAX_M,
  SITE_CHECKIN_MIN_M,
  SITE_EXIT_STREAK,
  SITE_TRACK_EXIT_M,
  SITE_TRACK_MAP_PAD_M,
  SITE_TRACK_MAX_M,
  SITE_TRACK_RESUME_M,
} from "@/lib/tracking/siteTrackBounds";
import { calculateDistance } from "@/lib/geo/calculateDistance";
import { minDistanceToRestrictedZoneEdge } from "@/lib/tracking/restrictedZoneGeom";

describe("siteTrackBounds", () => {
  it("uses a wide default fence (not 100m office pin)", () => {
    expect(SITE_TRACK_EXIT_M).toBeGreaterThanOrEqual(400);
    expect(SITE_TRACK_RESUME_M).toBeLessThan(SITE_TRACK_EXIT_M);
    expect(SITE_TRACK_MAX_M).toBeGreaterThan(SITE_TRACK_EXIT_M);
    expect(SITE_EXIT_STREAK).toBeGreaterThanOrEqual(3);
    expect(DANGER_PROXIMITY_M).toBeGreaterThan(30);
  });

  it("check-in prefers site map footprint over distant address pin", () => {
    // Address geocode ~1km away from actual pad (any firm / any project)
    const pinLat = 34.84546;
    const pinLng = 127.70833;
    const maps = [
      {
        geo_transform: {
          tl: { lat: 34.852278670545324, lng: 127.69953668117525 },
          tr: { lat: 34.85320323791904, lng: 127.70101726055147 },
          bl: { lat: 34.85112090954795, lng: 127.70032525062562 },
        },
        geo_anchor_nw_lat: 34.85320323791904,
        geo_anchor_nw_lng: 127.69953668117525,
        geo_anchor_se_lat: 34.85112090954795,
        geo_anchor_se_lng: 127.70180583000185,
      },
    ];
    const fence = buildSiteFence({
      siteLat: pinLat,
      siteLng: pinLng,
      maps,
      minRadiusM: SITE_CHECKIN_MIN_M,
      mapPadM: SITE_CHECKIN_MAP_PAD_M,
      maxRadiusM: SITE_CHECKIN_MAX_M,
    });
    expect(fence.source).toBe("site_map");
    // Worker standing on the pad (phone GPS) must be inside
    const workerLat = 34.85125;
    const workerLng = 127.70013;
    const d = calculateDistance(fence.lat, fence.lng, workerLat, workerLng);
    expect(d).toBeLessThan(fence.radiusM);
    // And must not use the distant address pin as center
    expect(calculateDistance(fence.lat, fence.lng, pinLat, pinLng)).toBeGreaterThan(500);
  });

  it("check-in falls back to 100m address pin when no maps", () => {
    const fence = buildSiteFence({
      siteLat: 37.5,
      siteLng: 127.0,
      maps: [],
      minRadiusM: SITE_CHECKIN_MIN_M,
      mapPadM: SITE_CHECKIN_MAP_PAD_M,
      maxRadiusM: SITE_CHECKIN_MAX_M,
    });
    expect(fence.source).toBe("site_pin");
    expect(fence.lat).toBe(37.5);
    expect(fence.radiusM).toBe(SITE_CHECKIN_MIN_M);
  });

  it("tracking fence centers on map when maps exist", () => {
    const fence = buildSiteFence({
      siteLat: 34.84546,
      siteLng: 127.70833,
      maps: [
        {
          geo_transform: {
            tl: { lat: 34.8523, lng: 127.6995 },
            tr: { lat: 34.8532, lng: 127.7010 },
            bl: { lat: 34.8511, lng: 127.7003 },
          },
        },
      ],
      minRadiusM: SITE_TRACK_EXIT_M,
      mapPadM: SITE_TRACK_MAP_PAD_M,
      maxRadiusM: SITE_TRACK_MAX_M,
    });
    expect(fence.source).toBe("site_map");
    expect(fence.radiusM).toBeGreaterThanOrEqual(SITE_TRACK_EXIT_M);
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
