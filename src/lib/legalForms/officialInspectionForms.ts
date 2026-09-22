/**
 * 현장 오프라인 공식 점검표 4종 (MD-SF006, LST-SF007/008/009).
 * 생성 시 safety_inspection_items 로 스냅샷한다.
 */

export const OFFICIAL_INSPECTION_TYPES = [
  'daily_sf006',
  'equipment_sf007',
  'height_sf008',
  'facility_sf009',
] as const;

export type OfficialInspectionType = (typeof OFFICIAL_INSPECTION_TYPES)[number];

export const OFFICIAL_PROCESS_CATEGORY = '공식양식';

export const OFFICIAL_TYPE_LABELS: Record<OfficialInspectionType, string> = {
  daily_sf006: '일일 안전점검표',
  equipment_sf007: '건설장비작업 안전점검표',
  height_sf008: '고소작업 안전점검표',
  facility_sf009: '시설물 안전점검표',
};

export const OFFICIAL_DOC_META: Record<OfficialInspectionType, { docNo: string; rev: string; title: string }> = {
  daily_sf006: { docNo: 'MD-000000-SF006', rev: 'B', title: '일일 안전점검표' },
  equipment_sf007: { docNo: 'LST-000000-SF007', rev: 'A', title: '건설장비작업 안전점검표' },
  height_sf008: { docNo: 'LST-000000-SF008', rev: 'A', title: '고소작업 안전점검표' },
  facility_sf009: { docNo: 'LST-000000-SF009', rev: 'A', title: '시설물 안전점검표' },
};

export type OfficialGrade = 'good' | 'fair' | 'poor' | 'na';

export type OfficialFormItem = {
  code: string;
  section: string;
  number: number;
  label: string;
  hints?: string[];
  legal_basis: string;
};

export type OfficialFormPayload = {
  work_name?: string;
  inspected_date?: string;
  inspector_name?: string;
  dig_signers?: string[];
  contractor_signers?: string[];
  action_notes?: string;
  equipment_types?: string[];
  equipment_other?: string;
  findings?: string;
  measures?: string;
  excellence?: Array<{ company: string; name: string; note: string }>;
};

export const EQUIPMENT_TYPE_OPTIONS = ['굴삭기', '고소작업대', '크레인', '기타'] as const;

export type OfficialApprovalStepSeed = { label: string; position: string };
export type OfficialApprovalStepTemplate = {
  step_label: string;
  position: string;
  openPool?: boolean;
  badgeLabel?: string;
};

/** 기본 최종단계는 승인. 작성자가 합의로 바꿀 수 있다. 결재자 후보는 직책 제한 없음(openPool). */
export const OFFICIAL_APPROVAL_SEED_STEPS: readonly OfficialApprovalStepSeed[] = [
  { label: '작성자', position: 'contractor_supervisor' },
  { label: '최종결재(승인)', position: 'contractor_site_director' },
];

export const OFFICIAL_APPROVAL_STEP_TEMPLATES: readonly OfficialApprovalStepTemplate[] = [
  { step_label: '작성자', position: 'contractor_supervisor' },
  { step_label: '최종결재(승인)', position: 'contractor_site_director', openPool: true, badgeLabel: '승인' },
  { step_label: '최종결재(합의)', position: 'consent', openPool: true, badgeLabel: '합의' },
];

export function officialTemplateCodes(type: OfficialInspectionType): Set<string> {
  return new Set(OFFICIAL_FORM_ITEMS[type].map((i) => i.code));
}

export function extraOfficialRows<T extends { code?: string; checklist_code?: string }>(
  type: OfficialInspectionType,
  rows: T[],
): T[] {
  const codes = officialTemplateCodes(type);
  return rows.filter((r) => !codes.has(String(r.checklist_code || r.code || '')));
}

export function isOfficialInspection(type?: string | null): boolean {
  return (OFFICIAL_INSPECTION_TYPES as readonly string[]).includes(String(type || ''));
}

export function isApprovalInspection(type?: string | null): boolean {
  return String(type || '') === 'patrol' || isOfficialInspection(type);
}

export function officialGradeScale(type?: string | null): 'two' | 'four' {
  return type === 'daily_sf006' ? 'two' : 'four';
}

