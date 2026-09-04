import { describe, expect, it } from "vitest";
import {
  findViolatingRestrictedZone,
  isSubjectBanned,
  minDistanceToRestrictedZoneEdge,
  pointInRestrictedZone,
  pointToSegmentM,
} from "@/lib/tracking/restrictedZoneGeom";

describe("restrictedZoneGeom", () => {
  const radiusZone = {
    id: "z1",
    name: "굴착구",
    geometry_type: "radius" as const,
    geo_polygon: null,
    center_lat: 37.5,
    center_lng: 127.0,
    radius_m: 50,
    banned_worker_ids: [] as string[],
    banned_company_ids: [] as string[],
    banned_job_types: [] as string[],
  };

  it("detects point inside radius", () => {
    expect(pointInRestrictedZone(37.5001, 127.0001, radiusZone)).toBe(true);
    expect(pointInRestrictedZone(37.6, 127.1, radiusZone)).toBe(false);
  });

  it("bans everyone when lists empty", () => {
    expect(isSubjectBanned(radiusZone, { worker_id: "w1" })).toBe(true);
  });

  it("matches job type ban", () => {
    const z = { ...radiusZone, banned_job_types: ["철근공"] };
    expect(isSubjectBanned(z, { job_type: "철근공" })).toBe(true);
    expect(isSubjectBanned(z, { job_type: "신호수" })).toBe(false);
  });

  it("finds violating zone", () => {
    const hit = findViolatingRestrictedZone(37.5001, 127.0001, [radiusZone], {});
    expect(hit?.id).toBe("z1");
  });

  it("does not alarm or pull GPS rate for 작업구역", () => {
    const work = { ...radiusZone, zone_category: "작업구역" };
    expect(isSubjectBanned(work, { worker_id: "w1" })).toBe(false);
    expect(findViolatingRestrictedZone(37.5001, 127.0001, [work], {})).toBeNull();
    expect(minDistanceToRestrictedZoneEdge(37.5001, 127.0001, [work])).toBe(Number.POSITIVE_INFINITY);
  });

  it("polygon intersect", () => {
    const poly = {
      ...radiusZone,
      id: "poly",
      geometry_type: "polygon" as const,
      geo_polygon: [
        { lat: 37.0, lng: 127.0 },
        { lat: 37.0, lng: 127.1 },
        { lat: 37.1, lng: 127.1 },
        { lat: 37.1, lng: 127.0 },
      ],
      center_lat: null,
      center_lng: null,
      radius_m: null,
    };
    expect(pointInRestrictedZone(37.05, 127.05, poly)).toBe(true);
    expect(pointInRestrictedZone(36.0, 126.0, poly)).toBe(false);
  });

  it("measures point-to-segment, not just vertices (F-05)", () => {
    const a = { lat: 37.5, lng: 127.0 };
    const b = { lat: 37.5, lng: 127.002 }; // ~176m east
    const mid = { lat: 37.5, lng: 127.001 };
    const vertexOnly = Math.min(
      haversineApprox(mid, a),
      haversineApprox(mid, b),
    );
    expect(pointToSegmentM(mid, a, b)).toBeLessThan(1);
    expect(vertexOnly).toBeGreaterThan(80);

    const southOfMid = offsetMeters(mid, -5, 0);
    const d = pointToSegmentM(southOfMid, a, b);
    expect(d).toBeGreaterThan(4);
    expect(d).toBeLessThan(6.5);
  });

  it("uses edge distance so a long rectangle's long side is not 40m+ away (F-05)", () => {
    const sw = { lat: 37.5, lng: 127.0 };
    const se = offsetMeters(sw, 0, 200);
    const ne = offsetMeters(sw, 20, 200);
    const nw = offsetMeters(sw, 20, 0);
    const zone = {
      id: "rect",
      name: "장방형",
      geometry_type: "polygon" as const,
      geo_polygon: [sw, se, ne, nw],
      center_lat: null,
      center_lng: null,
      radius_m: null,
      banned_worker_ids: [] as string[],
      banned_company_ids: [] as string[],
      banned_job_types: [] as string[],
    };
    const outsideMid = offsetMeters(offsetMeters(sw, 0, 100), -5, 0);
    const d = minDistanceToRestrictedZoneEdge(outsideMid.lat, outsideMid.lng, [zone]);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(8);
  });
});

function offsetMeters(origin: { lat: number; lng: number }, northM: number, eastM: number) {
  const lat0 = (origin.lat * Math.PI) / 180;
  return {
    lat: origin.lat + northM / 111_195,
    lng: origin.lng + eastM / (111_195 * Math.cos(lat0)),
  };
}

function haversineApprox(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, s)));
}
