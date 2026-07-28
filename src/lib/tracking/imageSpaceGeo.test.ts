import { describe, expect, it } from "vitest";
import type { GeoCorners } from "@/lib/mapBounds";
import {
  crsPolygonToGeo,
  geoPolygonToCrs,
  latLngToUv,
  uvToLatLng,
} from "@/lib/tracking/imageSpaceGeo";

const corners: GeoCorners = {
  tl: { lat: 37.5, lng: 127.0 },
  tr: { lat: 37.5, lng: 127.01 },
  bl: { lat: 37.49, lng: 127.0 },
};

describe("imageSpaceGeo affine UV ↔ lat/lng", () => {
  it("maps TL/TR/BL corners exactly", () => {
    expect(uvToLatLng({ u: 0, v: 0 }, corners)).toEqual(corners.tl);
    expect(uvToLatLng({ u: 1, v: 0 }, corners)).toEqual(corners.tr);
    expect(uvToLatLng({ u: 0, v: 1 }, corners)).toEqual(corners.bl);
  });

  it("round-trips UV through lat/lng", () => {
    const uv = { u: 0.35, v: 0.7 };
    const p = uvToLatLng(uv, corners);
    const back = latLngToUv(p, corners);
    expect(back.u).toBeCloseTo(uv.u, 8);
    expect(back.v).toBeCloseTo(uv.v, 8);
  });

  it("round-trips CRS.Simple polygon via geo corners", () => {
    const w = 2000;
    const h = 1000;
    const crsRing = [
      { lat: h, lng: 0 },
      { lat: h, lng: w },
      { lat: 0, lng: w },
      { lat: 0, lng: 0 },
    ];
    const geo = crsPolygonToGeo(crsRing, corners, w, h);
    const back = geoPolygonToCrs(geo, corners, w, h);
    expect(back[0].lat).toBeCloseTo(crsRing[0].lat, 5);
    expect(back[0].lng).toBeCloseTo(crsRing[0].lng, 5);
    expect(back[2].lat).toBeCloseTo(crsRing[2].lat, 5);
  });
});