export function gradeToResult(grade: OfficialGrade): 'pass' | 'fail' | 'na' {
  if (grade === 'poor') return 'fail';
  if (grade === 'na') return 'na';
  return 'pass';
}

export function resultToGrade(result?: string | null, stored?: string | null): OfficialGrade | null {
  if (stored === 'good' || stored === 'fair' || stored === 'poor' || stored === 'na') return stored;
  if (result === 'fail') return 'poor';
  if (result === 'na') return 'na';
  if (result === 'pass') return 'good';
  return null;
}

export function gradeLabel(grade: OfficialGrade | null): string {
  if (grade === 'good') return '양호';
  if (grade === 'fair') return '미흡';
  if (grade === 'poor') return '불량';
  if (grade === 'na') return 'N/A';
  return '';
}

export function emptyOfficialPayload(): OfficialFormPayload {
  return {
    work_name: '',
    inspected_date: new Date().toISOString().slice(0, 10),
    inspector_name: '',
    dig_signers: ['', '', ''],
    contractor_signers: ['', '', ''],
    action_notes: '',
    equipment_types: [],
    equipment_other: '',
    findings: '',
    measures: '',
    excellence: [{ company: '', name: '', note: '' }],
  };
}

export function normalizeOfficialPayload(raw: unknown): OfficialFormPayload {
  const base = emptyOfficialPayload();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as OfficialFormPayload;
  return {
    ...base,
    ...o,
    dig_signers: pad3(o.dig_signers),
    contractor_signers: pad3(o.contractor_signers),
    equipment_types: Array.isArray(o.equipment_types) ? o.equipment_types : [],
    excellence: Array.isArray(o.excellence) && o.excellence.length
      ? o.excellence
      : [{ company: '', name: '', note: '' }],
  };
}

function pad3(v?: string[]): string[] {
  const a = Array.isArray(v) ? v.slice(0, 3) : [];
  while (a.length < 3) a.push('');
  return a;
}

function item(
  code: string,
  section: string,
  number: number,
  label: string,
  docNo: string,
  hints?: string[],
): OfficialFormItem {
  return { code, section, number, label, hints, legal_basis: docNo };
}

const SF006 = 'MD-000000-SF006';
const SF007 = 'LST-000000-SF007';
const SF008 = 'LST-000000-SF008';
const SF009 = 'LST-000000-SF009';

