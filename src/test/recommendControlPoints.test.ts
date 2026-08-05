import { describe, expect, it } from "vitest";
import {
  pointInRing,
  recommendControlPoints,
} from "@/lib/tracking/recommendControlPoints";

describe("recommendControlPoints", () => {
  it("returns 3 spread points inset from corners", () => {
    const pts = recommendControlPoints({ count: 3 });
    expect(pts).toHaveLength(3);
    for (const p of pts) {
      expect(p.u).toBeGreaterThanOrEqual(0.12);
      expect(p.u).toBeLessThanOrEqual(0.88);
      expect(p.v).toBeGreaterThanOrEqual(0.12);
      expect(p.v).toBeLessThanOrEqual(0.88);
    }
    // Not collapsed
    const d01 = Math.hypot(pts[0].u - pts[1].u, pts[0].v - pts[1].v);
    const d02 = Math.hypot(pts[0].u - pts[2].u, pts[0].v - pts[2].v);
    expect(d01).toBeGreaterThan(0.15);
    expect(d02).toBeGreaterThan(0.15);
  });

  it("prefers points inside zones / near GPS history", () => {
    const zone = [
      { u: 0.4, v: 0.4 },
      { u: 0.6, v: 0.4 },
      { u: 0.6, v: 0.6 },
      { u: 0.4, v: 0.6 },
    ];
    const pts = recommendControlPoints({
      count: 3,
      zoneRingsUv: [zone],
      gpsHistoryUv: [{ u: 0.5, v: 0.5 }],
    });
    expect(pts[0].score).toBeGreaterThan(1);
    expect(pts.some((p) => p.reason.includes("구역") || p.reason.includes("GPS"))).toBe(true);
  });

  it("replaces excluded unreachable points", () => {
    const first = recommendControlPoints({ count: 3 });
    const excluded = first.map((p) => ({ u: p.u, v: p.v }));
    const next = recommendControlPoints({ count: 3, excluded });
    for (const n of next) {
      for (const e of excluded) {
        expect(Math.hypot(n.u - e.u, n.v - e.v)).toBeGreaterThan(0.07);
      }
    }
  });
});

describe("pointInRing", () => {
  it("detects inside square", () => {
    const ring = [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ];
    expect(pointInRing({ u: 0.5, v: 0.5 }, ring)).toBe(true);
    expect(pointInRing({ u: 1.5, v: 0.5 }, ring)).toBe(false);
  });
});
