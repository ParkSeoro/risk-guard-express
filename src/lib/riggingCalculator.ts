/**
 * KOSHA 기준 리깅플랜 자동 계산 엔진
 *
 * 줄걸이·샤클 표는 riggingHardwareCatalog (EN 1492-2 / Crosby G-2130).
 */

import {
  HEAVY_CRANE_CLASSES,
  ROUND_SLING_BY_COLOR,
  ROUND_SLING_OPTIONS,
  SHACKLE_INCH_LOAD,
  getRoundSlingRatedLoadByColor,
  getShackleSafeLoadByInch,
} from "@/lib/riggingHardwareCatalog";

export {
  ROUND_SLING_BY_COLOR,
  ROUND_SLING_OPTIONS,
  SHACKLE_INCH_LOAD,
  getRoundSlingRatedLoadByColor,
  getShackleSafeLoadByInch,
  HEAVY_CRANE_CLASSES,
};

// ============================================================
// 와이어로프 절단하중 테이블 (6×24, 6×37 기준) mm → ton
// ============================================================
export const WIRE_ROPE_BREAKING_LOAD: Record<number, number> = {
  10: 5.45, 12: 7.84, 14: 10.7, 16: 13.9, 18: 17.6,
  20: 21.8, 22: 26.3, 24: 31.3, 26: 36.8, 28: 42.6,
  30: 48.9, 32: 55.7, 34: 62.8, 36: 70.5, 38: 78.5,
  40: 87.0, 42: 95.9, 44: 105.0, 46: 115.0, 48: 125.0,
  50: 136.0, 52: 147.0, 56: 170.0, 60: 196.0,
};

// ============================================================
// 슬링벨트(웹슬링) 폭(mm) 기준 정격하중 (ton)
// ============================================================
export const SLING_BELT_BY_WIDTH: { widthMm: number; ratedLoad: number }[] = [
  { widthMm: 25, ratedLoad: 1 },
  { widthMm: 50, ratedLoad: 2 },
  { widthMm: 75, ratedLoad: 3 },
  { widthMm: 100, ratedLoad: 4 },
  { widthMm: 125, ratedLoad: 5 },
  { widthMm: 150, ratedLoad: 6 },
];

// Legacy alias for backward compatibility
export const SLING_BELT_BY_COLOR = ROUND_SLING_BY_COLOR;

// ============================================================
// 체인슬링 규격별 허용하중 (mm → ton, 1줄 기준)
// ============================================================
export const CHAIN_SLING_LOAD: Record<number, number> = {
  6: 1.12, 8: 2.0, 10: 3.15, 13: 5.3, 16: 8.0, 20: 12.5, 22: 15.0, 26: 21.2,
};

// ============================================================
// 슬링벨트/라운드슬링 각도 보정 계수
// ============================================================
export const SLING_BELT_ANGLE_FACTOR: { maxAngle: number; factor: number }[] = [
  { maxAngle: 45, factor: 1.0 },
  { maxAngle: 60, factor: 0.8 },
  { maxAngle: 90, factor: 0.6 },
];

export function getSlingBeltAngleFactor(angleDeg: number): number {
  if (angleDeg <= 45) return 1.0;
  if (angleDeg <= 60) return 0.8;
  return 0.6;
}

// ============================================================
// 와이어로프 줄걸이 각도에 따른 장력 계수
// ============================================================
export const SLING_ANGLE_FACTOR: Record<number, number> = {
  0: 1.00, 30: 1.16, 45: 1.41, 60: 2.00,
};

// ============================================================
// 단말가공법에 따른 효율 계수
// ============================================================
export const TERMINAL_METHOD_EFFICIENCY: Record<string, number> = {
  '탐블(24mm 이하)': 0.95, '압축(25mm 이상)': 0.90,
  '아이 스플라이스': 0.85, '클립 체결': 0.80,
};

// ============================================================
// 풍속 계수
// ============================================================
export const WIND_SPEED_FACTORS: { label: string; range: string; factor: number }[] = [
  { label: '정상', range: '0~5', factor: 1.0 },
  { label: '인양능력 감소', range: '5~10', factor: 0.8 },
  { label: '인양능력 감소', range: '10~15', factor: 0.6 },
  { label: '작업 불가', range: '15~', factor: 0 },
];

