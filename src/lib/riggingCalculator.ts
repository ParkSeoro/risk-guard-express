/**
 * KOSHA 기준 리깅플랜 자동 계산 엔진
 * 
 * 계산 근거:
 * - 산업안전보건기준에 관한 규칙 제132조~제175조
 * - KOSHA GUIDE M-78 (양중작업 안전)
 * - 와이어로프 안전하중: (절단하중 × 안전계수(5 또는 10)) × 단말가공방법 × 줄걸이수 × 줄걸이 방법 × 줄걸이각도
 * - 슬링벨트 안전하중: 안전하중표 참조 (안전계수 6 적용, "S" 마크경우 7 적용)
 */

// ============================================================
// 와이어로프 절단하중 테이블 (6×24, 6×37 기준)
// 단위: mm → ton
// ============================================================
export const WIRE_ROPE_BREAKING_LOAD: Record<number, number> = {
  10: 5.45,
  12: 7.84,
  14: 10.7,
  16: 13.9,
  18: 17.6,
  20: 21.8,
  22: 26.3,
  24: 31.3,
  26: 36.8,
  28: 42.6,
  30: 48.9,
  32: 55.7,
  34: 62.8,
  36: 70.5,
  38: 78.5,
  40: 87.0,
  42: 95.9,
  44: 105.0,
  46: 115.0,
  48: 125.0,
  50: 136.0,
  52: 147.0,
  56: 170.0,
  60: 196.0,
};

// ============================================================
// 줄걸이 각도에 따른 장력 계수 (T = W / (n × cosθ))
// n = 줄걸이 수
// ============================================================
export const SLING_ANGLE_FACTOR: Record<number, number> = {
  0: 1.00,
  30: 1.16,
  45: 1.41,
  60: 2.00,
};

// ============================================================
// 단말가공법에 따른 효율 계수
// ============================================================
export const TERMINAL_METHOD_EFFICIENCY: Record<string, number> = {
  '탐블(24mm 이하)': 0.95,
  '압축(25mm 이상)': 0.90,
  '아이 스플라이스': 0.85,
  '클립 체결': 0.80,
};

// ============================================================
// 풍속에 따른 감소 계수
// ============================================================
export const WIND_SPEED_FACTORS: { label: string; range: string; factor: number }[] = [
  { label: '정상', range: '0~5', factor: 1.0 },
  { label: '인양능력 감소', range: '5~10', factor: 0.8 },
  { label: '인양능력 감소', range: '10~15', factor: 0.6 },
  { label: '작업 불가', range: '15~', factor: 0 },
];

// ============================================================
// 샤클 안전하중 테이블 (mm 기준, ton)
// ============================================================
export const SHACKLE_SAFE_LOAD: Record<number, number> = {
  10: 1.0,
  12: 1.5,
  14: 2.0,
  16: 3.2,
  18: 4.0,
  20: 5.0,
  22: 6.3,
  24: 8.0,
  26: 10.0,
  28: 12.0,
  30: 14.0,
  32: 16.0,
  34: 18.0,
  36: 20.0,
  38: 25.0,
  40: 28.0,
  42: 32.0,
  44: 35.0,
  46: 40.0,
  48: 45.0,
  50: 50.0,
};

export interface RiggingInput {
  // 양중기 제원
  equipmentName: string;
  ratedCapacity: number; // ton
  boomLength: number; // m
  workingRadius: number; // m
  liftingCapacity: number; // ton (인양능력 - 제원표 기준)
  outriggerDistance: number; // m

  // 줄걸이 - 와이어로프
  wireDiameterMm: number;
  slingCount: number; // 줄걸이 수
  slingMethod: string; // 줄걸이 방법
  slingStrandCount: number; // 꼬기 매달기 수
  slingAngleDeg: number;
  wireTerminalMethod: string; // 단말가공법
  wireSafetyCoefficient: number; // 안전계수 (5 또는 10)
  wireLiftCount: number; // 인양물 양중 수

  // 체결장구 - 샤클
  shackleDiameterMm: number;
  shackleAngleDeg: number;
  shackleCount: number; // 사용 갯수
  shackleQty: number;

  // 중량물 제원 (최대)
  loadWeight: number; // 인양물 (ton)
  hookWeight: number;
  shackleWeightVal: number;
  slingRiggingWeight: number;

  // 중량물 제원 (최소)
  loadWeightMin: number;
  hookWeightMin: number;
  shackleWeightMin: number;
  slingRiggingWeightMin: number;

  // 장비 안전성 검토 계수
  windSpeedGrade: string;
  windSpeedFactor: number;
  boomRotationFactor: number;
  groundInspectionFactor: number;
  loadProtrusionFactor: number;
  travelLoadFactor: number; // 주행(인양물 돌기) 횟수

