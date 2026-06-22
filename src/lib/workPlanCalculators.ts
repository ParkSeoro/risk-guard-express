/**
 * 작업계획서 법정 계산기 모음.
 * 산업안전보건기준에 관한 규칙·KOSHA GUIDE 기준식.
 *
 * 모든 계산기는 입력 검증 + 자동 결과 + 적합/부적합 판정 + 법적 근거를 반환합니다.
 */

export type CalcVerdict = "pass" | "fail" | "warn";
export interface CalcResult {
  verdict: CalcVerdict;
  /** 사용자에게 보여줄 한 줄 결론 */
  conclusion: string;
  /** 계산 내역 (라벨 → 값 문자열) */
  breakdown: Record<string, string>;
  /** 법적/기술 근거 */
  legalBasis: string;
  /** 권장 조치 (있을 경우) */
  recommendations?: string[];
}

/* ============================================================
 * 1) 굴착 사면 안전율 — KOSHA GUIDE C-39, 산업안전보건기준에 관한 규칙 별표 11
 * 토질별 표준 기울기 vs 실제 기울기 비교
 * ============================================================ */
export const SOIL_STANDARD_SLOPE: Record<string, { ratio: string; horizontal: number; vertical: number }> = {
  암반_풍화: { ratio: "1:1.0", horizontal: 1.0, vertical: 1.0 },
  암반_연암: { ratio: "1:0.5", horizontal: 0.5, vertical: 1.0 },
  암반_경암: { ratio: "1:0.3", horizontal: 0.3, vertical: 1.0 },
  토사_모래: { ratio: "1:1.8", horizontal: 1.8, vertical: 1.0 },
  토사_점토: { ratio: "1:1.2", horizontal: 1.2, vertical: 1.0 },
  토사_사질토: { ratio: "1:1.0", horizontal: 1.0, vertical: 1.0 },
  토사_습한점토: { ratio: "1:1.5", horizontal: 1.5, vertical: 1.0 },
};

export interface ExcavationSlopeInput {
  soilType: keyof typeof SOIL_STANDARD_SLOPE;
  depthM: number;
  /** 실제 사면 수평거리 (m) — 1m 수직 기준 */
  actualHorizontal: number;
}

export function calcExcavationSlope(input: ExcavationSlopeInput): CalcResult {
  const std = SOIL_STANDARD_SLOPE[input.soilType];
  if (!std) {
    return {
      verdict: "fail",
      conclusion: "토질 종류를 선택해주세요.",
      breakdown: {},
      legalBasis: "산업안전보건기준에 관한 규칙 별표 11",
    };
  }
  const required = std.horizontal;
  const actual = Number(input.actualHorizontal) || 0;
  const safe = actual >= required;
  const recommended = (input.depthM * required).toFixed(2);

  return {
    verdict: safe ? "pass" : "fail",
    conclusion: safe
      ? `적합 (${input.soilType} 기준 1:${required} 이상 확보)`
      : `부적합 — 1m당 수평 ${required}m 이상이 필요합니다 (현재 ${actual}m).`,
    breakdown: {
      "토질": input.soilType,
      "기준 기울기 (수직:수평)": std.ratio,
      "굴착 깊이": `${input.depthM} m`,
      "필요 수평거리(총)": `${recommended} m`,
      "실제 수평거리(1m 수직 기준)": `${actual} m`,
    },
    legalBasis: "산업안전보건기준에 관한 규칙 제339조 별표 11, KOSHA GUIDE C-39",
    recommendations: safe ? [] : [
      "사면 기울기를 표준 이상으로 완화",
      "흙막이 지보공 설치 검토 (제340조)",
      "지표수 유입 차단·계측 관리",
    ],
  };
}

/* ============================================================
 * 2) 비계 적재하중 — KOSHA GUIDE C-30
 * 강관비계: 작업발판 1㎡당 250kgf 이하, 비계 전체에 작업원·자재 합산
 * ============================================================ */
export interface ScaffoldLoadInput {
  /** 작업발판 면적 (㎡) */
  areaSqm: number;
  /** 동시 작업원 수 */
  workerCount: number;
  /** 자재 적재 무게 (kgf) */
  materialKg: number;
  /** 작업원 1인당 평균 체중 + 공구 (kgf), 기본 80 */
  workerWeightKg?: number;
}