export const OFFICIAL_FORM_ITEMS: Record<OfficialInspectionType, OfficialFormItem[]> = {
  daily_sf006: [
    item('DLY-01', '현장 정리 정돈', 1, '작업장 및 주변 정리정돈 상태', SF006),
    item('DLY-02', '현장 정리 정돈', 2, '작업용 공도구 정리정돈 상태', SF006),
    item('DLY-03', '현장 정리 정돈', 3, 'Shop장 및 창고 정리정돈 상태', SF006),
    item('DLY-04', '건설 장비', 1, '작업절차서는 문제가 없는가?', SF006),
    item('DLY-05', '건설 장비', 2, '작업 전 장비점검 실시 여부', SF006),
    item('DLY-06', '건설 장비', 3, '장비작업구간 신호수 배치 여부', SF006),
    item('DLY-07', '개인 보호구', 1, '근로자 개인보호구 착용 상태', SF006),
    item('DLY-08', '개인 보호구', 2, '작업 별 개인보호구 착용 상태', SF006),
    item('DLY-09', '개인 보호구', 3, '불량 및 파손된 개인보호구 유무', SF006),
    item('DLY-10', '근로자', 1, '작업자 작업내용 숙지 상태', SF006),
    item('DLY-11', '근로자', 2, '작업자 건강상태 이상 유무', SF006),
    item('DLY-12', '근로자', 3, '불안전한 행동을 하는가?', SF006),
    item('DLY-13', '작업용 공도구', 1, '작업 전 공도구점검 실시 여부', SF006),
    item('DLY-14', '작업용 공도구', 2, '공도구 및 보호커버 상태', SF006),
    item('DLY-15', '작업용 공도구', 3, '전선 피복 및 플러그 상태', SF006),
    item('DLY-16', '기계 장비류', 1, '기계·장비 작동 및 정비 상태', SF006),
    item('DLY-17', '기계 장비류', 2, '안전장치 제거 여부', SF006),
    item('DLY-18', '기계 장비류', 3, '가설분전함 누전차단기 설치·접지 여부', SF006),
    item('DLY-19', '시설', 1, '작업장 내 추락위험구간 유무', SF006),
    item('DLY-20', '시설', 2, '출입금지구역(기존설비 외) 확인', SF006),
    item('DLY-21', '시설', 3, '근로자 이동통로 확보 상태', SF006),
    item('DLY-22', '시설', 4, '낙하물 위험구간 방호조치 상태', SF006),
    item('DLY-23', '시설', 5, '소방시설(소화기 외) 확인', SF006),
    item('DLY-24', '차량 운행', 1, '현장 내 규정속도 준수 여부', SF006),
    item('DLY-25', '차량 운행', 2, '차량 및 근로자 동선 구분 상태', SF006),
    item('DLY-26', '기타', 1, '현장 내 안전저해요소 유무', SF006),
    item('DLY-27', '기타', 2, '위험성평가 대책 이행 여부', SF006),
    item('DLY-28', '기타', 3, '현장소장, 안전관리자상주 여부', SF006),
  ],
  equipment_sf007: [
    item('EQ-01', '공통사항', 1, '작업 전 서류 확인', SF007, ['등록증, 검사증, 보험증, 면허증, 작업계획서 외']),
    item('EQ-02', '공통사항', 2, '작업장소의 수평·지반·기상(풍속) 상태 및 작업여건 확인', SF007),
    item('EQ-03', '공통사항', 3, '작업반경 출입 통제 및 신호수 배치 상태', SF007),
    item('EQ-04', '공통사항', 4, '외관 및 유압장치(파손, 오일누수 외) 상태', SF007),
    item('EQ-05', '공통사항', 5, '주변 고압선 유무 확인 및 이격거리(3m 이상) 준수', SF007),
    item('EQ-06', '공통사항', 6, '작업자 보호구 착용 및 운전자 휴대폰 사용 금지', SF007),
    item('EQ-07', '굴삭기', 1, '안전장치 작동 상태', SF007, ['안전레버, 훅 해지장치, 선회잠금장치, 웨이트 고정장치 외']),
    item('EQ-08', '굴삭기', 2, '퀵커플러 및 버킷 이탈방지용 안전핀 체결 상태', SF007),
    item('EQ-09', '굴삭기', 3, '운전석 이탈 시 버킷을 지면에 내려놓고 시동 키 분리', SF007),
    item('EQ-10', '굴삭기', 4, '작업자를 버킷에 태우거나, 양중작업 등 기계의 주 용도를 벗어난 작업 여부', SF007),
    item('EQ-11', '굴삭기', 5, '전도방지용 토사다이크, 갓길붕괴방지 및 도로폭 유지 상태', SF007),
    item('EQ-12', '굴삭기', 6, '사이드미러, 후사경 설치 (후진경보장치, 후방카메라 설치 권고)', SF007),
    item('EQ-13', '고소작업대 (스카이 & 테이블리프트)', 1, '안전장치 작동 상태', SF007, ['과상승 방지장치, 붐 길이·각도센서, 전도방지장치, 경사표시장치 외']),
    item('EQ-14', '고소작업대 (스카이 & 테이블리프트)', 2, '탑승 작업자 PPE(안전대 외) 착용 및 사용 여부', SF007),
    item('EQ-15', '고소작업대 (스카이 & 테이블리프트)', 3, '작업대 상태 (안전난간 설치, 작업대 벽 및 바닥 파손 상태)', SF007),
    item('EQ-16', '고소작업대 (스카이 & 테이블리프트)', 4, '작업 시 고임목 설치 상태', SF007),
    item('EQ-17', '고소작업대 (스카이 & 테이블리프트)', 5, '바닥과 고소작업대 수평 유지', SF007),
    item('EQ-18', '고소작업대 (스카이 & 테이블리프트)', 6, '아웃트리거 설치 및 침하방지(발판, 고임목) 조치 상태', SF007),
    item('EQ-19', '고소작업대 (스카이 & 테이블리프트)', 7, '풋 스위치, 비상정지, 이동경고음 작동 상태', SF007),
    item('EQ-20', '크레인', 1, '안전장치 작동 상태', SF007, ['훅 해지장치, 과부하 방지장치, 권과방지장치, 비상정지장치 외']),
    item('EQ-21', '크레인', 2, '지브의 경사각 및 작업반경에 따른 양중가능 하중과 중량물 하중을 검토 (양중계획서 외)', SF007),
    item('EQ-22', '크레인', 3, '양중 시 2줄걸이 상태', SF007),
    item('EQ-23', '크레인', 4, '아웃트리거 설치 및 침하방지(발판, 고임목) 조치 상태', SF007),
    item('EQ-24', '크레인', 5, '와이어로프, 샤클, 슬링벨트의 상태', SF007),
  ],
  height_sf008: [
    item('HGT-01', '공통사항', 1, '개인보호구 착용 및 휴대폰 사용 금지', SF008),
    item('HGT-02', '공통사항', 2, 'DIG 고소작업수칙(안전대 상태, 사용여부 외) 준수 여부', SF008),
    item('HGT-03', '공통사항', 3, '작업장소 및 작업여건(가시설의 변형·부식 손상 외) 확인', SF008),
    item('HGT-04', '공통사항', 4, '상부작업시 낙하물주의, 출입금지 표시 등 하부통제 여부', SF008),
    item('HGT-05', '공통사항', 5, '불필요자재(볼트,너트,공구 등) 방치로 낙하물 발생 요인 여부', SF008),
    item('HGT-06', '공통사항', 6, '수평구명줄 설치상태 확인', SF008, [
      '두께 16㎜이상, PP·나일론·비닐론 로프 사용, 손상·이음새 유무확인',
      '바닥면으로부터 0.9m 이상 2m 이하 설치',
    ]),
    item('HGT-07', '사다리', 1, '2인 1조 작업 및 넘어짐 방지(아웃트리거) 상태', SF008),
    item('HGT-08', '사다리', 2, '사다리 노후화 점검 및 작업발판용 사용 금지', SF008),
    item('HGT-09', '테이블리프트', 1, '탑승 작업자 PPE(안전대 외) 착용 및 사용 여부', SF008),
    item('HGT-10', '테이블리프트', 2, '작업대 상태 (안전난간 설치, 작업대 벽 및 바닥 파손 상태)', SF008),
    item('HGT-11', '테이블리프트', 3, '안전장치 작동 상태', SF008, ['과상승 방지장치, 풋 스위치, 비상정지, 이동경고음 외']),
    item('HGT-12', '테이블리프트', 4, '작업 시 고임목 설치 상태', SF008),
    item('HGT-13', '비계, 고소, 계단, Pipe Rack 외', 1, '작업발판(폭 40cm 이상, 틈 3cm 이하) 설치 상태', SF008),
    item('HGT-14', '비계, 고소, 계단, Pipe Rack 외', 2, '작업발판 단부 안전난간 설치 상태', SF008),
    item('HGT-15', '비계, 고소, 계단, Pipe Rack 외', 3, '안전방망, 추락방호망 등 낙하물·추락 방지 조치 상태', SF008),
    item('HGT-16', '비계, 고소, 계단, Pipe Rack 외', 4, '추락방지설비(생명줄, BeamSupport 외) 고정 상태', SF008),
    item('HGT-17', '비계, 고소, 계단, Pipe Rack 외', 5, '개구부 덮개 및 경고표지 설치 여부', SF008),
    item('HGT-18', '비계, 고소, 계단, Pipe Rack 외', 6, '안전난간 설치, 고정, 강도 상태', SF008),
    item('HGT-19', '비계, 고소, 계단, Pipe Rack 외', 7, '이동식비계 안전난간 및 고정상태', SF008),
    item('HGT-20', '비계, 고소, 계단, Pipe Rack 외', 8, '3m이상 비계사다리 사용 시 안전블럭/코브라 설치 여부', SF008),
    item('HGT-21', '스카이', 1, '탑승 작업자 PPE(안전대 외) 착용 및 사용 여부', SF008),
    item('HGT-22', '스카이', 2, '작업대 상태 (안전난간 설치, 작업대 벽 및 바닥 파손 상태)', SF008),
    item('HGT-23', '스카이', 3, '안전장치 작동 상태', SF008, ['과상승 방지장치, 붐 길이·각도센서, 아웃트리거인터록, 경사표시장치 외']),
    item('HGT-24', '스카이', 4, '주변 고압선 유무 및 이격거리(3m 이상) 준수', SF008),
    item('HGT-25', '스카이', 5, '아웃트리거 설치 및 침하방지(발판, 고임목) 조치 상태', SF008),
  ],
  facility_sf009: [
    item('FAC-01', '비계', 1, '비계(시스템비계 외) 고정 등 설치상태', SF009),
    item('FAC-02', '비계', 2, '안전망 등 추락방지망 설치 상태', SF009),
    item('FAC-03', '비계', 3, '연결부 및 접속부, 클램프 조임 상태', SF009),
    item('FAC-04', '비계', 4, '재료 결함(변형, 부식, 손상 외) 점검', SF009),
    item('FAC-05', '비계', 5, '비계 기둥(간격 1.8m 이내) 침하방지 깔판 사용', SF009),
    item('FAC-06', '비계', 6, '작업발판(폭 40cm 이상, 틈 3cm 이하) 결하 및 설치 상태', SF009),
    item('FAC-07', '비계', 7, '주변 고압선 유무 및 이격거리(3m 이상) 준수', SF009),
    item('FAC-08', '비계', 8, '보행로 내 낙하물 적재 금지', SF009),
    item('FAC-09', '분전함', 1, '차단기 용량 및 적정 케이블 사용 여부', SF009),
    item('FAC-10', '분전함', 2, '부하 측 누전차단기 사용 여부', SF009),
    item('FAC-11', '분전함', 3, '접지(외함 및 1차측) 상태', SF009),
    item('FAC-12', '분전함', 4, '내부 부스 바 보호커버 설치 상태', SF009),
    item('FAC-13', '분전함', 5, '경고 및 안내(담당자, 전압 외) 스티커 부착 여부', SF009),
    item('FAC-14', '분전함', 6, '외함 고정, 파손 및 우천 대비 설치 상태', SF009),
    item('FAC-15', '분전함', 7, '시건장치 설치 상태', SF009),
    item('FAC-16', '위험물 저장소', 1, 'MSDS 서류 비치 상태', SF009),
    item('FAC-17', '위험물 저장소', 2, '저장소 및 보관품 고정 상태', SF009),
    item('FAC-18', '위험물 저장소', 3, '저장소 통풍 및 온도(40℃ 이하) 상태', SF009),
    item('FAC-19', '위험물 저장소', 4, '저장소 주변(2m 이내) 화기 및 인화성 물질 여부', SF009),
    item('FAC-20', '위험물 저장소', 5, '경고 및 안내(담당자 외)표지 상태', SF009),
    item('FAC-21', '위험물 저장소', 6, '위험물, 가스용기 등 혼재보관 금지 및 이격', SF009),
    item('FAC-22', '위험물 저장소', 7, '가스용기 보호캡 및 고정상태 확인', SF009),
    item('FAC-23', '위험물 저장소', 8, '소화기 비치 여부', SF009),
    item('FAC-24', '위험물 저장소', 9, '시건장치 설치 상태', SF009),
  ],
};

