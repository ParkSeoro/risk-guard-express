import { describe, it, expect } from "vitest";
import {
  anchorsToSwNe,
  swNeToCorners,
  rotateCorners,
  scaleCorners,
  cornersToPersistPayload,
  loadCornersFromMap,
  anyMapHasGeoref,
  parseSiteMapView,
  parseGeoTransform,
  mergeViewIntoGeoTransform,
  georefCornersKey,
  cornersEqual,
  viewsEqual,
} from "@/lib/mapBounds";

describe("mapBounds corners / rotation", () => {
  const box = {
    sw: { lat: 37.5, lng: 126.9 },
    ne: { lat: 37.6, lng: 127.0 },
  };

  it("builds TL/TR/BL from SW/NE", () => {
    const c = swNeToCorners(box);
    expect(c.tl).toEqual({ lat: 37.6, lng: 126.9 });
    expect(c.tr).toEqual({ lat: 37.6, lng: 127.0 });
    expect(c.bl).toEqual({ lat: 37.5, lng: 126.9 });
  });

  it("rotateCorners changes corner positions", () => {
    const c0 = swNeToCorners(box);
    const c1 = rotateCorners(c0, 15);
    expect(c1.tl.lat).not.toBeCloseTo(c0.tl.lat, 6);
    expect(c1.tr.lng).not.toBeCloseTo(c0.tr.lng, 6);
  });

  it("scaleCorners expands from center", () => {
    const c0 = swNeToCorners(box);
    const c1 = scaleCorners(c0, 1.1);
    const h0 = Math.abs(c0.tl.lat - c0.bl.lat);
    const h1 = Math.abs(c1.tl.lat - c1.bl.lat);
    expect(h1).toBeGreaterThan(h0);
  });

  it("persist payload includes geo_transform", () => {
    const c = swNeToCorners(box);
    const p = cornersToPersistPayload(c, 0.7);
    expect(p.geo_transform.opacity).toBe(0.7);
    expect(p.geo_transform.tl).toEqual(c.tl);
    expect(p.geo_anchor_nw_lat).toBe(37.6);
  });

  it("persist payload keeps camera view and source (walk/PC/photo share SSOT)", () => {
    const c = swNeToCorners(box);
    const view = { lat: 37.55, lng: 126.95, zoom: 18 };
    const p = cornersToPersistPayload(c, 0.82, { view, source: "walk" });
    expect(p.geo_transform.view).toEqual(view);
    expect(p.geo_transform.source).toBe("walk");
    const parsed = parseGeoTransform(p.geo_transform);
    expect(parsed?.view).toEqual(view);
    expect(parseSiteMapView(p.geo_transform)).toEqual(view);
  });

  it("mergeViewIntoGeoTransform does not drop TL/TR/BL", () => {
    const c = swNeToCorners(box);
    const base = cornersToPersistPayload(c, 0.8, { source: "seed" }).geo_transform;
    const merged = mergeViewIntoGeoTransform(base, { lat: 34.85, lng: 127.7, zoom: 16 });
    const parsed = parseGeoTransform(merged);
    expect(parsed?.tl).toEqual(c.tl);
    expect(parsed?.source).toBe("seed");
    expect(parsed?.view).toEqual({ lat: 34.85, lng: 127.7, zoom: 16 });
  });

  it("georefCornersKey ignores camera view so saving zoom does not look like a new georef", () => {
    const c = swNeToCorners(box);
    const a = {
      geo_anchor_nw_lat: 37.6,
      geo_anchor_nw_lng: 126.9,
      geo_anchor_se_lat: 37.5,
      geo_anchor_se_lng: 127.0,
      geo_transform: cornersToPersistPayload(c, 0.85).geo_transform,
    };
    const b = {
      ...a,
      geo_transform: cornersToPersistPayload(c, 0.85, {
        view: { lat: 37.55, lng: 126.95, zoom: 19 },
      }).geo_transform,
    };
    expect(georefCornersKey(a)).toBe(georefCornersKey(b));
    expect(cornersEqual(c, loadCornersFromMap(b))).toBe(true);
    expect(viewsEqual(parseSiteMapView(a.geo_transform), parseSiteMapView(b.geo_transform))).toBe(false);
  });

  it("anyMapHasGeoref treats walk geo_transform as done (not gps_calibration)", () => {
    expect(anyMapHasGeoref([])).toBe(false);
    expect(
      anyMapHasGeoref([
        {
          geo_anchor_nw_lat: null,
          geo_anchor_nw_lng: null,
          geo_anchor_se_lat: null,
          geo_anchor_se_lng: null,
          geo_transform: {
            tl: { lat: 34.85, lng: 127.70 },
            tr: { lat: 34.85, lng: 127.71 },
            bl: { lat: 34.84, lng: 127.70 },
          },
        },
      ]),
    ).toBe(true);
  });

  it("loads from geo_transform preferentially", () => {
    const c = loadCornersFromMap({
      geo_anchor_nw_lat: 1,
      geo_anchor_nw_lng: 1,
      geo_anchor_se_lat: 0,
      geo_anchor_se_lng: 2,
      geo_transform: {
        tl: { lat: 10, lng: 20 },
        tr: { lat: 10, lng: 21 },
        bl: { lat: 9, lng: 20 },
        opacity: 0.5,
      },
    });
    expect(c?.tl).toEqual({ lat: 10, lng: 20 });
  });

  it("anchorsToSwNe still works", () => {
    expect(
      anchorsToSwNe({
        geo_anchor_nw_lat: 37.6,
        geo_anchor_nw_lng: 126.9,
        geo_anchor_se_lat: 37.5,
        geo_anchor_se_lng: 127.0,
      }),
    ).toEqual(box);
  });
});
