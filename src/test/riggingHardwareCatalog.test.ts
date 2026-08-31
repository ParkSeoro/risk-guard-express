import { describe, expect, it } from "vitest";
import {
  getRoundSlingRatedLoadByColor,
  getShackleSafeLoadByInch,
  HEAVY_CRANE_CLASSES,
  ROUND_SLING_BY_COLOR,
  SHACKLE_INCH_LOAD,
} from "@/lib/riggingHardwareCatalog";
import { lookupCraneCapacity, CRANE_PRESETS } from "@/lib/riggingCalculator";
import { calculateRigging } from "@/lib/workPlanTemplates";

describe("riggingHardwareCatalog (EN 1492-2 / Crosby G-2130)", () => {
  it("maps orange 40 t and 60 t without collapsing to 10 t", () => {
    expect(getRoundSlingRatedLoadByColor("orange")).toBe(10);
    expect(getRoundSlingRatedLoadByColor("주황")).toBe(10);
    expect(getRoundSlingRatedLoadByColor("orange-40")).toBe(40);
    expect(getRoundSlingRatedLoadByColor("orange-60")).toBe(60);
    expect(ROUND_SLING_BY_COLOR.some((s) => s.id === "orange-40" && s.ratedLoad === 40)).toBe(true);
    expect(ROUND_SLING_BY_COLOR.some((s) => s.id === "orange-60" && s.ratedLoad === 60)).toBe(true);
  });

  it("uses Crosby G-2130 2 inch = 35 t", () => {
    expect(getShackleSafeLoadByInch("2")).toBe(35);
    expect(getShackleSafeLoadByInch("1-1/2")).toBe(17);
    expect(getShackleSafeLoadByInch("2-1/2")).toBe(55);
    expect(SHACKLE_INCH_LOAD.find((s) => s.inch === "2")?.label).toBe('2"');
  });

  it("stores official 250/300 max points only and does not interpolate", () => {
    const cke = HEAVY_CRANE_CLASSES.find((c) => c.id === "crane_cke2500");
    const lr = HEAVY_CRANE_CLASSES.find((c) => c.id === "crane_lr1300");
    expect(cke?.defaultCapacityAtPoint).toBe(250);
    expect(cke?.defaultWorkingRadius).toBe(4.6);
    expect(lr?.defaultCapacityAtPoint).toBe(300);
    expect(lr?.defaultWorkingRadius).toBe(4.3);
    expect(cke?.chartVerified).toBe(false);
    expect(lookupCraneCapacity(cke!, 30, 15)).toBe(0);

    const miss = calculateRigging({
      loadWeight: 80,
      workingRadius: 20,
      craneModel: "Kobelco CKE2500-2 (250톤)",
    });
    expect(miss.isValid).toBe(false);
    expect(miss.message).toMatch(/제원표|LMI/);

    const atMax = calculateRigging({
      loadWeight: 80,
      workingRadius: 4.6,
      craneModel: "Kobelco CKE2500-2 (250톤)",
    });
    expect(atMax.availableCapacity).toBe(250);
  });

  it("does not treat generic 25–200 presets as verified charts", () => {
    const generic = CRANE_PRESETS.find((p) => p.id === "crane_200t");
    expect(generic?.chartVerified).toBe(false);
    expect(lookupCraneCapacity(generic!, 30, 10)).toBe(0);
  });
});
