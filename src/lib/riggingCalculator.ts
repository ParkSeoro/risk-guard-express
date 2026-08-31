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

/**
 * 인양각도 = 줄과 수평면이 이루는 각 (현장·KOSHA 줄걸이 관례).
 * 60° → 1/sin60° ≈ 1.16. 수직(90°) = 1.00.
 */
export const SLING_HORIZONTAL_RECOMMENDED_DEG = 60;
export const SLING_HORIZONTAL_MIN_DEG = 30;

export function slingHorizontalTensionFactor(horizontalDeg: number): number {
  const deg = Number(horizontalDeg);
  if (!Number.isFinite(deg) || deg <= 0) return Number.POSITIVE_INFINITY;
  const s = Math.sin((deg * Math.PI) / 180);
  if (s <= 1e-6) return Number.POSITIVE_INFINITY;
  return 1 / s;
}

export function tensionPerSlingLeg(opts: {
  slingLoadTon: number;
  legCount: number;
  horizontalDeg: number;
}): number {
  const n = opts.legCount > 0 ? opts.legCount : 2;
  const k = slingHorizontalTensionFactor(opts.horizontalDeg);
  if (!Number.isFinite(k)) return opts.slingLoadTon;
  return (opts.slingLoadTon * k) / n;
}

/** @deprecated 장력식과 이중 적용하지 말 것. 호환용. */
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

/** 수직에서 벌어진 각 기준 구표. 입력은 수평각을 쓴다. */
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

/**
 * 풍속 — 법령에 「정격을 풍속으로 깎는」 동일 감률 표는 없음.
 * 이동식: C-99 5~10m/s 인양하중표 20% 감, C-69·철골 제383조는 10m/s 이상 중지.
 */
export type WindRule = {
  range: string;
  label: string;
  factor: number;
  stopWork: boolean;
  legal: string;
};

export const WIND_SPEED_BANDS: WindRule[] = [
  {
    range: "0~5",
    label: "정상 · 정격 100%",
    factor: 1,
    stopWork: false,
    legal: "규칙 제146조(정격하중 준수)",
  },
  {
    range: "5~10",
    label: "정격 80% (C-99)",
    factor: 0.8,
    stopWork: false,
    legal: "KOSHA GUIDE C-99: 5~10m/s 인양하중표 20% 감",
  },
  {
    range: "10~",
    label: "작업 중지",
    factor: 0,
    stopWork: true,
    legal: "KOSHA C-69 10m/s 중지 · 철골 시 규칙 제383조",
  },
];

export const WIND_SPEED_FACTORS = WIND_SPEED_BANDS.map((b) => ({
  label: b.label,
  range: b.range,
  factor: b.factor,
}));

/** "8m/s", 숫자 입력, 구등급 10~15 등을 해석. */
export function parseWindSpeedMs(grade?: string | null, speedMs?: number | null): number | null {
  const speed = Number(speedMs);
  if (Number.isFinite(speed) && speedMs != null && String(speedMs) !== "") return speed;
  const g = String(grade || "").trim();
  const m = g.match(/^(\d+(?:\.\d+)?)\s*m\/s/i);
  if (m) return Number(m[1]);
  return null;
}

export function resolveWindRule(opts: { grade?: string | null; speedMs?: number | null }): WindRule {
  const speed = parseWindSpeedMs(opts.grade, opts.speedMs);
  if (speed != null) {
    if (speed < 5) return WIND_SPEED_BANDS[0];
    if (speed < 10) return WIND_SPEED_BANDS[1];
    return WIND_SPEED_BANDS[2];
  }
  const g = String(opts.grade || "0~5").trim();
  if (g === "0~5") return WIND_SPEED_BANDS[0];
  if (g === "5~10") return WIND_SPEED_BANDS[1];
  if (g === "10~" || g === "10~15" || g === "15~" || g.startsWith("10") || g.startsWith("15")) {
    return WIND_SPEED_BANDS[2];
  }
  return WIND_SPEED_BANDS[0];
}

export function getWindFactorBySpeed(speedMs: number): number {
  return resolveWindRule({ speedMs }).factor;
}

/** 선회·경사·주행은 법령 필수 감률이 아님. 해당할 때만 제조사 일반 80%(제147조). */
export const CONDITION_DERATE = 0.8;

