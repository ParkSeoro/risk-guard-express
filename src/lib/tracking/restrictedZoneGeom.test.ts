import { describe, expect, it } from "vitest";
import {
  findViolatingRestrictedZone,
  isSubjectBanned,
  pointInRestrictedZone,
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
});
