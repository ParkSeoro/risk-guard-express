import { describe, expect, it } from "vitest";
import {
  canResumeOnSite,
  clampSiteBoundaryBufferM,
  distanceToSiteBoundaryEdgeM,
  evaluateSiteLeave,
  isDefinitelyOutsideSiteBoundary,
  isWithinAnySiteAttendance,
  isWithinSiteAttendance,
  outlineToDrawnShape,
  parseSiteBoundaryRow,
  pointInSiteBoundary,
  SITE_BOUNDARY_BUFFER_DEFAULT_M,
  SITE_BOUNDARY_BUFFER_MAX_M,
  SITE_BOUNDARY_BUFFER_MIN_M,
  type SiteBoundary,
} from "@/lib/tracking/siteBoundary";

const square: SiteBoundary = {
  id: "b1",
  project_id: "p1",
  name: "현장",
  geometry_type: "polygon",
  geo_polygon: [
    { lat: 37.5, lng: 127.0 },
    { lat: 37.5, lng: 127.001 },
    { lat: 37.501, lng: 127.001 },
    { lat: 37.501, lng: 127.0 },
  ],
  center_lat: null,
  center_lng: null,
  radius_m: null,
  buffer_m: 150,
};

const circle: SiteBoundary = {
  id: "b2",
  project_id: "p1",
  name: "원",
  geometry_type: "radius",
  geo_polygon: null,
  center_lat: 37.5,
  center_lng: 127.0,
  radius_m: 80,
  buffer_m: 200,
};

describe("siteBoundary", () => {
  it("clamps attendance buffer to 100–300m", () => {
    expect(clampSiteBoundaryBufferM(null)).toBe(SITE_BOUNDARY_BUFFER_DEFAULT_M);
    expect(clampSiteBoundaryBufferM(50)).toBe(SITE_BOUNDARY_BUFFER_MIN_M);
    expect(clampSiteBoundaryBufferM(900)).toBe(SITE_BOUNDARY_BUFFER_MAX_M);
    expect(clampSiteBoundaryBufferM(180)).toBe(180);
  });

  it("treats the drawn polygon interior as the site", () => {
    expect(pointInSiteBoundary(37.5005, 127.0005, square)).toBe(true);
    expect(distanceToSiteBoundaryEdgeM(37.5005, 127.0005, square)).toBe(0);
    expect(isWithinSiteAttendance(37.5005, 127.0005, square, 10)).toBe(true);
  });

  it("allows clock-in in the 100–300m ring outside the outline", () => {
    expect(pointInSiteBoundary(37.503, 127.0005, square)).toBe(false);
    const dist = distanceToSiteBoundaryEdgeM(37.503, 127.0005, square);
    expect(dist).toBeGreaterThan(100);
    expect(dist).toBeLessThan(300);
    expect(isWithinSiteAttendance(37.503, 127.0005, { ...square, buffer_m: 150 }, 10)).toBe(false);
    expect(isWithinSiteAttendance(37.503, 127.0005, { ...square, buffer_m: 300 }, 10)).toBe(true);
  });

  it("does not treat 500–1000m from the edge as on site", () => {
    expect(isWithinSiteAttendance(37.51, 127.0, square, 10)).toBe(false);
    const leave = isDefinitelyOutsideSiteBoundary(square, 37.51, 127.0, 10);
    expect(leave.outside).toBe(true);
    expect(leave.radiusM).toBe(150);
  });

  it("uses circle radius + buffer the same way", () => {
    expect(pointInSiteBoundary(37.5, 127.0, circle)).toBe(true);
    expect(isWithinSiteAttendance(37.502, 127.0, circle, 8)).toBe(true);
    expect(isWithinSiteAttendance(37.51, 127.0, circle, 8)).toBe(false);
  });

  it("prefers the outline over circular fences for leave/resume", () => {
    const fence = { lat: 37.5, lng: 127.0, radiusM: 80, source: "site_pin" as const };
    const far = evaluateSiteLeave(square, [fence], 37.51, 127.0, 10);
    expect(far?.outside).toBe(true);
    expect(canResumeOnSite(square, [fence], 37.5005, 127.0005, 10)).toBe(true);
    expect(canResumeOnSite(null, [fence], fence.lat, fence.lng, 10)).toBe(true);
  });

  it("treats several 개소 as a union for attendance", () => {
    const office: SiteBoundary = {
      ...circle,
      id: "office",
      name: "사무실",
      center_lat: 37.52,
      center_lng: 127.0,
      radius_m: 60,
      buffer_m: 150,
    };
    expect(isWithinAnySiteAttendance([square, office], 37.5005, 127.0005, 8)).toBe(true);
    expect(isWithinAnySiteAttendance([square, office], 37.52, 127.0, 8)).toBe(true);
    expect(isWithinAnySiteAttendance([square, office], 37.54, 127.0, 8)).toBe(false);
    const leave = evaluateSiteLeave([square, office], [], 37.54, 127.0, 10);
    expect(leave?.outside).toBe(true);
    expect(canResumeOnSite([square, office], [], 37.52, 127.0, 10)).toBe(true);
  });

  it("converts stored 개소 outlines back into leaflet edit shapes", () => {
    expect(outlineToDrawnShape(square)).toEqual({
      kind: "polygon",
      latlngs: square.geo_polygon,
    });
    expect(outlineToDrawnShape(circle)).toEqual({
      kind: "circle",
      center: { lat: 37.5, lng: 127.0 },
      radius_m: 80,
    });
    expect(
      outlineToDrawnShape({
        ...circle,
        geometry_type: "radius",
        center_lat: null,
        radius_m: 0,
      }),
    ).toBeNull();
  });

  it("parses a stored row and ignores junk geometry", () => {
    const row = parseSiteBoundaryRow({
      id: "x",
      project_id: "p",
      name: "패드",
      geometry_type: "polygon",
      geo_polygon: [
        { lat: 1, lng: 2 },
        { lat: 1.001, lng: 2 },
        { lat: 1.001, lng: 2.001 },
      ],
      buffer_m: 220,
    });
    expect(row?.buffer_m).toBe(220);
    expect(row?.geo_polygon).toHaveLength(3);
  });
});