export function calcScaffoldLoad(input: ScaffoldLoadInput): CalcResult {
  const LIMIT_PER_SQM = 250; // kgf/㎡
  const w = input.workerWeightKg ?? 80;
  const totalLoad = input.workerCount * w + input.materialKg;
  const loadPerSqm = input.areaSqm > 0 ? totalLoad / input.areaSqm : 0;
  const safe = loadPerSqm <= LIMIT_PER_SQM;
  const utilization = ((loadPerSqm / LIMIT_PER_SQM) * 100).toFixed(1);

  return {
    verdict: safe ? (loadPerSqm > LIMIT_PER_SQM * 0.8 ? "warn" : "pass") : "fail",
    conclusion: safe
      ? `적합 (${loadPerSqm.toFixed(0)} kgf/㎡, 허용 250 kgf/㎡의 ${utilization}%)`
      : `부적합 — ${loadPerSqm.toFixed(0)} kgf/㎡, 허용치 초과 (${utilization}%)`,
    breakdown: {
      "작업원": `${input.workerCount}명 × ${w}kgf = ${input.workerCount * w} kgf`,
      "자재": `${input.materialKg} kgf`,
      "총 하중": `${totalLoad} kgf`,
      "발판 면적": `${input.areaSqm} ㎡`,
      "단위 하중": `${loadPerSqm.toFixed(1)} kgf/㎡`,
      "허용 기준": "250 kgf/㎡",
      "활용률": `${utilization} %`,
    },
    legalBasis: "산업안전보건기준에 관한 규칙 제55조·제56조, KOSHA GUIDE C-30",
    recommendations: safe ? [] : [
      "동시 작업원 수 축소 또는 작업발판 면적 확대",
      "자재는 분산 적치하고 즉시 사용분만 양중",
      "강관비계 → 시스템비계 전환 검토",
    ],
  };
}

/* ============================================================
 * 3) 크레인 양중 안전율 — KOSHA GUIDE C-46 / 산안기준규칙 제146조
 * 작업하중 ≤ 정격하중 × 작업반경 보정 × 0.85 (안전여유)
 * ============================================================ */
export interface CraneLoadInput {
  /** 크레인 정격하중 @ 해당 반경 (ton) */
  ratedCapacityTon: number;
  /** 인양물 무게 (ton) */
  loadTon: number;
  /** 슬링/샤클/스프레더바 무게 (ton) */
  riggingTon: number;
  /** 작업반경 (m) */
  radiusM: number;
  /** 풍속 (m/s) — 10m/s 이상 작업 중지 */
  windMs: number;
}

export function calcCraneLoad(input: CraneLoadInput): CalcResult {
  const SAFETY = 0.85;
  const totalLoad = input.loadTon + input.riggingTon;
  const maxAllowed = input.ratedCapacityTon * SAFETY;
  const utilization = input.ratedCapacityTon > 0
    ? ((totalLoad / input.ratedCapacityTon) * 100).toFixed(1)
    : "0";
  const overWind = input.windMs >= 10;
  const overLoad = totalLoad > maxAllowed;
  const verdict: CalcVerdict = overWind || overLoad ? "fail"
    : totalLoad > input.ratedCapacityTon * 0.75 ? "warn"
    : "pass";

  return {
    verdict,
    conclusion: overWind
      ? `작업 중지 — 풍속 ${input.windMs}m/s ≥ 10m/s`
      : overLoad
      ? `부적합 — 총 하중 ${totalLoad.toFixed(2)}t > 허용 ${maxAllowed.toFixed(2)}t`
      : `적합 (활용률 ${utilization}%, 풍속 ${input.windMs}m/s)`,
    breakdown: {
      "정격하중 @ 반경": `${input.ratedCapacityTon} t @ ${input.radiusM} m`,
      "인양물": `${input.loadTon} t`,
      "리깅 무게": `${input.riggingTon} t`,
      "총 하중": `${totalLoad.toFixed(2)} t`,
      "허용 하중(85% 적용)": `${maxAllowed.toFixed(2)} t`,
      "활용률": `${utilization} %`,
      "풍속": `${input.windMs} m/s ${overWind ? "(작업중지)" : ""}`,
    },
    legalBasis: "산업안전보건기준에 관한 규칙 제132조·제146조·제37조(악천후), KOSHA GUIDE C-46",
    recommendations: verdict === "pass" ? [] : [
      overWind ? "10m/s 이상 풍속 시 즉시 작업 중지" : "더 큰 정격하중의 크레인으로 교체",
      "작업반경 축소 (반경이 클수록 정격하중 감소)",
      "양중계획도와 신호수 배치 재확인",
    ],
  };
}

/* ============================================================
 * 4) 고소작업 — 추락방호조치 체크리스트 + 안전대 부착설비 강도
 * 산안기준규칙 제42조: 추락 위험 시 안전대 부착설비 5,000N(약 510kgf) 이상 강도
 * ============================================================ */
export interface FallProtectionInput {
  heightM: number;
  hasRailing: boolean;
  hasNet: boolean;
  hasLifeline: boolean;
  anchorageStrengthKgf: number; // 안전대 부착설비 강도 (kgf)
}