export function getWindFactorBySpeed(speedMs: number): number {
  if (speedMs <= 5) return 1.0;
  if (speedMs <= 10) return 0.8;
  if (speedMs <= 15) return 0.6;
  return 0;
}

// 샤클 인치 표: src/lib/riggingHardwareCatalog.ts (Crosby G-2130)

// Legacy mm-based shackle (kept for backward compat)
export const SHACKLE_SAFE_LOAD: Record<number, number> = {
  10: 1.0, 12: 1.5, 14: 2.0, 16: 3.2, 18: 4.0, 20: 5.0, 22: 6.3, 24: 8.0,
  26: 10.0, 28: 12.0, 30: 14.0, 32: 16.0, 34: 18.0, 36: 20.0, 38: 25.0,
  40: 28.0, 42: 32.0, 44: 35.0, 46: 40.0, 48: 45.0, 50: 50.0,
};

// ============================================================
// 장비 프리셋
// ============================================================
export interface CranePreset {
  id: string;
  name: string;
  ratedCapacity: number;
  defaultBoomLength: number;
  defaultWorkingRadius: number;
  defaultCapacityAtPoint?: number;
  source?: string;
  /** Only true when loadChart is a manufacturer table we may interpolate. */
  chartVerified: boolean;
  loadChart: { boomLength: number; radius: number; capacity: number }[];
}

function tonClassOnly(id: string, name: string, ton: number): CranePreset {
  return {
    id,
    name,
    ratedCapacity: ton,
    defaultBoomLength: 0,
    defaultWorkingRadius: 0,
    source: "정격하중만. 해당 반경 인양능력은 기종 제원표/LMI를 입력",
    chartVerified: false,
    loadChart: [],
  };
}

export const CRANE_PRESETS: CranePreset[] = [
  tonClassOnly("crane_25t", "25톤 크레인", 25),
  tonClassOnly("crane_50t", "50톤 크레인", 50),
  tonClassOnly("crane_100t", "100톤 크레인", 100),
  tonClassOnly("crane_200t", "200톤 크레인", 200),
  ...HEAVY_CRANE_CLASSES,
];

/** Interpolates only verified manufacturer charts. Otherwise 0 (do not guess). */
export function lookupCraneCapacity(preset: CranePreset, boomLength: number, radius: number): number {
  if (!preset.chartVerified || !preset.loadChart?.length) return 0;
  const matches = preset.loadChart
    .filter((e) => e.boomLength <= boomLength + 2 && e.radius <= radius + 1)
    .sort((a, b) => {
      const da = Math.abs(a.boomLength - boomLength) + Math.abs(a.radius - radius);
      const db = Math.abs(b.boomLength - boomLength) + Math.abs(b.radius - radius);
      return da - db;
    });
  if (matches.length > 0) return matches[0].capacity;
  const byBoom = preset.loadChart.filter((e) => e.boomLength <= boomLength + 5);
  if (byBoom.length > 0) {
    const closest = byBoom.sort((a, b) => Math.abs(a.radius - radius) - Math.abs(b.radius - radius));
    return closest[0].capacity;
  }
  return 0;
}

// ============================================================
// 줄걸이 재료 타입
// ============================================================
export type SlingMaterialType = 'wire_rope' | 'sling_belt' | 'round_sling' | 'chain_sling';

export const SLING_MATERIAL_OPTIONS: { value: SlingMaterialType; label: string }[] = [
  { value: 'wire_rope', label: '와이어로프' },
  { value: 'sling_belt', label: '슬링벨트 (웹슬링)' },
  { value: 'round_sling', label: '라운드슬링' },
  { value: 'chain_sling', label: '체인슬링' },
];

// ============================================================
// Lookup helpers
// ============================================================
function interpolate(table: Record<number, number>, key: number): number {
  if (table[key] !== undefined) return table[key];
  const sizes = Object.keys(table).map(Number).sort((a, b) => a - b);
  const lower = sizes.filter(s => s <= key).pop();
  const upper = sizes.find(s => s >= key);
  if (lower === undefined || upper === undefined) return 0;
  if (lower === upper) return table[lower];
  const ratio = (key - lower) / (upper - lower);
  return table[lower] + ratio * (table[upper] - table[lower]);
}