  // 안전계수 프로그램
  safetyFactorPassenger: number; // 근로자탑승인 경우 (10)
  safetyFactorCargo: number; // 화물의 하중달기인 경우 (5)
}

export interface RiggingResult {
  // 중량물 총중량
  totalWeightMax: number;
  totalWeightMin: number;

  // 장비 안전성 검토
  equipmentWorkingLoad: number; // 작업하중 = 인양능력 × 풍속 × 봉대회전 × 지반 × 돌기주행
  equipmentOk: boolean;

  // 줄걸이 안전성 검토
  wireBreakingLoad: number; // 절단하중 (테이블 조회)
  wireSafeLoad: number; // 안전하중 = 절단하중 / 안전계수
  slingWorkingLoad: number; // 작업하중 = 절단하중 × 줄걸이각도 × 인양물양중수 / 안전계수
  slingOk: boolean;

  // 샤클 안전성 검토
  shackleSafeLoad: number; // 테이블 조회
  shackleWorkingLoad: number; // 작업하중 = 안전하중 × 인양각도 × 갯수
  shackleOk: boolean;

  // 와이어 세부
  angleFactor: number;
  safetyFactor: number; // 장비 안전율

  // 전체 판정
  overallOk: boolean;
  messages: string[];
}

/**
 * 와이어로프 절단하중 조회 (보간 포함)
 */
export function getWireBreakingLoad(diameterMm: number): number {
  if (WIRE_ROPE_BREAKING_LOAD[diameterMm]) return WIRE_ROPE_BREAKING_LOAD[diameterMm];
  // Interpolate
  const sizes = Object.keys(WIRE_ROPE_BREAKING_LOAD).map(Number).sort((a, b) => a - b);
  const lower = sizes.filter(s => s <= diameterMm).pop();
  const upper = sizes.find(s => s >= diameterMm);
  if (!lower || !upper) return 0;
  if (lower === upper) return WIRE_ROPE_BREAKING_LOAD[lower];
  const ratio = (diameterMm - lower) / (upper - lower);
  return WIRE_ROPE_BREAKING_LOAD[lower] + ratio * (WIRE_ROPE_BREAKING_LOAD[upper] - WIRE_ROPE_BREAKING_LOAD[lower]);
}

/**
 * 샤클 안전하중 조회
 */
export function getShackleSafeLoad(diameterMm: number): number {
  if (SHACKLE_SAFE_LOAD[diameterMm]) return SHACKLE_SAFE_LOAD[diameterMm];
  const sizes = Object.keys(SHACKLE_SAFE_LOAD).map(Number).sort((a, b) => a - b);
  const lower = sizes.filter(s => s <= diameterMm).pop();
  const upper = sizes.find(s => s >= diameterMm);
  if (!lower || !upper) return 0;
  if (lower === upper) return SHACKLE_SAFE_LOAD[lower];
  const ratio = (diameterMm - lower) / (upper - lower);
  return SHACKLE_SAFE_LOAD[lower] + ratio * (SHACKLE_SAFE_LOAD[upper] - SHACKLE_SAFE_LOAD[lower]);
}

/**
 * 줄걸이 각도 계수
 */
function getAngleFactor(angleDeg: number): number {
  if (SLING_ANGLE_FACTOR[angleDeg] !== undefined) return SLING_ANGLE_FACTOR[angleDeg];
  // Interpolate
  const angles = Object.keys(SLING_ANGLE_FACTOR).map(Number).sort((a, b) => a - b);
  const lower = angles.filter(a => a <= angleDeg).pop();
  const upper = angles.find(a => a >= angleDeg);
  if (lower === undefined || upper === undefined) return 1;
  if (lower === upper) return SLING_ANGLE_FACTOR[lower];
  const ratio = (angleDeg - lower) / (upper - lower);
  return SLING_ANGLE_FACTOR[lower] + ratio * (SLING_ANGLE_FACTOR[upper] - SLING_ANGLE_FACTOR[lower]);
}

/**
 * KOSHA 기준 전체 리깅 계산
 */
