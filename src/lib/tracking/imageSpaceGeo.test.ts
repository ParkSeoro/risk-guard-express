import { describe, expect, it } from "vitest";
import type { GeoCorners } from "@/lib/mapBounds";
import {
  crsPolygonToGeo,
  formatGpsPreview,
  geoPolygonToCrs,
  gpsBoundsFromCorners,
  latLngToUv,
  looksLikeWgs84,
  translateCrsToGps,
  translatePixelToGps,
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

describe("translatePixelToGps linear interpolation (TL/BR)", () => {
  const gpsBounds = gpsBoundsFromCorners(corners);
  const w = 1000;
  const h = 500;

  it("maps image corners to GPS TL / BR", () => {
    expect(translatePixelToGps(0, 0, w, h, gpsBounds)).toEqual(gpsBounds.topLeft);
    const br = translatePixelToGps(w, h, w, h, gpsBounds);
    expect(br.lat).toBeCloseTo(gpsBounds.bottomRight.lat, 10);
    expect(br.lng).toBeCloseTo(gpsBounds.bottomRight.lng, 10);
  });

  it("interpolates midpoint", () => {
    const mid = translatePixelToGps(w / 2, h / 2, w, h, gpsBounds);
    expect(mid.lat).toBeCloseTo((gpsBounds.topLeft.lat + gpsBounds.bottomRight.lat) / 2, 10);
    expect(mid.lng).toBeCloseTo((gpsBounds.topLeft.lng + gpsBounds.bottomRight.lng) / 2, 10);
  });

  it("matches affine translateCrsToGps for axis-aligned image", () => {
    // CRS: lng=px, lat=h-py  → pixel (px,py) from top-left
    const px = 250;
    const py = 100;
    const crs = { lng: px, lat: h - py };
    const viaCrs = translateCrsToGps(crs, corners, w, h);
    const viaPixel = translatePixelToGps(px, py, w, h, gpsBounds);
    expect(viaCrs.lat).toBeCloseTo(viaPixel.lat, 10);
    expect(viaCrs.lng).toBeCloseTo(viaPixel.lng, 10);
  });
});

describe("GPS preview / validation helpers", () => {
  it("looksLikeWgs84 rejects pixel-scale values", () => {
    expect(looksLikeWgs84({ lat: 37.5, lng: 127.0 })).toBe(true);
    expect(looksLikeWgs84({ lat: 800, lng: 1200 })).toBe(false);
  });

  it("formatGpsPreview lists polygon points", () => {
    const s = formatGpsPreview({
      kind: "polygon",
      latlngs: [
        { lat: 34.8523, lng: 127.6995 },
        { lat: 34.8524, lng: 127.6996 },
      ],
    });
    expect(s).toContain("📍 변환된 GPS 좌표:");
    expect(s).toContain("[34.852300, 127.699500]");
  });
});
