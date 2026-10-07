import { describe, expect, it } from "vitest";
import {
  WIRE_ROPE_BREAKING_LOAD,
  WIRE_ROPE_TABLE_MAX_MM,
  calculateFullRigging,
  getWireBreakingLoad,
  parseSlingSecondary,
  type RiggingInput,
} from "@/lib/riggingCalculator";
import { buildRiggingInputFromRow, refreshRiggingDerivedFields, riggingResultToPatch } from "@/lib/riggingDerived";
import { buildRiggingPlanPayload } from "@/lib/riggingPlanPersist";

function wireInput(over: Partial<RiggingInput> = {}): RiggingInput {
  return {
    equipmentName: "테스트 크레인",
    ratedCapacity: 200,
    boomLength: 20,
    workingRadius: 8,
    liftingCapacity: 200,
    outriggerDistance: 7,
    slingMaterialType: "wire_rope",
    wireDiameterMm: 60,
    slingCount: 2,
    slingAngleDeg: 60,
    wireTerminalMethod: "압축(25mm 이상)",
    wireSafetyCoefficient: 5,
    slingBeltWidthMm: 0,
    slingBeltRatedLoad: 0,
    roundSlingColor: "",
    roundSlingRatedLoad: 0,
    chainDiameterMm: 0,
    chainLegCount: 4,
    shackleInch: "2-1/2",
    shackleQty: 2,
    loadWeight: 10,
    hookWeight: 1,
    shackleWeightVal: 0,
    slingRiggingWeight: 0,
    loadWeightMin: 10,
    hookWeightMin: 1,
    shackleWeightMin: 0,
    slingRiggingWeightMin: 0,
    windSpeedFactor: 1,
    windSpeedGrade: "0~5",
    boomRotationFactor: 1,
    groundInspectionFactor: 1,
    loadProtrusionFactor: 1,
    ...over,
  };
}