export function calculateFullRigging(input: RiggingInput): RiggingResult {
  const messages: string[] = [];

  // ─── 3. 중량물 총중량 ───
  const totalWeightMax = input.loadWeight + input.hookWeight + input.shackleWeightVal + input.slingRiggingWeight;
  const totalWeightMin = input.loadWeightMin + input.hookWeightMin + input.shackleWeightMin + input.slingRiggingWeightMin;

  // ─── 4. 장비 안전성 검토 ───
  // 작업하중 = 인양능력(정격) × 풍속계수 × 봉대회전계수 × 지반검사계수 × 인양물돌기주행계수
  const equipmentWorkingLoad = input.liftingCapacity 
    * input.windSpeedFactor 
    * input.boomRotationFactor 
    * input.groundInspectionFactor 
    * input.loadProtrusionFactor;

  const equipmentOk = equipmentWorkingLoad >= totalWeightMax;
  if (!equipmentOk) {
    messages.push(`⚠️ 장비 안전성 부적합: 작업하중 ${equipmentWorkingLoad.toFixed(1)}t < 총중량 ${totalWeightMax.toFixed(1)}t`);
  }

  // ─── 5. 줄걸이 안전성 검토 ───
  // 와이어로프 절단하중 조회
  const wireBreakingLoad = getWireBreakingLoad(input.wireDiameterMm);

  // 안전하중 계산: 
  // 와이어로프 안전하중 = (절단하중 × 안전계수(5 또는 10)) ÷ 단말가공방법효율 ÷ 줄걸이수 ÷ 줄걸이방법 ÷ 줄걸이각도
  // 실무 공식: 작업하중 = 절단하중 ÷ 안전계수 × 줄걸이각도계수
  // 실제 양식 기준:
  // 줄걸이 작업하중 = 절단하중 / 안전계수 * 줄걸이수 * 인양각도계수
  // 하지만 이미지의 계산: 와이어로프 절단하중 76.40 → 안전하중 계산 결과
  // 이미지: 규격 32mm, 절단하중 76,400ton(?), 인양각도 60, 작업하중(ton) 25, 인양하중(ton) 20,208 → O.K

  // 표준 공식 (KOSHA):
  // 와이어로프 안전하중 = 절단하중 / 안전계수
  const wireSafeLoad = wireBreakingLoad / input.wireSafetyCoefficient;

  // 줄걸이 작업하중 = 안전하중 × 인양각도계수(cos기반) × 줄걸이 수
  // 실제로는: 작업하중 = (절단하중 / 안전계수) * 줄걸이수 * (1/인양각도계수)
  // 인양각도 60도 → 계수 2.0 → 실효하중이 2배로 증가
  // 따라서: 줄걸이가 지탱가능한 하중 = (절단하중 / 안전계수) * (줄걸이수 / 인양각도계수)
  const angleFactor = getAngleFactor(input.slingAngleDeg);
  
  // 줄걸이 작업하중 (사용 가능한 최대 인양 하중)
  const slingWorkingLoad = (wireBreakingLoad / input.wireSafetyCoefficient) * input.slingCount / angleFactor;
  
  const slingOk = slingWorkingLoad >= totalWeightMax;
  if (!slingOk) {
    messages.push(`⚠️ 줄걸이 안전성 부적합: 작업하중 ${slingWorkingLoad.toFixed(1)}t < 총중량 ${totalWeightMax.toFixed(1)}t`);
  }

  // ─── 6. 샤클 안전성 검토 ───
  const shackleSafeLoad = getShackleSafeLoad(input.shackleDiameterMm);
  
  // 샤클 작업하중 = 안전하중 × 인양각도계수 × 사용개수
  // 이미지: 규격 2mm(?), 안전하중 35,000 → 인양각도 45 → 샤클 갯수 0.7 → 2,000 → 작업하중 49,000 → 인양하중 18,900 → O.K
  // 실제: 작업하중 = 안전하중 × 갯수 / 각도계수
  const shackleAngleFactor = getAngleFactor(input.shackleAngleDeg);
  const shackleWorkingLoad = shackleSafeLoad * input.shackleQty / shackleAngleFactor;

  const shackleOk = shackleWorkingLoad >= totalWeightMax;
  if (!shackleOk) {
    messages.push(`⚠️ 샤클 안전성 부적합: 작업하중 ${shackleWorkingLoad.toFixed(1)}t < 총중량 ${totalWeightMax.toFixed(1)}t`);
  }

  // 안전율 (장비 기준)
  const safetyFactor = totalWeightMax > 0 ? equipmentWorkingLoad / totalWeightMax : 0;

  const overallOk = equipmentOk && slingOk && shackleOk;
  if (overallOk) {
    messages.push(`✅ 모든 안전성 검토 통과 (장비 안전율: ${safetyFactor.toFixed(2)})`);
  }

  return {
    totalWeightMax,
    totalWeightMin,
    equipmentWorkingLoad,
    equipmentOk,
    wireBreakingLoad,
    wireSafeLoad,
    slingWorkingLoad,
    slingOk,
    shackleSafeLoad,
    shackleWorkingLoad,
    shackleOk,
    angleFactor,
    safetyFactor,
    overallOk,
    messages,
  };
}

/**
 * mm → inch 변환
 */
export function mmToInch(mm: number): number {
  return mm / 25.4;
}