export function calcFallProtection(input: FallProtectionInput): CalcResult {
  const MIN_ANCHORAGE_KGF = 510; // 5,000 N
  const requireMeasures = input.heightM >= 2;
  const hasPrimary = input.hasRailing || input.hasNet;
  const lifelineOk = input.hasLifeline && input.anchorageStrengthKgf >= MIN_ANCHORAGE_KGF;
  const safe = !requireMeasures || (hasPrimary && lifelineOk);

  const missing: string[] = [];
  if (requireMeasures && !hasPrimary) missing.push("안전난간 또는 추락방호망 미설치");
  if (requireMeasures && !input.hasLifeline) missing.push("안전대 부착설비(생명줄) 미설치");
  if (requireMeasures && input.hasLifeline && input.anchorageStrengthKgf < MIN_ANCHORAGE_KGF) {
    missing.push(`부착설비 강도 부족 (${input.anchorageStrengthKgf} kgf < 510 kgf)`);
  }

  return {
    verdict: safe ? "pass" : "fail",
    conclusion: safe
      ? requireMeasures
        ? "적합 (안전난간/방호망 + 안전대 모두 충족)"
        : "낮음 (2m 미만, 별도 의무 없음)"
      : `부적합 — ${missing.join(", ")}`,
    breakdown: {
      "작업 높이": `${input.heightM} m`,
      "법정 의무 발생": requireMeasures ? "예 (2m 이상)" : "아니오",
      "안전난간": input.hasRailing ? "설치" : "미설치",
      "추락방호망": input.hasNet ? "설치" : "미설치",
      "안전대 부착설비": input.hasLifeline ? "설치" : "미설치",
      "부착설비 강도": `${input.anchorageStrengthKgf} kgf (기준 510 kgf)`,
    },
    legalBasis: "산업안전보건기준에 관한 규칙 제42조·제43조·제44조",
    recommendations: safe ? [] : missing.map((m) => `해결: ${m}`),
  };
}

/* ============================================================
 * 5) 밀폐공간 — 산소·유해가스 농도 (산안기준규칙 제619조)
 * ============================================================ */
export interface ConfinedSpaceInput {
  oxygenPct: number; // 산소농도 %
  coPpm: number; // 일산화탄소
  h2sPpm: number; // 황화수소
  lelPct: number; // 폭발하한계 %
}

export function calcConfinedSpaceAtmosphere(input: ConfinedSpaceInput): CalcResult {
  const checks = {
    "산소 (18.0 ~ 23.5%)": input.oxygenPct >= 18 && input.oxygenPct <= 23.5,
    "CO ≤ 30 ppm": input.coPpm <= 30,
    "H2S ≤ 10 ppm": input.h2sPpm <= 10,
    "폭발하한계 < 10%": input.lelPct < 10,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  const safe = failed.length === 0;

  return {
    verdict: safe ? "pass" : "fail",
    conclusion: safe ? "출입 적합 — 모든 가스 기준 충족" : `출입 금지 — ${failed.join(", ")}`,
    breakdown: {
      "산소": `${input.oxygenPct} % (18.0~23.5)`,
      "CO": `${input.coPpm} ppm (≤30)`,
      "H2S": `${input.h2sPpm} ppm (≤10)`,
      "LEL": `${input.lelPct} % (<10)`,
    },
    legalBasis: "산업안전보건기준에 관한 규칙 제619조·제620조·제624조",
    recommendations: safe ? [] : [
      "강제환기 후 재측정 (최소 5분)",
      "송기마스크/공기호흡기 착용",
      "출입 전 작업허가서 발급 + 감시인 배치",
      "비상시 구조용 장비(삼각대·구명로프) 준비",
    ],
  };
}

/* ============================================================
 * 6) 환기 풍량 — 터널/밀폐공간 (KOSHA GUIDE C-49)
 * 필요 풍량 Q (㎥/min) = N × q
 *   N: 작업인원, q: 1인당 필요 풍량 (3 ㎥/min 권장)
 * ============================================================ */
export function calcVentilation(workerCount: number, perPerson = 3, machineCfm = 0) {
  const needed = workerCount * perPerson + machineCfm;
  return {
    verdict: "pass" as const,
    conclusion: `필요 풍량 ${needed.toFixed(1)} ㎥/min 이상 (작업원 ${workerCount}명)`,
    breakdown: {
      "작업원 풍량": `${workerCount} × ${perPerson} = ${workerCount * perPerson} ㎥/min`,
      "장비 풍량": `${machineCfm} ㎥/min`,
      "필요 총 풍량": `${needed.toFixed(1)} ㎥/min`,
    },
    legalBasis: "KOSHA GUIDE C-49, 산업안전보건기준에 관한 규칙 제628조",
  };
}
