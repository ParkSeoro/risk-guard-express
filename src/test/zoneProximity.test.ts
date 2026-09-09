import { describe, expect, it } from "vitest";
import type { RestrictedZoneGeom } from "@/lib/tracking/restrictedZoneGeom";
import {
  classifyZoneTier,
  findZoneProximity,
  formatApproachDistance,
  parseZoneBufferInput,
  zoneBufferM,
} from "@/lib/tracking/zoneProximity";

function radiusZone(over: Partial<RestrictedZoneGeom> = {}): RestrictedZoneGeom {
  return {
    id: "z1",
    name: "굴착구",
    geometry_type: "radius",
    geo_polygon: null,
    center_lat: 37.5,
    center_lng: 127.0,
    radius_m: 50,
    banned_worker_ids: [],
    banned_company_ids: [],
    banned_job_types: [],
    ...over,
  };
}

function offsetMeters(origin: { lat: number; lng: number }, northM: number, eastM: number) {
  const lat0 = (origin.lat * Math.PI) / 180;
  return {
    lat: origin.lat + northM / 111_195,
    lng: origin.lng + eastM / (111_195 * Math.cos(lat0)),
  };
}

describe("zoneBufferM", () => {
  it("defaults NULL to 25m and treats 0 as no buffer", () => {
    expect(zoneBufferM(null)).toBe(25);
    expect(zoneBufferM(undefined)).toBe(25);
    expect(zoneBufferM(0)).toBe(0);
    expect(zoneBufferM(40)).toBe(40);
    expect(zoneBufferM(999)).toBe(200);
    expect(zoneBufferM(-4)).toBe(0);
  });

  it("parses editor input", () => {
    expect(parseZoneBufferInput("")).toEqual({ ok: true, value: null });
    expect(parseZoneBufferInput("0")).toEqual({ ok: true, value: 0 });
    expect(parseZoneBufferInput("25")).toEqual({ ok: true, value: 25 });
    expect(parseZoneBufferInput("201")).toEqual({ ok: false });
    expect(parseZoneBufferInput("x")).toEqual({ ok: false });
  });
});

describe("classifyZoneTier", () => {
  it("core / buffer / outside", () => {
    expect(classifyZoneTier(0, 25)).toBe("core");
    expect(classifyZoneTier(12, 25)).toBe("buffer");
    expect(classifyZoneTier(25, 25)).toBe("buffer");
    expect(classifyZoneTier(26, 25)).toBe("outside");
    expect(classifyZoneTier(5, 0)).toBe("outside");
  });
});

describe("findZoneProximity", () => {
  const center = { lat: 37.5, lng: 127.0 };

  it("reports buffer when outside the core but inside the ring", () => {
    const here = offsetMeters(center, 60, 0); // 10m outside a 50m radius
    const hit = findZoneProximity(here.lat, here.lng, [radiusZone()], {});
    expect(hit?.tier).toBe("buffer");
    expect(hit?.distanceM).toBeGreaterThan(8);
    expect(hit?.distanceM).toBeLessThan(14);
  });

  it("core beats a nearer buffer zone", () => {
    const here = offsetMeters(center, 5, 0);
    const core = radiusZone({ id: "core", radius_m: 20 });
    const ring = radiusZone({
      id: "ring",
      center_lat: offsetMeters(center, 40, 0).lat,
      radius_m: 10,
      buffer_m: 50,
    });
    const hit = findZoneProximity(here.lat, here.lng, [ring, core], {});
    expect(hit?.zone.id).toBe("core");
    expect(hit?.tier).toBe("core");
  });

  it("nearer buffer wins when both are rings", () => {
    const here = offsetMeters(center, 70, 0);
    const far = radiusZone({ id: "far", buffer_m: 40 });
    const near = radiusZone({
      id: "near",
      center_lat: offsetMeters(center, 80, 0).lat,
      radius_m: 5,
      buffer_m: 40,
    });
    const hit = findZoneProximity(here.lat, here.lng, [far, near], {});
    expect(hit?.zone.id).toBe("near");
    expect(hit?.tier).toBe("buffer");
  });

  it("skips inactive, presence, and not-banned zones", () => {
    const here = offsetMeters(center, 55, 0);
    expect(
      findZoneProximity(here.lat, here.lng, [radiusZone({ is_active: false })], {}),
    ).toBeNull();
    expect(
      findZoneProximity(here.lat, here.lng, [radiusZone({ zone_category: "작업구역" })], {}),
    ).toBeNull();
    expect(
      findZoneProximity(
        here.lat,
        here.lng,
        [radiusZone({ banned_company_ids: ["c1"] })],
        { company_id: "c2" },
      ),
    ).toBeNull();
  });

  it("buffer_m 0 disables the approach ring", () => {
    const here = offsetMeters(center, 60, 0);
    expect(findZoneProximity(here.lat, here.lng, [radiusZone({ buffer_m: 0 })], {})).toBeNull();
  });
});

describe("formatApproachDistance", () => {
  it("quotes meters only when accuracy is better than the distance", () => {
    expect(formatApproachDistance(20, 10)).toBe("약 20m 앞");
    expect(formatApproachDistance(20, 20)).toBe("근처");
    expect(formatApproachDistance(12, 40)).toBe("근처");
    expect(formatApproachDistance(0, 8)).toBe("내부");
    expect(formatApproachDistance(18, null)).toBe("근처");
  });
});
