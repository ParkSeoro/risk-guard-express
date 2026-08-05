import { describe, expect, it } from "vitest";
import { fitAffineFromControlPoints } from "@/lib/tracking/fitAffineFromControlPoints";
import { uvToLatLng } from "@/lib/tracking/imageSpaceGeo";
import type { GeoCorners } from "@/lib/mapBounds";

const corners: GeoCorners = {
  tl: { lat: 35.1, lng: 129.0 },
  tr: { lat: 35.1, lng: 129.01 },
  bl: { lat: 35.09, lng: 129.0 },
};

describe("fitAffineFromControlPoints", () => {
  it("recovers TL/TR/BL from 3 exact samples", () => {
    const samples = [
      { id: "A", u: 0.2, v: 0.2 },
      { id: "B", u: 0.8, v: 0.25 },
      { id: "C", u: 0.3, v: 0.8 },
    ].map((s) => {
      const p = uvToLatLng(s, corners);
      return { ...s, lat: p.lat, lng: p.lng };
    });
    const fit = fitAffineFromControlPoints(samples);
    expect("error" in fit).toBe(false);
    if ("error" in fit) return;
    expect(fit.rmsM).toBeLessThan(0.5);
    expect(fit.corners.tl.lat).toBeCloseTo(corners.tl.lat, 5);
    expect(fit.corners.tr.lng).toBeCloseTo(corners.tr.lng, 5);
    expect(fit.corners.bl.lat).toBeCloseTo(corners.bl.lat, 5);
  });

  it("rejects collinear points", () => {
    const fit = fitAffineFromControlPoints([
      { id: "A", u: 0.2, v: 0.5, lat: 35.1, lng: 129.0 },
      { id: "B", u: 0.5, v: 0.5, lat: 35.1, lng: 129.005 },
      { id: "C", u: 0.8, v: 0.5, lat: 35.1, lng: 129.01 },
    ]);
    expect("error" in fit).toBe(true);
  });

  it("improves with 4th noisy point via least squares", () => {
    const samples = [
      { id: "A", u: 0.2, v: 0.2 },
      { id: "B", u: 0.8, v: 0.2 },
      { id: "C", u: 0.2, v: 0.8 },
      { id: "D", u: 0.7, v: 0.7 },
    ].map((s, i) => {
      const p = uvToLatLng(s, corners);
      // tiny noise on D
      const n = i === 3 ? 0.00001 : 0;
      return { ...s, lat: p.lat + n, lng: p.lng };
    });
    const fit = fitAffineFromControlPoints(samples);
    expect("error" in fit).toBe(false);
    if ("error" in fit) return;
    expect(fit.rmsM).toBeLessThan(5);
  });
});
