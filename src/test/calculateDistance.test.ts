import { describe, expect, it } from "vitest";
import { calculateDistance, isWithinSiteRadius } from "@/lib/geo/calculateDistance";

describe("calculateDistance (Haversine)", () => {
  it("returns ~0 for identical points", () => {
    expect(calculateDistance(37.5665, 126.978, 37.5665, 126.978)).toBeLessThan(0.01);
  });

  it("measures ~111m for ~0.001° latitude delta near equator", () => {
    const d = calculateDistance(0, 0, 0.001, 0);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it("isWithinSiteRadius respects 100m", () => {
    const siteLat = 37.5665;
    const siteLng = 126.978;
    expect(isWithinSiteRadius(siteLat, siteLng, siteLat, siteLng, 100)).toBe(true);
    // ~0.002° lat ≈ 222m
    expect(isWithinSiteRadius(siteLat, siteLng, siteLat + 0.002, siteLng, 100)).toBe(false);
  });
});
