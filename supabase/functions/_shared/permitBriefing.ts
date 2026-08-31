/**
 * Permit AI briefing — facts, lead sentence, payload, local fallback.
 * Shared by the edge function and (via src/lib/permitBriefing.ts) the web client.
 * Do not invent hazards: only surface what the permit actually recorded.
 */

export const PERMIT_KIND_SHORT: Record<string, string> = {
  general: '일반',
  confined_space: '밀폐공간',
  hot_work: '화기',
  excavation: '굴착·중장비',
};

export const PERMIT_BRIEFING_SYSTEM_PROMPT = `당신은 작업허가서 결재 브리핑 작성자다.
입력 JSON에 적힌 사실만 요약한다.

규칙:
1) 반드시 JSON만 출력한다.
2) 입력에 없는 위험·조치를 만들지 않는다. 일반 건설 위험(추락, 감전, 협착 등)을 공종만 보고 추가하지 않는다.
3) top_risks는 입력 hazards의 항목만. 없으면 빈 배열.
4) required_controls는 입력 checklist·attachments·hazard measures만. 없으면 빈 배열.
5) work_overview는 작업 내용 1~2문장. 업체명·날짜·"작업 사항으로"는 쓰지 않는다(시스템이 앞에 붙인다).
6) 한국어 단정형. 번역투 금지.
7) 굴착과 중장비는 서로 다른 위험이다. 양식명·permit_kinds의 "굴착·중장비"만 보고 굴착을 넣지 않는다. hazards에 "굴착"이 있을 때만 굴착·붕괴·매설물을 쓴다.
8) 투입장비는 일반 허가서 중장비 칸에 적힌 장비명이다. "굴착기"가 있어도 그건 장비이지 굴착 작업이 아니다. 중장비는 투입장비·작업반경·협착으로 요약한다.`;

const CHECKLIST_LABELS: Record<string, string> = {
  chk_education: '안전교육 이수',
  chk_ppe: '보호구 착용 및 건강 상태 확인',
  chk_msds: 'MSDS 비치',
  chk_no_entry: '작업구역 외 출입금지',
  chk_smoking: '흡연장소 지정 및 정리정돈',
  chk_refusal_edu: '근로자 작업거부권 교육',
  chk_signage: '명판 설치 및 표지 부착',
  chk_zone: '작업구역 설정(차량 출입 제한)',
  chk_pressure: '용기 개방 전 압력 방출',
  chk_etc: '기타 안전조치',
};

const ATTACHMENT_LABELS: Record<string, string> = {
  att_risk_assessment: '위험성평가',
  att_safety_check: '안전작업점검표',
  att_tbm_log: 'TBM 일지',
  att_heavy_eq: '중장비 서류',
  att_work_plan: '작업계획서',
};

const HAZARD_DEFS: Array<{
  key: string;
  kind?: string;
  label: string;
  noteKey: string;
  detailKey: string;
}> = [
  { key: 'hz_confined', kind: 'confined_space', label: '밀폐공간', noteKey: 'hz_confined_note', detailKey: 'hz_confined_detail' },
  { key: 'hz_hot', kind: 'hot_work', label: '화기', noteKey: 'hz_hot_note', detailKey: 'hz_hot_detail' },
  { key: 'hz_loto', label: '정전(LOTO)', noteKey: 'hz_loto_note', detailKey: 'hz_loto_detail' },
  { key: 'hz_radiation', label: '방사선', noteKey: 'hz_radiation_note', detailKey: 'hz_radiation_detail' },
  { key: 'hz_height', label: '고소', noteKey: 'hz_height_note', detailKey: 'hz_height_detail' },
];

/** 굴착 작업임을 뒷받침하는 안전조치만. */
const EX_DIG_EVIDENCE = [
  '굴착 전 지하매설물 도면 확인',
  '지중탐사(GPR/탐침봉) 실시',
  '굴착 기울기 준수(흙 1:1.0 등)',
  '흙막이 / 지보공 설치',
  '주변 침하·균열 점검',
  '굴착토 적치(굴착면 0.6m 이상 이격)',
];

/** 굴착·중장비 양식 공통. 크레인·지게차에도 찍히므로 굴착 증거가 아니다. */
const EX_SITE_SAFETY = [
  '안전난간·덮개·표지 설치',
  '비상연락망 게시',
  '우천/강풍 시 작업중지 기준',
];

/** 굴착 시트 안전조치 중 굴착 쪽. 중장비 항목과 섞이지 않게 분리한다. */
const EX_DIG_SAFETY = [...EX_DIG_EVIDENCE, ...EX_SITE_SAFETY];

