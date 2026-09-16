import { describe, expect, it } from "vitest";
import {
  WIRE_ROPE_BREAKING_LOAD,
  WIRE_ROPE_TABLE_MAX_MM,
  calculateFullRigging,
  getWireBreakingLoad,
  type RiggingInput,
} from "@/lib/riggingCalculator";
import { buildRiggingInputFromRow, riggingResultToPatch } from "@/lib/riggingDerived";

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

  it("0·음수 지름은 0이다", () => {
    expect(getWireBreakingLoad(0)).toBe(0);
    expect(getWireBreakingLoad(-12)).toBe(0);
    expect(getWireBreakingLoad(Number.NaN)).toBe(0);
  });
});
