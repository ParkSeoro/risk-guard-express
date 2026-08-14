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
6) 한국어 단정형. 번역투 금지.`;

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
  { key: 'hz_excavation', kind: 'excavation', label: '굴착', noteKey: 'hz_excavation_note', detailKey: 'hz_excavation_detail' },
  { key: 'hz_radiation', label: '방사선', noteKey: 'hz_radiation_note', detailKey: 'hz_radiation_detail' },
  { key: 'hz_height', label: '고소', noteKey: 'hz_height_note', detailKey: 'hz_height_detail' },
  { key: 'hz_heavy', label: '중장비', noteKey: 'hz_heavy_note', detailKey: 'hz_heavy_detail' },
];

export type PermitBriefingHazard = {
  label: string;
  note: string;
  measures: string[];
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

function kindLabelsOf(kinds: string[]): string[] {
  const labels = kinds.map((k) => PERMIT_KIND_SHORT[k] || k).filter(Boolean);
  return labels.length > 0 ? Array.from(new Set(labels)) : ['일반'];
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

  const hazards: PermitBriefingHazard[] = [];
  for (const def of HAZARD_DEFS) {
    const flagged = !!d[def.key] || (def.kind ? kinds.includes(def.kind) : false);
    const note = str(d[def.noteKey]);
    const measures = checkedDetailItems(d[def.detailKey]);
    if (!flagged && !note && measures.length === 0) continue;
    hazards.push({ label: def.label, note, measures });
  }

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
    equipment: str(d.hz_heavy_equipment_name),
    kindLabels: (input.kindLabels && input.kindLabels.length > 0)
      ? input.kindLabels.map(String)
      : kindLabelsOf(kinds),
    hazards,
    checklist,
    attachments,
    gas,
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
    equipment: facts.equipment || undefined,
    permit_kinds: facts.kindLabels,
    hazards: facts.hazards,
    checklist: facts.checklist,
    attachments: facts.attachments,
    gas: Object.keys(gas).length > 0 ? gas : undefined,
  };
}

export type PermitAiBriefing = {
  work_overview: string;
  included_kinds: string[];
  top_risks: string[];
  required_controls: string[];
  generated_at?: string;
};

export function normalizePermitBriefing(raw: any, facts: PermitBriefingFacts): PermitAiBriefing {
  const lead = buildPermitBriefingLead(facts);
  const top = Array.isArray(raw?.top_risks) ? raw.top_risks.map(String).filter(Boolean).slice(0, 3) : [];
  const controls = Array.isArray(raw?.required_controls)
    ? raw.required_controls.map(String).filter(Boolean).slice(0, 6)
    : [];
  const included = Array.isArray(raw?.included_kinds) && raw.included_kinds.length
    ? raw.included_kinds.map(String)
    : facts.kindLabels;
  return {
    work_overview: applyPermitBriefingLead(String(raw?.work_overview || ''), lead),
    included_kinds: included,
    top_risks: top,
    required_controls: controls,
    generated_at: raw?.generated_at || new Date().toISOString(),
  };
}

/** Offline / AI-failure fallback so submit is not blocked. Uses permit facts only. */
export function buildLocalPermitBriefingFromFacts(facts: PermitBriefingFacts): PermitAiBriefing {
  const lead = buildPermitBriefingLead(facts);
  const extra = [facts.workLocation && `장소 ${facts.workLocation}`, facts.equipment && `장비 ${facts.equipment}`]
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