export function officialChecklist(type: OfficialInspectionType): OfficialFormItem[] {
  return OFFICIAL_FORM_ITEMS[type];
}

export function officialItemCount(type: OfficialInspectionType): number {
  return OFFICIAL_FORM_ITEMS[type].length;
}

export function groupOfficialItems(items: OfficialFormItem[]): Array<{ section: string; items: OfficialFormItem[] }> {
  const groups: Array<{ section: string; items: OfficialFormItem[] }> = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.section === it.section) last.items.push(it);
    else groups.push({ section: it.section, items: [it] });
  }
  return groups;
}

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildOfficialInspectionHtml(opts: {
  type: OfficialInspectionType;
  location: string;
  inspectorName: string;
  inspectedAt: string;
  projectLabel?: string;
  payload: OfficialFormPayload;
  rows: Array<{ code: string; label: string; grade: OfficialGrade | null; note: string }>;
}): string {
  const meta = OFFICIAL_DOC_META[opts.type];
  const defs = OFFICIAL_FORM_ITEMS[opts.type];
  const byCode = new Map(opts.rows.map((r) => [r.code, r]));
  const groups = groupOfficialItems(defs);
  const two = officialGradeScale(opts.type) === 'two';
  const grades: OfficialGrade[] = two ? ['good', 'poor'] : ['good', 'fair', 'poor', 'na'];
  const p = normalizeOfficialPayload(opts.payload);

  const body = groups.map((g) => {
    const rows = g.items.map((it) => {
      const row = byCode.get(it.code);
      const grade = row?.grade ?? null;
      const marks = grades.map((gr) => `<td class="mark">${grade === gr ? '●' : ''}</td>`).join('');
      const hint = (it.hints || []).map((h) => `<div class="hint">${esc(h)}</div>`).join('');
      return `<tr>
        <td class="num">${it.number}</td>
        <td class="lbl">${esc(it.label)}${hint}</td>
        ${marks}
        <td class="note">${esc(row?.note || '')}</td>
      </tr>`;
    }).join('');
    const headMarks = grades.map((gr) => `<th>${esc(gradeLabel(gr))}</th>`).join('');
    return `<h2>${esc(g.section)}</h2>
      <table>
        <thead><tr><th class="num">No</th><th>점검항목</th>${headMarks}<th>비고</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('');

  const equip = opts.type === 'equipment_sf007'
    ? `<p>장비종류: ${esc((p.equipment_types || []).join(', ') || '-')}${p.equipment_other ? ` (${esc(p.equipment_other)})` : ''}</p>`
    : '';

  const extras = extraOfficialRows(opts.type, opts.rows);
  const extraBody = extras.length
    ? `<h2>추가 항목</h2>
      <table>
        <thead><tr><th class="num">No</th><th>점검항목</th>${grades.map((gr) => `<th>${esc(gradeLabel(gr))}</th>`).join('')}<th>비고</th></tr></thead>
        <tbody>${extras.map((row, i) => {
          const marks = grades.map((gr) => `<td class="mark">${row.grade === gr ? '●' : ''}</td>`).join('');
          return `<tr>
            <td class="num">${i + 1}</td>
            <td class="lbl">${esc(row.label)}</td>
            ${marks}
            <td class="note">${esc(row.note || '')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`
    : '';

  const footer = opts.type === 'daily_sf006'
    ? `<h2>순회 점검</h2>
       <p>지적 사항: ${esc(p.findings || '')}</p>
       <p>조치 사항: ${esc(p.measures || '')}</p>
       <h2>근로자 안전수칙 준수 우수자</h2>
       <table><thead><tr><th>소속 업체</th><th>성함</th><th>우수 내역</th></tr></thead>
       <tbody>${(p.excellence || []).map((e) => `<tr><td>${esc(e.company)}</td><td>${esc(e.name)}</td><td>${esc(e.note)}</td></tr>`).join('')}</tbody></table>`
    : `<h2>점검 및 조치사항</h2><p>${esc(p.action_notes || '').replace(/\n/g, '<br>')}</p>
       <p>DIG 서명: ${esc((p.dig_signers || []).filter(Boolean).join(', ') || '-')}</p>
       <p>공사업체 서명: ${esc((p.contractor_signers || []).filter(Boolean).join(', ') || '-')}</p>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(meta.title)}</title>
<style>
body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;padding:16px;color:#1a202c;font-size:11pt}
h1{font-size:18pt;margin:0 0 8px}
h2{font-size:12pt;margin:16px 0 6px;border-left:4px solid #1e3a8a;padding-left:8px}
table{width:100%;border-collapse:collapse;margin-bottom:8px}
th,td{border:1px solid #94a3b8;padding:4px 6px;vertical-align:top}
th{background:#f1f5f9}
.num{width:36px;text-align:center}
.mark{width:42px;text-align:center}
.hint{font-size:9pt;color:#64748b;margin-top:2px}
.meta{font-size:10pt;color:#334155;margin-bottom:10px}
@media print{body{padding:0}}
</style></head><body>
<h1>${esc(meta.title)}</h1>
<div class="meta">
  ${esc(meta.docNo)} Rev.${esc(meta.rev)}<br>
  현장: ${esc(opts.projectLabel || '-')} · 위치/공사: ${esc(p.work_name || opts.location)}<br>
  점검일: ${esc(p.inspected_date || opts.inspectedAt)} · 점검자: ${esc(p.inspector_name || opts.inspectorName)}
</div>
${equip}
${body}
${extraBody}
${footer}
</body></html>`;
}
