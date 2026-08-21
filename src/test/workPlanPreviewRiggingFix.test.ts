import { describe, expect, it } from "vitest";
import {
  appendTextToMethodSection,
  methodStepsForPrint,
  parseMethodSection,
  serializeMethodSection,
} from "@/lib/workPlanMethodSection";
import { isRiggingPlanReady } from "@/lib/riggingPlanPersist";
import { refreshRiggingDerivedFields } from "@/lib/riggingDerived";

describe("workPlanMethodSection", () => {
  it("appends calculator notes without spreading arrays into objects", () => {
    const base = JSON.stringify([
      { order: 1, description: "작업 전 준비", safety_measure: "점검" },
      { order: 2, description: "양중", safety_measure: "신호" },
    ]);
    const next = appendTextToMethodSection(base, "■ 크레인 양중 안전율\n판정: 적합");
    const parsed = JSON.parse(next);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
    expect(parsed[2].description).toBe("법규·계산 참고");
    expect(parsed[2].safety_measure).toContain("적합");
  });

  it("recovers corrupted object shape for print", () => {
    const corrupted = JSON.stringify({
      "0": { order: 1, description: "준비", safety_measure: "A" },
      "1": { order: 2, description: "양중", safety_measure: "B" },
      notes: "■ 계산 결과 적합",
    });
    const steps = methodStepsForPrint(corrupted);
    expect(steps).toHaveLength(3);
    expect(steps[0].description).toBe("준비");
    expect(steps[2].safety_measure).toContain("적합");
    expect(parseMethodSection(corrupted).steps).toHaveLength(2);
  });

  it("serialize keeps array SSOT", () => {
    const raw = serializeMethodSection({
      steps: [{ order: 1, description: "a", safety_measure: "b" }],
      notes: "",
    });
    expect(JSON.parse(raw)).toEqual([{ order: 1, description: "a", safety_measure: "b" }]);
  });
});

describe("rigging readiness + derived refresh", () => {
  it("requires capacity and positive safety factor", () => {
    expect(
      isRiggingPlanReady({
        load_weight: 2,
        working_radius: 10,
        crane_model: "SR-600L",
      }),
    ).toBe(false);
    expect(
      isRiggingPlanReady({
        load_weight: 2,
        working_radius: 10,
        crane_model: "SR-600L",
        crane_capacity: 9,
        safety_factor: 0,
      }),
    ).toBe(false);
    expect(
      isRiggingPlanReady({
        load_weight: 2,
        working_radius: 10,
        crane_model: "SR-600L",
        crane_capacity: 9,
        safety_factor: 1.44,
      }),
    ).toBe(true);
  });

  it("refreshRiggingDerivedFields fills safety_factor from capacity", () => {
    const next = refreshRiggingDerivedFields({
      load_weight: 2,
      hook_weight: 0,
      shackle_weight_val: 0,
      sling_rigging_weight: 0,
      crane_capacity: 9,
      rated_capacity: 9,
      working_radius: 10,
      wind_speed_factor: 1,
      boom_rotation_factor: 1,
      ground_inspection_factor: 1,
      load_protrusion_factor: 1,
    });
    expect(Number(next.safety_factor)).toBeGreaterThan(1);
    expect(Number(next.calculated_utilization)).toBeGreaterThan(0);
  });
});