const EX_HEAVY_SAFETY = [
  '유도자/신호수 배치',
  '작업반경 출입통제(휀스)',
  '중장비 안전점검표 확인',
  '중장비 면허·자격 확인',
  '운전자 특별안전교육 실시',
];

const BUNDLED_KIND_LABELS = new Set(['굴착·중장비', '굴착', '중장비']);

export type PermitBriefingHazard = {
  label: string;
  note: string;
  measures: string[];
};

export type PermitBriefingExcavation = {
  depth?: string;
  width?: string;
  method?: string;
  underground?: string;
};

export type PermitBriefingFacts = {
  company: string;
  workDate: string;
  workName: string;
  workDescription: string;
  workLocation: string;
  workStart: string;
  workEnd: string;
  personnelCount: string;
  equipment: string;
  kindLabels: string[];
  hazards: PermitBriefingHazard[];
  checklist: string[];
  attachments: string[];
  gas: { o2?: string; h2s?: string; co?: string; hc?: string };
  excavation?: PermitBriefingExcavation;
};

function str(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function datePart(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed) || trimmed.includes('Z');
  if (hasTz) {
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

export function formatPermitBriefingDateKo(ymd?: string | null): string {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`;
}

function checkedDetailItems(detail: unknown): string[] {
  if (!detail || typeof detail !== 'object') return [];
  return Object.entries(detail as Record<string, unknown>)
    .filter(([, v]) => v === true || v === 'true' || v === 1)
    .map(([k]) => k)
    .filter(Boolean);
}

function checkedExSafety(detail: unknown, allowed: string[]): string[] {
  const checked = new Set(checkedDetailItems(detail));
  return allowed.filter((item) => checked.has(item));
}

function excavationSpec(d: Record<string, unknown>): PermitBriefingExcavation | undefined {
  const spec: PermitBriefingExcavation = {
    depth: str(d.ex_depth) || undefined,
    width: str(d.ex_width) || undefined,
    method: str(d.ex_method) || undefined,
    underground: str(d.ex_underground) || undefined,
  };
  return Object.values(spec).some(Boolean) ? spec : undefined;
}

function excavationNote(d: Record<string, unknown>, spec?: PermitBriefingExcavation): string {
  const parts: string[] = [];
  if (spec?.depth || spec?.width || spec?.method) {
    parts.push(`제원 깊이 ${spec?.depth || '-'}m · 폭 ${spec?.width || '-'}m · 공법 ${spec?.method || '-'}`);
  }
  if (spec?.underground) parts.push(`지하매설물 ${spec.underground}`);
  const hzNote = str(d.hz_excavation_note);
  if (hzNote) parts.push(hzNote);
  return parts.join('. ');
}

function briefingKindLabels(
  kinds: string[],
  incoming: string[] | null | undefined,
  hasDig: boolean,
  hasHeavy: boolean,
): string[] {
  const source = (incoming && incoming.length > 0)
    ? incoming.map(String)
    : kinds.filter((k) => k !== 'excavation').map((k) => PERMIT_KIND_SHORT[k] || k);
  const out: string[] = [];
  for (const label of source) {
    if (!label || BUNDLED_KIND_LABELS.has(label)) continue;
    out.push(label);
  }
  if (hasDig) out.push('굴착');
  if (hasHeavy) out.push('중장비');
  const unique = Array.from(new Set(out));
  if (unique.length > 0) return unique;
  if (kinds.length === 0) return ['일반'];
  return [];
}

export function extractPermitBriefingFacts(input: {
  formData?: Record<string, unknown> | null;
  permitKinds?: string[] | null;
  kindLabels?: string[] | null;
  workName?: string | null;
  workDescription?: string | null;
  workLocation?: string | null;
  permitDate?: string | null;
  contractorCompany?: string | null;
  workStartAt?: string | null;
  workEndAt?: string | null;
}): PermitBriefingFacts {
  const d = input.formData || {};
  const kinds = (input.permitKinds || []).map((k) => String(k || '').trim()).filter(Boolean);
  const company = str(
    input.contractorCompany
    || d.contractor_company
    || d.applicant_company,
  );
  const workStart = str(d.work_start) || str(input.workStartAt);
  const workEnd = str(d.work_end) || str(input.workEndAt);
  const workDate =
    datePart(workStart)
    || datePart(input.permitDate)
    || datePart(str(d.permit_date));

  const spec = excavationSpec(d);
  const digEvidence = [
    ...checkedDetailItems(d.hz_excavation_detail).filter((item) =>
      !EX_SITE_SAFETY.includes(item),
    ),
    ...checkedExSafety(d.ex_safety, EX_DIG_EVIDENCE),
  ];
  const siteMeasures = checkedExSafety(d.ex_safety, EX_SITE_SAFETY);
  const digNote = excavationNote(d, spec);
  const hasDig = !!d.hz_excavation || !!spec || !!str(d.hz_excavation_note) || digEvidence.length > 0;
  const digMeasures = hasDig
    ? [...digEvidence, ...siteMeasures]
    : [];

  const equipment = str(d.hz_heavy_equipment_name);
  const heavyMeasures = [
    ...checkedDetailItems(d.hz_heavy_detail),
    ...checkedExSafety(d.ex_safety, EX_HEAVY_SAFETY),
    ...(!hasDig ? siteMeasures : []),
  ];
  const heavyUserNote = str(d.hz_heavy_note);
  const heavyNote = [equipment && `투입장비 ${equipment}`, heavyUserNote].filter(Boolean).join('. ');
  const hasHeavy = !!d.hz_heavy
    || !!heavyUserNote
    || heavyMeasures.length > 0
    || d.att_heavy_eq === true
    || (kinds.includes('excavation') && !!equipment);

  const hazards: PermitBriefingHazard[] = [];
  for (const def of HAZARD_DEFS) {
    const flagged = !!d[def.key] || (def.kind ? kinds.includes(def.kind) : false);
    const note = str(d[def.noteKey]);
    const measures = checkedDetailItems(d[def.detailKey]);
    if (!flagged && !note && measures.length === 0) continue;
    hazards.push({ label: def.label, note, measures });
  }
  if (hasDig) hazards.push({ label: '굴착', note: digNote, measures: digMeasures });
  if (hasHeavy) hazards.push({ label: '중장비', note: heavyNote, measures: heavyMeasures });

  const checklist: string[] = [];
  for (const [key, label] of Object.entries(CHECKLIST_LABELS)) {
    if (d[key] === true) checklist.push(key === 'chk_etc' && str(d.chk_etc_note) ? `${label}: ${str(d.chk_etc_note)}` : label);
  }
  const attachments: string[] = [];
  for (const [key, label] of Object.entries(ATTACHMENT_LABELS)) {
    if (d[key] === true) attachments.push(label);
  }
  const attOther = str(d.att_other);
  if (attOther) attachments.push(`기타: ${attOther}`);

  const gas = {
    o2: str(d.gas_o2) || undefined,
    h2s: str(d.gas_h2s) || undefined,
    co: str(d.gas_co) || undefined,
    hc: str(d.gas_hc) || undefined,
  };

  return {
    company,
    workDate,
    workName: str(input.workName) || str(d.work_name),
    workDescription: str(input.workDescription) || str(d.work_description),
    workLocation: str(input.workLocation) || str(d.work_location) || str(d.location),
    workStart,
    workEnd,
    personnelCount: str(d.personnel_count),
    equipment,
    kindLabels: briefingKindLabels(kinds, input.kindLabels, hasDig, hasHeavy),
    hazards,
    checklist,
    attachments,
    gas,
    excavation: hasDig ? spec : undefined,
  };
}

function objectParticle(word: string): string {
  const last = word.slice(-1);
  if (!last) return '을';
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return '을';
  return (code - 0xac00) % 28 === 0 ? '를' : '을';
}

export function buildPermitBriefingLead(facts: PermitBriefingFacts): string {
  const dateKo = formatPermitBriefingDateKo(facts.workDate);
  const taskRaw = (facts.workName || facts.workDescription).replace(/\s+/g, ' ').trim();
  const task = taskRaw.length > 80 ? `${taskRaw.slice(0, 80)}…` : taskRaw;
  const whoWhen = [facts.company, dateKo].filter(Boolean).join(' ');
  const taskPart = task ? `${task}${objectParticle(task)} 시행함.` : '허가된 작업을 시행함.';
  if (!whoWhen) return `작업 사항으로 ${taskPart}`;
  return `${whoWhen} 작업 사항으로 ${taskPart}`;
}

export function applyPermitBriefingLead(overview: string, lead: string): string {
  const l = (lead || '').trim();
  let o = (overview || '').trim();
  if (!l) return o;
  if (!o) return l;
  if (o.startsWith(l)) return o;
  const marker = o.indexOf('작업 사항으로');
  if (marker >= 0 && marker < 48) {
    const fromMarker = o.slice(marker);
    const end = fromMarker.match(/함\.|다\./);
    if (end && end.index != null) {
      o = fromMarker.slice(end.index + end[0].length).trim();
    } else {
      o = '';
    }
    if (!o) return l;
  }
  return `${l} ${o}`;
}

export function buildPermitBriefingLlmPayload(facts: PermitBriefingFacts) {
  const gas = Object.fromEntries(
    Object.entries(facts.gas).filter(([, v]) => !!v),
  );
  return {
    company: facts.company || undefined,
    work_date: facts.workDate || undefined,
    work_name: facts.workName || undefined,
    work_description: facts.workDescription || undefined,
    work_location: facts.workLocation || undefined,
    work_start: facts.workStart || undefined,
    work_end: facts.workEnd || undefined,
    personnel_count: facts.personnelCount || undefined,
    투입장비: facts.equipment || undefined,
    permit_kinds: facts.kindLabels,
    has_excavation_work: facts.hazards.some((h) => h.label === '굴착'),
    has_heavy_equipment: facts.hazards.some((h) => h.label === '중장비'),
    hazards: facts.hazards,
    checklist: facts.checklist,
    attachments: facts.attachments,
    gas: Object.keys(gas).length > 0 ? gas : undefined,
    excavation: facts.hazards.some((h) => h.label === '굴착') ? facts.excavation : undefined,
  };
}

export type PermitAiBriefing = {
  work_overview: string;
  included_kinds: string[];
  top_risks: string[];
  required_controls: string[];
  generated_at?: string;
};

/** 굴착기(장비)는 허용. 양식명·굴착 작업·붕괴는 굴착 사실이 있을 때만. */
const EXCAVATION_WORK_RE = /굴착(?!기)|사면|흙막이|지보공|지하매설물|굴착면|매몰|굴착·중장비/;

function hasRecordedExcavation(facts: PermitBriefingFacts): boolean {
  return facts.hazards.some((h) => h.label === '굴착');
}

function isInventedExcavationText(text: string, facts: PermitBriefingFacts): boolean {
  if (hasRecordedExcavation(facts)) return false;
  return EXCAVATION_WORK_RE.test(text);
}

function fallbackRisksFromFacts(facts: PermitBriefingFacts): string[] {
  return facts.hazards.map((h) => {
    const extra = [h.note, h.measures.slice(0, 3).join(', ')].filter(Boolean).join(' — ');
    return extra ? `${h.label}: ${extra}` : `${h.label} 작업`;
  }).slice(0, 3);
}

function sanitizeOverview(overview: string, facts: PermitBriefingFacts): string {
  if (!overview || hasRecordedExcavation(facts)) return overview;
  return overview
    .split(/(?<=[.。])\s+/)
    .filter((part) => !isInventedExcavationText(part, facts))
    .join(' ')
    .trim();
}

export function normalizePermitBriefing(raw: any, facts: PermitBriefingFacts): PermitAiBriefing {
  const lead = buildPermitBriefingLead(facts);
  let top = Array.isArray(raw?.top_risks) ? raw.top_risks.map(String).filter(Boolean) : [];
  top = top.filter((r) => !isInventedExcavationText(r, facts)).slice(0, 3);
  if (top.length === 0) top = fallbackRisksFromFacts(facts);

  let controls = Array.isArray(raw?.required_controls)
    ? raw.required_controls.map(String).filter(Boolean)
    : [];
  controls = controls.filter((c) => !isInventedExcavationText(c, facts)).slice(0, 6);

  return {
    work_overview: applyPermitBriefingLead(sanitizeOverview(String(raw?.work_overview || ''), facts), lead),
    included_kinds: facts.kindLabels,
    top_risks: top,
    required_controls: controls,
    generated_at: raw?.generated_at || new Date().toISOString(),
  };
}

/** Offline / AI-failure fallback so submit is not blocked. Uses permit facts only. */
export function buildLocalPermitBriefingFromFacts(facts: PermitBriefingFacts): PermitAiBriefing {
  const lead = buildPermitBriefingLead(facts);
  const extra = [facts.workLocation && `장소 ${facts.workLocation}`, facts.equipment && `투입장비 ${facts.equipment}`]
    .filter(Boolean)
    .join('. ');
  const risks = facts.hazards.map((h) => {
    const extraH = [h.note, h.measures.slice(0, 3).join(', ')].filter(Boolean).join(' — ');
    return extraH ? `${h.label}: ${extraH}` : `${h.label} 작업`;
  }).slice(0, 3);
  const controls = [
    ...facts.checklist,
    ...facts.attachments.map((a) => `${a} 첨부 확인`),
    ...facts.hazards.flatMap((h) => h.measures),
  ].filter(Boolean).slice(0, 5);

  return {
    work_overview: extra ? `${lead} ${extra}.` : lead,
    included_kinds: facts.kindLabels,
    top_risks: risks,
    required_controls: controls,
    generated_at: new Date().toISOString(),
  };
}