describe("와이어로프 절단하중", () => {
  it("표 안 지름은 카탈로그 값을 쓴다", () => {
    expect(getWireBreakingLoad(60)).toBe(196);
    expect(getWireBreakingLoad(20)).toBe(21.8);
    expect(getWireBreakingLoad(10)).toBe(5.45);
  });

  it("표 사이 지름은 선형 보간한다", () => {
    const mid = getWireBreakingLoad(55);
    expect(mid).toBeGreaterThan(WIRE_ROPE_BREAKING_LOAD[52]);
    expect(mid).toBeLessThan(WIRE_ROPE_BREAKING_LOAD[56]);
    expect(mid).toBeCloseTo(147 + 0.75 * (170 - 147), 5);
  });

  it("75mm도 표 밖이어도 절단하중이 0이 아니다 (d² 환산)", () => {
    const expected = WIRE_ROPE_BREAKING_LOAD[WIRE_ROPE_TABLE_MAX_MM] * (75 / WIRE_ROPE_TABLE_MAX_MM) ** 2;
    expect(getWireBreakingLoad(75)).toBeCloseTo(expected, 5);
    expect(getWireBreakingLoad(75)).toBeGreaterThan(WIRE_ROPE_BREAKING_LOAD[60]);
    expect(expected).toBeCloseTo(306.25, 5);
  });

  it("75mm 와이어로프는 안전하중(절단/5)이 자동 계산된다", () => {
    const r = calculateFullRigging(wireInput({ wireDiameterMm: 75, wireSafetyCoefficient: 5 }));
    expect(r.wireBreakingLoad).toBeCloseTo(306.25, 5);
    expect(r.wireSafeLoad).toBeCloseTo(61.25, 5);
    expect(r.slingSafeLoad).toBeCloseTo(61.25, 5);
  });

  it("재료가 비어 있어도 화면 기본값과 같이 와이어로프로 계산한다", () => {
    const input = buildRiggingInputFromRow({
      wire_diameter_mm: 75,
      sling_material_type: null,
      wire_safety_coefficient: 5,
      sling_count: 2,
      sling_angle_deg: 60,
    } as any);
    expect(input.slingMaterialType).toBe("wire_rope");
    const r = calculateFullRigging(input);
    const patch = riggingResultToPatch(r);
    expect(patch.wire_breaking_load).toBeGreaterThan(0);
    expect(patch.wire_safe_load).toBeGreaterThan(0);
  });

  it("제조사 안전하중이 있으면 줄걸이 판정만 그 값을 쓴다", () => {
    const r = calculateFullRigging(wireInput({
      wireDiameterMm: 75,
      wireSafetyCoefficient: 5,
      wireManufacturerSafeLoad: 40,
    }));
    expect(r.wireBreakingLoad).toBeCloseTo(306.25, 5);
    expect(r.wireSafeLoad).toBeCloseTo(61.25, 5);
    expect(r.slingRatedLoad).toBeCloseTo(40, 5);
    expect(r.slingSafeLoad).toBeCloseTo(40, 5);
    expect(r.wireSafeLoadSource).toBe("manufacturer");
    const patch = riggingResultToPatch(r);
    expect(patch.wire_safe_load).toBeCloseTo(61.25, 5);
    expect(patch.sling_safe_load).toBeCloseTo(40, 5);
    expect(patch).not.toHaveProperty("wire_manufacturer_safe_load");
  });

  it("제조사 칸이 비어 있거나 0 이하면 지름 표를 유지한다", () => {
    for (const value of [undefined, null, 0, -3, Number.NaN]) {
      const r = calculateFullRigging(wireInput({
        wireDiameterMm: 75,
        wireManufacturerSafeLoad: value,
      }));
      expect(r.wireSafeLoad).toBeCloseTo(61.25, 5);
      expect(r.slingSafeLoad).toBeCloseTo(61.25, 5);
      expect(r.wireSafeLoadSource).toBe("catalog");
    }
    expect(buildRiggingInputFromRow({ wire_manufacturer_safe_load: "" } as any).wireManufacturerSafeLoad).toBeNull();
    expect(buildRiggingInputFromRow({ wire_manufacturer_safe_load: "40" } as any).wireManufacturerSafeLoad).toBe(40);
  });

  it("다른 줄걸이 재료는 제조사 칸을 판정에 쓰지 않는다", () => {
    const r = calculateFullRigging(wireInput({
      slingMaterialType: "round_sling",
      roundSlingRatedLoad: 40,
      wireManufacturerSafeLoad: 1,
    }));
    expect(r.slingSafeLoad).toBe(40);
    expect(r.wireSafeLoadSource).toBeNull();
  });

  it("저장 패치는 제조사 입력을 남기고 빈 값은 null로 둔다", () => {
    const refreshed = refreshRiggingDerivedFields({
      wire_diameter_mm: 75,
      wire_safety_coefficient: 5,
      wire_manufacturer_safe_load: 40,
      sling_material_type: "wire_rope",
      sling_count: 2,
      sling_angle_deg: 60,
    } as any);
    expect(refreshed.wire_manufacturer_safe_load).toBe(40);
    expect(Number(refreshed.wire_safe_load)).toBeCloseTo(61.25, 5);
    expect(Number(refreshed.sling_safe_load)).toBeCloseTo(40, 5);
    expect(buildRiggingPlanPayload("plan-1", refreshed).wire_manufacturer_safe_load).toBe(40);
    expect(buildRiggingPlanPayload("plan-1", { wire_manufacturer_safe_load: "" }).wire_manufacturer_safe_load).toBeNull();
    expect(buildRiggingPlanPayload("plan-1", {}).wire_manufacturer_safe_load).toBeNull();
  });

  it("straight는 줄 수와 상관없이 1줄로 장력을 나눈다", () => {
    const counted = calculateFullRigging(wireInput({ slingCount: 2 }));
    const straight = calculateFullRigging(wireInput({ slingCount: 4, slingHitch: "straight" }));
    expect(straight.tensionPerLeg).toBeCloseTo(counted.tensionPerLeg * 2, 5);
    expect(straight.slingHitchLabel).toBe("straight (수직 1줄)");
    expect(straight.slingSafeLoad).toBeCloseTo(counted.slingSafeLoad, 5);
  });

  it("basket은 줄 수를 한 번 더 나누지 않고 두 가닥으로만 나눈다", () => {
    const basket = calculateFullRigging(wireInput({ slingCount: 4, slingHitch: "basket" }));
    const twoLeg = calculateFullRigging(wireInput({ slingCount: 4, slingHitch: "2-leg" }));
    expect(basket.tensionPerLeg).toBeCloseTo(twoLeg.tensionPerLeg, 5);
  });

  it("series는 두 줄걸이와 체결구 중 작은 값이다", () => {
    const result = calculateFullRigging(wireInput({
      slingHitch: "straight",
      loadWeight: 1,
      hookWeight: 0.2,
      slingCombination: "series",
      slingDeviceSafeLoad: 8,
      slingSecondary: {
        slingMaterialType: "sling_belt",
        slingHitch: "straight",
        wireDiameterMm: 0,
        wireSafetyCoefficient: 5,
        slingBeltWidthMm: 50,
        slingBeltRatedLoad: 2,
        roundSlingColor: "",
        roundSlingRatedLoad: 0,
        chainDiameterMm: 0,
      },
    }));
    expect(result.secondarySlingSafeLoad).toBe(2);
    expect(result.slingSafeLoad).toBe(2);
    expect(result.slingJudgment).toBe("series_min");
    expect(result.slingOk).toBe(true);
  });

  it("이종 재료를 나란히 쓰면 조합 사용하중 없이 적합이 아니다", () => {
    const blocked = calculateFullRigging(wireInput({
      slingHitch: "straight",
      slingCombination: "parallel",
      slingDeviceSafeLoad: 30,
      slingSecondary: {
        slingMaterialType: "round_sling",
        slingHitch: "straight",
        wireDiameterMm: 0,
        wireSafetyCoefficient: 5,
        slingBeltWidthMm: 0,
        slingBeltRatedLoad: 0,
        roundSlingColor: "purple",
        roundSlingRatedLoad: 1,
        chainDiameterMm: 0,
      },
    }));
    expect(blocked.slingOk).toBe(false);
    expect(blocked.slingJudgment).toBe("mixed_blocked");
    expect(blocked.messages.some((m) => m.includes("더하지 않습니다"))).toBe(true);

    const rated = calculateFullRigging(wireInput({
      slingHitch: "straight",
      loadWeight: 1,
      hookWeight: 0.2,
      slingCombination: "parallel",
      slingDeviceSafeLoad: 30,
      slingAssemblySafeLoad: 20,
      slingSecondary: {
        slingMaterialType: "round_sling",
        slingHitch: "straight",
        wireDiameterMm: 0,
        wireSafetyCoefficient: 5,
        slingBeltWidthMm: 0,
        slingBeltRatedLoad: 0,
        roundSlingColor: "purple",
        roundSlingRatedLoad: 1,
        chainDiameterMm: 0,
      },
    }));
    expect(rated.slingSafeLoad).toBe(20);
    expect(rated.slingJudgment).toBe("assembly");
    expect(rated.slingOk).toBe(true);
  });

  it("0·음수 지름은 0이다", () => {
    expect(getWireBreakingLoad(0)).toBe(0);
    expect(getWireBreakingLoad(-12)).toBe(0);
    expect(getWireBreakingLoad(Number.NaN)).toBe(0);
  });

  it("재료 종류가 저장되지 않은 두 번째 와이어도 제조사 안전하중으로 판정한다", () => {
    const row = {
      sling_material_type: "wire_rope",
      wire_diameter_mm: 40,
      wire_manufacturer_safe_load: 33.66,
      wire_safety_coefficient: 5,
      sling_count: 2,
      sling_hitch: "2-leg",
      sling_angle_deg: 60,
      sling_combination: "series",
      sling_device_safe_load: 12.38,
      sling_secondary: {
        hitch: "2-leg",
        wireDiameterMm: "25",
        wireSafetyCoefficient: "5",
        wireManufacturerSafeLoad: "12.88",
      },
      load_weight: 12,
      hook_weight: 1.4,
      shackle_weight_val: 0.1,
      sling_rigging_weight: 1,
      crane_capacity: 19.2,
      boom_rotation_factor: 0.8,
      wind_speed_grade: "0~5",
      ground_inspection_factor: 1,
      load_protrusion_factor: 1,
      shackle_inch: "1-1/2",
    } as any;
    const input = buildRiggingInputFromRow(row);
    expect(input.slingSecondary?.slingMaterialType).toBe("wire_rope");
    expect(input.slingSecondary?.wireDiameterMm).toBe(25);
    expect(input.slingSecondary?.wireManufacturerSafeLoad).toBeCloseTo(12.88, 2);
    const result = calculateFullRigging(input);
    expect(result.secondarySlingSafeLoad).toBeCloseTo(12.88, 2);
    expect(result.slingSafeLoad).toBeCloseTo(12.38, 2);
    expect(result.tensionPerLeg).toBeCloseTo(7.563, 2);
    expect(result.slingJudgment).toBe("series_min");
    expect(result.slingOk).toBe(true);
    expect(result.equipmentOk).toBe(true);
    expect(result.loadUtilizationPct).toBeGreaterThan(85);
    expect(result.messages.some((m) => m.includes("0.0t"))).toBe(false);
    const refreshed = refreshRiggingDerivedFields(row);
    expect(Number(refreshed.sling_safe_load)).toBeCloseTo(12.38, 2);
    expect(refreshed.sling_ok).toBe("O.K");
  });

  it("조합만 있고 두 번째 줄이 비면 0톤과 비교하지 않는다", () => {
    const row = {
      sling_material_type: "wire_rope",
      wire_diameter_mm: 40,
      wire_manufacturer_safe_load: 33.66,
      sling_hitch: "2-leg",
      sling_angle_deg: 60,
      sling_combination: "series",
      sling_device_safe_load: 12.38,
      sling_secondary: {},
      load_weight: 12,
      hook_weight: 1.4,
      shackle_weight_val: 0.1,
      sling_rigging_weight: 1,
      crane_capacity: 19.2,
      boom_rotation_factor: 0.8,
      shackle_inch: "1-1/2",
    } as any;
    expect(parseSlingSecondary({})).toBeNull();
    expect(parseSlingSecondary({ beltWidthMm: 50, beltRatedLoad: 2 })?.slingMaterialType).toBe("sling_belt");
    const result = calculateFullRigging(buildRiggingInputFromRow(row));
    expect(result.slingJudgment).toBe("secondary_missing");
    expect(result.slingSafeLoad).toBeCloseTo(33.66, 2);
    expect(result.slingOk).toBe(false);
    expect(result.messages.some((m) => m.includes("두 번째 줄걸이의 굵기 또는 제조사 안전하중"))).toBe(true);
    expect(result.messages.some((m) => m.includes("1줄 안전하중 0.0t"))).toBe(false);
    const refreshed = refreshRiggingDerivedFields(row);
    expect(Number(refreshed.sling_safe_load)).toBeCloseTo(33.66, 2);
    expect(refreshed.sling_ok).toBe("N.G");
  });

  it("지름도 제조사 하중도 없는 두 번째 와이어는 0과 작은값을 내지 않는다", () => {
    const result = calculateFullRigging(wireInput({
      wireDiameterMm: 40,
      wireManufacturerSafeLoad: 33.66,
      slingHitch: "2-leg",
      slingCombination: "series",
      slingDeviceSafeLoad: 12,
      slingSecondary: {
        slingMaterialType: "wire_rope",
        wireDiameterMm: 0,
        wireSafetyCoefficient: 5,
        wireManufacturerSafeLoad: null,
        slingBeltWidthMm: 0,
        slingBeltRatedLoad: 0,
        roundSlingColor: "",
        roundSlingRatedLoad: 0,
        chainDiameterMm: 0,
      },
    }));
    expect(result.slingJudgment).toBe("secondary_missing");
    expect(result.slingSafeLoad).toBeCloseTo(33.66, 2);
    expect(result.slingOk).toBe(false);
    expect(result.messages.some((m) => m.includes("0.0t"))).toBe(false);
  });
});
