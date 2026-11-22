import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildRectangleRing,
  circleEastHandlePoint,
  computeCircleRadius,
  edgeMidpoints,
  formatMetersLabel,
  insertVertexAt,
  isWithinScreenRadius,
  measureRectangleMeters,
  measureSegmentMeters,
  polygonCentroid,
  removeVertexAt,
  translatePolygon,
} from "@/lib/geofence/interactiveDrawGeometry";

describe("InteractiveLeafletDraw geometry helpers & wiring", () => {
  it("builds a normalized 4-corner ring from any two opposite corners", () => {
    const ring = buildRectangleRing({ lat: 10, lng: 50 }, { lat: 40, lng: 20 });
    expect(ring).toEqual([
      { lat: 40, lng: 20 },
      { lat: 40, lng: 50 },
      { lat: 10, lng: 50 },
      { lat: 10, lng: 20 },
    ]);
  });

  it("computes circle radius accurately in both CRS.Simple and WGS84 modes", () => {
    const crs = computeCircleRadius({ lat: 100, lng: 200 }, { lat: 130, lng: 240 }, "crs", 0.5);
    expect(crs.mapRadius).toBe(50);
    expect(crs.displayMeters).toBe(25);

    const wgs = computeCircleRadius(
      { lat: 37.5, lng: 127.0 },
      { lat: 37.5009, lng: 127.0 },
      "wgs84",
    );
    expect(wgs.mapRadius).toBeGreaterThan(95);
    expect(wgs.mapRadius).toBeLessThan(105);
    expect(wgs.displayMeters).toBe(wgs.mapRadius);
  });

  it("measures rectangle dimensions and segment distances in meters", () => {
    const rectCrs = measureRectangleMeters({ lat: 0, lng: 0 }, { lat: 20, lng: 40 }, "crs", 0.25);
    expect(rectCrs.widthM).toBe(10);
    expect(rectCrs.heightM).toBe(5);

    const segCrs = measureSegmentMeters({ lat: 0, lng: 0 }, { lat: 30, lng: 40 }, "crs", 0.4);
    expect(segCrs).toBeCloseTo(20, 5);
    expect(formatMetersLabel(7.44)).toBe("7.4m");
    expect(formatMetersLabel(34.7)).toBe("35m");
  });

  it("supports vertex insert, delete (preserving minimum 3 vertices), translation, midpoints, and east handle", () => {
    const tri = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
    ];
    expect(removeVertexAt(tri, 0)).toHaveLength(3);

    const mids = edgeMidpoints(tri);
    expect(mids).toHaveLength(3);
    expect(mids[0]).toEqual({ lat: 0, lng: 5 });

    const quad = insertVertexAt(tri, 0, mids[0]);
    expect(quad).toHaveLength(4);
    expect(quad[1]).toEqual({ lat: 0, lng: 5 });
    expect(removeVertexAt(quad, 1)).toHaveLength(3);

    const moved = translatePolygon(tri, 5, -3);
    expect(moved[0]).toEqual({ lat: 5, lng: -3 });
    expect(polygonCentroid(tri)).toEqual({ lat: 10 / 3, lng: 20 / 3 });

    const eastCrs = circleEastHandlePoint({ lat: 50, lng: 60 }, 25, "crs");
    expect(eastCrs).toEqual({ lat: 50, lng: 85 });

    expect(isWithinScreenRadius({ x: 10, y: 10 }, { x: 20, y: 10 }, 16)).toBe(true);
    expect(isWithinScreenRadius({ x: 10, y: 10 }, { x: 30, y: 10 }, 16)).toBe(false);
  });

  it("replaces LeafletDrawControl with InteractiveLeafletDraw in OrthogonalZoneCanvas and SiteControlMap", () => {
    const ortho = readFileSync("src/components/geofence/OrthogonalZoneCanvas.tsx", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const mapPage = readFileSync("src/pages/SiteControlMap.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(ortho).toContain("<InteractiveLeafletDraw");
    expect(ortho).not.toContain("<LeafletDrawControl");
    expect(mapPage).toContain("<InteractiveLeafletDraw");
    expect(mapPage).not.toContain("<LeafletDrawControl");
  });
});