export function isConditionDerated(v: unknown): boolean {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 0.999;
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
  windSpeedGrade?: string | null;
  windSpeedMs?: number | null;
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
  windStop: boolean;
  slingAngleFactor: number;
  slingAngleWarn: boolean;
  slingLoadTon: number;

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
  /** 훅 블록은 줄 위 — 줄·샤클은 순하중+아래 줄걸이만 (규칙 제146조 정격은 크레인 총중량). */
  const slingLoadTon = input.loadWeight + input.shackleWeightVal + input.slingRiggingWeight;

  const legCount = input.slingMaterialType === 'chain_sling' ? input.chainLegCount : input.slingCount;
  const effectiveLegCount = legCount > 0 ? legCount : 2;
  const horizontalDeg = input.slingAngleDeg || SLING_HORIZONTAL_RECOMMENDED_DEG;
  const slingAngleFactor = slingHorizontalTensionFactor(horizontalDeg);
  const slingAngleWarn = horizontalDeg < SLING_HORIZONTAL_RECOMMENDED_DEG;
  const tensionPerLeg = tensionPerSlingLeg({
    slingLoadTon,
    legCount: effectiveLegCount,
    horizontalDeg,
  });

  const wind = resolveWindRule({
    grade: input.windSpeedGrade,
    speedMs: input.windSpeedMs,
  });
  /** 등급이 SSOT. 저장된 factor(구 1.0/0.6)는 법령 구간과 어긋날 수 있어 쓰지 않음. */
  const windFactor = wind.factor;
  const rot = Number(input.boomRotationFactor) || 1;
  const ground = Number(input.groundInspectionFactor) || 1;
  const travel = Number(input.loadProtrusionFactor) || 1;

  const equipmentWorkingLoad = wind.stopWork
    ? 0
    : input.liftingCapacity * windFactor * rot * ground * travel;

  const equipmentOk = !wind.stopWork && equipmentWorkingLoad >= totalWeightMax;
  const equipmentSafetyFactor = totalWeightMax > 0 ? equipmentWorkingLoad / totalWeightMax : 0;
  if (wind.stopWork) {
    messages.push(`⚠️ 풍속 작업 중지 — ${wind.legal}`);
  } else if (!equipmentOk) {
    messages.push(`⚠️ 장비 안전성 부적합: 적용 정격 ${equipmentWorkingLoad.toFixed(1)}t < 총중량 ${totalWeightMax.toFixed(1)}t (규칙 제146조)`);
  }
  if (!wind.stopWork && equipmentSafetyFactor > 0 && equipmentSafetyFactor < 1.25) {
    messages.push(`⚠️ 여유율 ${equipmentSafetyFactor.toFixed(2)} < 1.25 (권고, 법령 필수 아님)`);
  }
  if (slingAngleWarn) {
    messages.push(`⚠️ 인양각도(수평) ${horizontalDeg}° < 60° — 줄이 벌어져 장력이 커집니다. 60° 이상 권고`);
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
      slingSafeLoad = slingRatedLoad;
      break;
    }
    case 'round_sling': {
      slingRatedLoad = input.roundSlingRatedLoad || getRoundSlingRatedLoadByColor(input.roundSlingColor);
      slingSafeLoad = slingRatedLoad;
      break;
    }
    case 'chain_sling': {
      const chainLoadPerLeg = getChainSlingLoad(input.chainDiameterMm);
      slingRatedLoad = chainLoadPerLeg;
      slingSafeLoad = chainLoadPerLeg;
      break;
    }
  }

  const slingOk = slingSafeLoad >= tensionPerLeg;
  if (!slingOk) {
    messages.push(`⚠️ 줄걸이 안전성 부적합: 1줄 안전하중 ${slingSafeLoad.toFixed(1)}t < 1줄 장력 ${tensionPerLeg.toFixed(1)}t`);
  }

  if (!slingOk) {
    if (input.slingMaterialType === 'sling_belt') {
      const needed = SLING_BELT_BY_WIDTH.find(s => s.ratedLoad >= tensionPerLeg);
      if (needed) recommendations.push(`슬링벨트 ${needed.widthMm}mm(${needed.ratedLoad}톤) 이상 필요`);
    }
    if (input.slingMaterialType === 'round_sling') {
      const needed = ROUND_SLING_BY_COLOR.find(s => s.ratedLoad >= tensionPerLeg);
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
    windStop: wind.stopWork,
    slingAngleFactor,
    slingAngleWarn,
    slingLoadTon,
    slingRatedLoad, slingSafeLoad, slingOk,
    shackleSafeLoad, shackleOk,
    wireBreakingLoad, wireSafeLoad,
    overallOk, messages, recommendations,
  };
}
