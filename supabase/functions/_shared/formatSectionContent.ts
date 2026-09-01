/**
 * Work-plan section content may be stored as JSON (structured forms)
 * or as plain Korean text. Print/preview must never dump raw JSON.
 */

export const KO_LABELS: Record<string, string> = {
  work_name: "작업명",
  work_date: "작업일시",
  work_location: "작업위치",
  work_content: "작업내용",
  supervisor: "현장감독자",
  workers_count: "투입인원",
  name: "성명",
  model: "모델명",
  capacity: "정격하중",
  manufacturer: "제조사",
  inspection_date: "검사일",
  order: "순서",
  description: "작업단계",
  safety_measure: "안전조치",
  hazard: "위험요인",
  situation: "발생상황",
  measure: "안전대책",
  severity: "위험도",
  signal_person: "신호수",
  signal_method: "신호방식",
  radio_channel: "무전 채널",
  hand_signals: "수신호",
  emergency_signal: "비상정지 신호",
  emergency_contact: "비상연락처",
  hospital: "인근병원",
  evacuation_route: "대피경로",
  assembly_point: "집결장소",
  first_aid: "응급처치",
  reporting_procedure: "보고체계",
  notes: "비고",
  workPlan: "작업계획",
  workAreaName: "작업장소",
  workPathName: "운행경로",
  soil_type: "지반 종류",
  groundwater: "지하수위 (m)",
  rock_class: "암반등급",
  gas_present: "가스 존재 여부",
  summary: "조사 결과 요약",
  type: "종류",
  depth: "설치 깊이 (m)",
  method: "방법",
  monitoring: "계측 계획",
  route: "경로",
  equipment: "장비",
  signal: "신호 방법",
  radio: "무전/채널",
  qualification: "자격·직책",
  placement: "배치 위치",
  duties: "임무",
  air_volume: "필요 풍량 (㎥/min)",
  fan_spec: "환풍기 사양",
  gas_monitoring: "가스 측정 계획",
  spec: "규격",
  height: "높이/단수",
  detail: "상세",
  oxygen: "산소 농도 기준 (%)",
  gas_types: "유해가스 종류",
  measurement_freq: "측정 빈도",
  plan: "계획",
  team: "구조팀 편성",
  procedure: "절차",
  distance: "안전 거리 (m)",
  boundary: "경계 구역",
  alarm: "경보 체계",
  asbestos: "석면 조사 결과",
  structural: "구조 안전 진단",
  utilities: "매설물 확인",
  convergence: "내공변위",
  crown: "천단침하",
  surface: "지표침하",
  frequency: "계측 빈도",
  criteria: "관리 기준값",
  path: "운행 경로",
  ground: "지반·경사 상태",
  sight: "시야·교차 구간",
  composition: "인원 구성",
  roles: "역할 범위",
  kind: "작업 구분",
  sequence: "순서 및 안전조치",
  foundation: "기초",
  wall_tie: "월타이/지지",
  tools: "작업도구·장비",
  temporary: "가설설비",
  guard: "방호설비",
  lockout: "차단(LOTO)",
  purge: "퍼지·치환",
  verify: "잔류 확인",
  voltage: "전압 (kV)",
  limit_cm: "접근한계 (cm)",
  ppe: "절연 보호구",
  party: "운행관계자",
  window: "차단·협의 시간",
  contact: "연락 수단",
  count: "작업 인원",
  volume: "작업량",
};

const SECTION_FIELD_LABELS: Record<string, Record<string, string>> = {
  commander: {
    name: "작업지휘자 성명",
    qualification: "자격·직책",
    placement: "배치 위치",
    duties: "임무",
  },
  contact: {
    method: "연락 방법",
    signal: "신호 방법",
    radio: "무전/채널",
    notes: "상세",
  },
  geology: {
    soil_type: "지반 종류",
    groundwater: "지하수위 (m)",
    rock_class: "암반등급",
    gas_present: "가스 존재 여부",
    summary: "조사 결과 요약",
  },
  shoring: {
    type: "흙막이 종류",
    depth: "설치 깊이 (m)",
    method: "설치 방법",
    monitoring: "계측 계획",
  },
  spoil: {
    method: "반출 방법",
    route: "반출 경로",
    equipment: "운반 장비",
    notes: "상세",
  },
  equipment: {
    name: "장비명",
    model: "모델명",
    capacity: "정격하중",
    manufacturer: "제조사",
    inspection_date: "검사일",
  },
};