export function getWireBreakingLoad(diameterMm: number): number {
  return interpolate(WIRE_ROPE_BREAKING_LOAD, diameterMm);
}

export function getShackleSafeLoad(diameterMm: number): number {
  return interpolate(SHACKLE_SAFE_LOAD, diameterMm);
}


export function getChainSlingLoad(diameterMm: number): number {
  return interpolate(CHAIN_SLING_LOAD, diameterMm);
}

export function getSlingBeltRatedLoadByWidth(widthMm: number): number {
  const found = SLING_BELT_BY_WIDTH.find(s => s.widthMm === widthMm);
  return found?.ratedLoad ?? 0;
}


// Legacy alias
export function getSlingBeltRatedLoad(color: string): number {
  return getRoundSlingRatedLoadByColor(color);
}

export function mmToInch(mm: number): number {
  return mm / 25.4;
}

// ============================================================
// Input / Result types
// ============================================================
export interface RiggingInput {
  equipmentName: string;
  ratedCapacity: number;
  boomLength: number;
  workingRadius: number;
  liftingCapacity: number;
  outriggerDistance: number;

  slingMaterialType: SlingMaterialType;

  wireDiameterMm: number;
  slingCount: number;
  slingAngleDeg: number;
  wireTerminalMethod: string;
  wireSafetyCoefficient: number;

  // 슬링벨트 (폭 기준)
  slingBeltWidthMm: number;
  slingBeltRatedLoad: number;

  // 라운드슬링 (색상 기준)
  roundSlingColor: string;
  roundSlingRatedLoad: number;

  // 체인슬링
  chainDiameterMm: number;
  chainLegCount: number;

  // 샤클
  shackleInch: string;
  shackleQty: number;

  // 중량물
  loadWeight: number;
  hookWeight: number;
  shackleWeightVal: number;
  slingRiggingWeight: number;
  loadWeightMin: number;
  hookWeightMin: number;
  shackleWeightMin: number;
  slingRiggingWeightMin: number;

  // 장비 안전성 계수
  windSpeedFactor: number;
  boomRotationFactor: number;
  groundInspectionFactor: number;
  loadProtrusionFactor: number;
}

export interface RiggingResult {
  totalWeightMax: number;
  totalWeightMin: number;
  tensionPerLeg: number;

  equipmentWorkingLoad: number;
  equipmentOk: boolean;
  equipmentSafetyFactor: number;

  slingRatedLoad: number;
  slingSafeLoad: number;
  slingOk: boolean;

  shackleSafeLoad: number;
  shackleOk: boolean;

  wireBreakingLoad: number;
  wireSafeLoad: number;

  overallOk: boolean;
  messages: string[];
  recommendations: string[];
}

