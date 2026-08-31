import { describe, expect, it } from "vitest";
import {
  CONDITION_DERATE,
  WIND_SPEED_BANDS,
  calculateFullRigging,
  resolveWindRule,
  slingHorizontalTensionFactor,
  tensionPerSlingLeg,
  type RiggingInput,
} from "@/lib/riggingCalculator";
import { buildRiggingInputFromRow } from "@/lib/riggingDerived";

function baseInput(over: Partial<RiggingInput> = {}): RiggingInput {
  return {
    equipmentName: "테스트 크레인",
    ratedCapacity: 53.5,
    boomLength: 20,
    workingRadius: 8,
    liftingCapacity: 53.5,
    outriggerDistance: 7,
    slingMaterialType: "round_sling",
    wireDiameterMm: 0,
    slingCount: 2,
    slingAngleDeg: 60,
    wireTerminalMethod: "탐블(24mm 이하)",
    wireSafetyCoefficient: 5,
    slingBeltWidthMm: 0,
    slingBeltRatedLoad: 0,
    roundSlingColor: "orange-40",
    roundSlingRatedLoad: 40,
    chainDiameterMm: 0,
    chainLegCount: 4,
    shackleInch: "2",
    shackleQty: 2,
    loadWeight: 39.6,
    hookWeight: 2.4,
    shackleWeightVal: 0,
    slingRiggingWeight: 0,
    loadWeightMin: 10,
    hookWeightMin: 2.4,
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

describe("풍속 구간은 법령·KOSHA마다 결과가 달라야 한다", () => {
  it("세 구간 라벨·계수가 서로 다르다", () => {
    const labels = WIND_SPEED_BANDS.map((b) => b.label);
    expect(new Set(labels).size).toBe(WIND_SPEED_BANDS.length);
    expect(WIND_SPEED_BANDS.map((b) => b.factor)).toEqual([1, 0.8, 0]);
    expect(WIND_SPEED_BANDS[2].stopWork).toBe(true);
  });

  it("0~5는 정격 100%, 5~10은 C-99 80%, 10 이상은 중지", () => {
    expect(resolveWindRule({ grade: "0~5" }).factor).toBe(1);
    expect(resolveWindRule({ grade: "5~10" }).factor).toBe(0.8);
    expect(resolveWindRule({ grade: "10~" }).stopWork).toBe(true);
    expect(resolveWindRule({ grade: "10~15" }).stopWork).toBe(true);
    expect(resolveWindRule({ grade: "15~" }).stopWork).toBe(true);
    expect(resolveWindRule({ speedMs: 4.9 }).factor).toBe(1);
    expect(resolveWindRule({ speedMs: 5 }).factor).toBe(0.8);
    expect(resolveWindRule({ speedMs: 9.9 }).factor).toBe(0.8);
    expect(resolveWindRule({ speedMs: 10 }).stopWork).toBe(true);
    expect(resolveWindRule({ grade: "8m/s" }).factor).toBe(0.8);
    expect(resolveWindRule({ grade: "12m/s" }).stopWork).toBe(true);
  });

  it("저장된 factor가 1이어도 등급 5~10이면 80%를 쓴다", () => {
    const r = calculateFullRigging(baseInput({
      windSpeedGrade: "5~10",
      windSpeedFactor: 1,
    }));
    expect(r.equipmentWorkingLoad).toBeCloseTo(53.5 * 0.8, 5);
    expect(r.windStop).toBe(false);
    expect(r.equipmentOk).toBe(true);
  });

  it("5~10m/s 80%로 총중량을 못 이기면 장비 N.G", () => {
    const r = calculateFullRigging(baseInput({
      windSpeedGrade: "5~10",
      loadWeight: 45,
    }));
    expect(r.equipmentWorkingLoad).toBeCloseTo(42.8, 5);
    expect(r.totalWeightMax).toBeCloseTo(47.4, 5);
    expect(r.equipmentOk).toBe(false);
  });

  it("10m/s 이상은 적용 정격 0 · 장비 N.G", () => {
    const r = calculateFullRigging(baseInput({ windSpeedGrade: "10~" }));
    expect(r.windStop).toBe(true);
    expect(r.equipmentWorkingLoad).toBe(0);
    expect(r.equipmentOk).toBe(false);
    expect(r.overallOk).toBe(false);
  });
});

describe("인양각도 = 수평면과 이루는 각", () => {
  it("60° 계수 1/sin60 ≈ 1.16 (수직에서 cos60=2가 아님)", () => {
    expect(slingHorizontalTensionFactor(60)).toBeCloseTo(1 / Math.sin(Math.PI / 3), 8);
    expect(slingHorizontalTensionFactor(90)).toBeCloseTo(1, 8);
    expect(slingHorizontalTensionFactor(30)).toBeCloseTo(2, 8);
  });

  it("훅은 줄 위라 장력에서 빼고, 샤클 개수로 SWL을 합치지 않는다", () => {
    const r = calculateFullRigging(baseInput());
    expect(r.slingLoadTon).toBeCloseTo(39.6, 5);
    expect(r.totalWeightMax).toBeCloseTo(42, 5);
    expect(r.tensionPerLeg).toBeCloseTo(tensionPerSlingLeg({
      slingLoadTon: 39.6,
      legCount: 2,
      horizontalDeg: 60,
    }), 8);
    expect(r.tensionPerLeg).toBeCloseTo((39.6 * (1 / Math.sin(Math.PI / 3))) / 2, 5);
    expect(r.shackleSafeLoad).toBe(35);
    expect(r.shackleOk).toBe(true);
    expect(r.slingOk).toBe(true);
  });
});

describe("현장 42t / 53.5t / 60° / 2인치 샤클", () => {
  it("풍속 0~5 · 조건 미해당이면 장비·줄·샤클 O.K (엑셀 맞추기 아님)", () => {
    const r = calculateFullRigging(baseInput());
    expect(r.equipmentWorkingLoad).toBeCloseTo(53.5, 5);
    expect(r.equipmentOk).toBe(true);
    expect(r.slingOk).toBe(true);
    expect(r.shackleOk).toBe(true);
    expect(r.overallOk).toBe(true);
  });

  it("선회·경사·주행을 무조건 0.8³ 하면 법령과 어긋나 부적합이 된다", () => {
    const r = calculateFullRigging(baseInput({
      boomRotationFactor: CONDITION_DERATE,
      groundInspectionFactor: CONDITION_DERATE,
      loadProtrusionFactor: CONDITION_DERATE,
    }));
    expect(r.equipmentWorkingLoad).toBeCloseTo(53.5 * 0.8 ** 3, 5);
    expect(r.equipmentOk).toBe(false);
  });

  it("row 기본값(계수 없음)은 1로 읽어 해당 케이스가 O.K", () => {
    const input = buildRiggingInputFromRow({
      load_weight: 39.6,
      hook_weight: 2.4,
      crane_capacity: 53.5,
      rated_capacity: 53.5,
      sling_material_type: "round_sling",
      sling_belt_color: "orange-40",
      round_sling_rated_load: 40,
      sling_count: 2,
      sling_angle_deg: 60,
      shackle_inch: "2",
      shackle_qty: 2,
      wind_speed_grade: "0~5",
    });
    const r = calculateFullRigging(input);
    expect(input.boomRotationFactor).toBe(1);
    expect(r.equipmentWorkingLoad).toBeCloseTo(53.5, 5);
    expect(r.overallOk).toBe(true);
  });
});