function hasValue(val: unknown): boolean {
  if (val === null || val === undefined || val === "") return false;
  if (Array.isArray(val)) return val.some(hasValue);
  if (typeof val === "object") return Object.values(val as Record<string, unknown>).some(hasValue);
  return true;
}

function labelOf(key: string, sectionKey?: string): string {
  const scoped = sectionKey ? SECTION_FIELD_LABELS[sectionKey]?.[key] : undefined;
  return scoped || KO_LABELS[key] || key;
}

function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return t.startsWith("{") || t.startsWith("[");
}

function parseMaybeJson(content: unknown): unknown {
  if (typeof content !== "string") return content;
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (!looksLikeJson(trimmed)) return trimmed;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function flattenValue(val: unknown, sectionKey?: string): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  if (Array.isArray(val)) {
    return val
      .filter(hasValue)
      .map((item, i) => {
        if (item && typeof item === "object") {
          const parts = Object.entries(item as Record<string, unknown>)
            .filter(([, v]) => hasValue(v))
            .map(([k, v]) => `${labelOf(k, sectionKey)}: ${flattenValue(v, sectionKey)}`);
          return `${i + 1}. ${parts.join(" / ")}`;
        }
        return `${i + 1}. ${flattenValue(item, sectionKey)}`;
      })
      .join("\n");
  }
  if (typeof val === "object") {
    return Object.entries(val as Record<string, unknown>)
      .filter(([, v]) => hasValue(v))
      .map(([k, v]) => `${labelOf(k, sectionKey)}: ${flattenValue(v, sectionKey)}`)
      .join(" / ");
  }
  return "";
}

/** Plain-text rendering for non-HTML surfaces. Never returns raw JSON after a successful parse. */
export function formatSectionContent(
  content: string | null | undefined,
  sectionKey?: string,
): string {
  if (!content) return "";
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (!looksLikeJson(trimmed)) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    const rendered = flattenValue(parsed, sectionKey);
    if (rendered) return rendered;
    if (parsed && typeof parsed === "object") return "기재 없음";
    return trimmed;
  } catch {
    return trimmed;
  }
}

export function formatSectionPrintHtml(
  content: unknown,
  escapeHtml: (s: string) => string,
  sectionKey?: string,
): string {
  const data = parseMaybeJson(content);
  if (data === "" || data == null) return "";

  if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
    const text = String(data).trim();
    if (!text) return "";
    return `<div class="text-block">${escapeHtml(text).replace(/\n/g, "<br/>")}</div>`;
  }

  if (Array.isArray(data)) {
    const filled = data.filter(hasValue);
    if (filled.length === 0) return `<div class="text-block">기재 없음</div>`;
    const allObjects = filled.every((item) => item && typeof item === "object" && !Array.isArray(item));
    if (allObjects) {
      const keys: string[] = [];
      const seen = new Set<string>();
      for (const item of filled) {
        for (const k of Object.keys(item as Record<string, unknown>)) {
          if (seen.has(k)) continue;
          seen.add(k);
          keys.push(k);
        }
      }
      const head = keys.map((k) => `<th>${escapeHtml(labelOf(k, sectionKey))}</th>`).join("");
      const body = filled
        .map((item) => {
          const cells = keys
            .map((k) => `<td>${escapeHtml(flattenValue((item as Record<string, unknown>)[k], sectionKey))}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    return `<div class="text-block">${escapeHtml(flattenValue(filled, sectionKey)).replace(/\n/g, "<br/>")}</div>`;
  }

  if (typeof data === "object") {
    const rows = Object.entries(data as Record<string, unknown>)
      .filter(([, v]) => hasValue(v))
      .map(
        ([k, v]) =>
          `<tr><td class="label">${escapeHtml(labelOf(k, sectionKey))}</td><td>${escapeHtml(flattenValue(v, sectionKey)).replace(/\n/g, "<br/>")}</td></tr>`,
      );
    if (rows.length === 0) return `<div class="text-block">기재 없음</div>`;
    return `<table class="info-table"><tbody>${rows.join("")}</tbody></table>`;
  }

  return "";
}