// ============================================================
// Main calculation
// ============================================================
export function calculateFullRigging(input: RiggingInput): RiggingResult {
  const messages: string[] = [];
  const recommendations: string[] = [];

  const totalWeightMax = input.loadWeight + input.hookWeight + input.shackleWeightVal + input.slingRiggingWeight;
  const totalWeightMin = input.loadWeightMin + input.hookWeightMin + input.shackleWeightMin + input.slingRiggingWeightMin;

  const angleRad = (input.slingAngleDeg * Math.PI) / 180;
  const cosAngle = Math.cos(angleRad);
  const legCount = input.slingMaterialType === 'chain_sling' ? input.chainLegCount : input.slingCount;
  const effectiveLegCount = legCount > 0 ? legCount : 2;
  const tensionPerLeg = cosAngle > 0 ? totalWeightMax / (effectiveLegCount * cosAngle) : totalWeightMax;

  // Equipment safety
  const equipmentWorkingLoad = input.liftingCapacity
    * input.windSpeedFactor
    * input.boomRotationFactor
    * input.groundInspectionFactor
    * input.loadProtrusionFactor;

  const equipmentOk = equipmentWorkingLoad >= totalWeightMax;
  const equipmentSafetyFactor = totalWeightMax > 0 ? equipmentWorkingLoad / totalWeightMax : 0;
  if (!equipmentOk) {
    messages.push(`⚠️ 장비 안전성 부적합: 작업하중 ${equipmentWorkingLoad.toFixed(1)}t < 총중량 ${totalWeightMax.toFixed(1)}t`);
  }
  if (equipmentSafetyFactor > 0 && equipmentSafetyFactor < 1.25) {
    messages.push(`⚠️ 장비 안전율 ${equipmentSafetyFactor.toFixed(2)} < 1.25 경고`);
  }

  // Sling safety (per material)
  let slingRatedLoad = 0;
  let slingSafeLoad = 0;
  let wireBreakingLoad = 0;
  let wireSafeLoad = 0;

  switch (input.slingMaterialType) {
    case 'wire_rope': {
      wireBreakingLoad = getWireBreakingLoad(input.wireDiameterMm);
      wireSafeLoad = wireBreakingLoad / (input.wireSafetyCoefficient || 5);
      slingRatedLoad = wireSafeLoad;
      slingSafeLoad = wireSafeLoad;
      break;
    }
    case 'sling_belt': {
      slingRatedLoad = input.slingBeltRatedLoad || getSlingBeltRatedLoadByWidth(input.slingBeltWidthMm);
      const beltFactor = getSlingBeltAngleFactor(input.slingAngleDeg);
      slingSafeLoad = slingRatedLoad * beltFactor;
      break;
    }
    case 'round_sling': {
      slingRatedLoad = input.roundSlingRatedLoad || getRoundSlingRatedLoadByColor(input.roundSlingColor);
      const roundFactor = getSlingBeltAngleFactor(input.slingAngleDeg);
      slingSafeLoad = slingRatedLoad * roundFactor;
      break;
    }
    case 'chain_sling': {
      const chainLoadPerLeg = getChainSlingLoad(input.chainDiameterMm);
      slingRatedLoad = chainLoadPerLeg;
      const chainFactor = getSlingBeltAngleFactor(input.slingAngleDeg);
      slingSafeLoad = chainLoadPerLeg * chainFactor;
      break;
    }
  }

  const slingOk = slingSafeLoad >= tensionPerLeg;
  if (!slingOk) {
    messages.push(`⚠️ 줄걸이 안전성 부적합: 안전하중 ${slingSafeLoad.toFixed(1)}t < 장력 ${tensionPerLeg.toFixed(1)}t`);
  }

  // Recommendations
  if (!slingOk) {
    if (input.slingMaterialType === 'sling_belt') {
      const needed = SLING_BELT_BY_WIDTH.find(s => s.ratedLoad * getSlingBeltAngleFactor(input.slingAngleDeg) >= tensionPerLeg);
      if (needed) recommendations.push(`슬링벨트 ${needed.widthMm}mm(${needed.ratedLoad}톤) 이상 필요`);
    }
    if (input.slingMaterialType === 'round_sling') {
      const needed = ROUND_SLING_BY_COLOR.find(s => s.ratedLoad * getSlingBeltAngleFactor(input.slingAngleDeg) >= tensionPerLeg);
      if (needed) recommendations.push(`라운드슬링 ${needed.label}(${needed.ratedLoad}톤) 이상 필요`);
    }
  }

  // Shackle safety
  const shackleSafeLoad = getShackleSafeLoadByInch(input.shackleInch);
  const shackleOk = shackleSafeLoad >= tensionPerLeg;
  if (!shackleOk) {
    messages.push(`⚠️ 샤클 안전성 부적합: 안전하중 ${shackleSafeLoad.toFixed(1)}t < 장력 ${tensionPerLeg.toFixed(1)}t`);
    const needed = SHACKLE_INCH_LOAD.find(s => s.safeLoad >= tensionPerLeg);
    if (needed) recommendations.push(`샤클 ${needed.label} 이상 권장`);
  }

  const overallOk = equipmentOk && slingOk && shackleOk;
  if (overallOk) {
    messages.push(`✅ 모든 안전성 검토 통과 (장비 안전율: ${equipmentSafetyFactor.toFixed(2)})`);
  }

  return {
    totalWeightMax, totalWeightMin, tensionPerLeg,
    equipmentWorkingLoad, equipmentOk, equipmentSafetyFactor,
    slingRatedLoad, slingSafeLoad, slingOk,
    shackleSafeLoad, shackleOk,
    wireBreakingLoad, wireSafeLoad,
    overallOk, messages, recommendations,
  };
}
