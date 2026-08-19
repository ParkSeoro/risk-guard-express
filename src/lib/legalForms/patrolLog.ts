/**
 * 작업장 순회점검일지 서식 팩 (1단계).
 *
 * 법제처 Open API는 호출하지 않는다. 조문 번호·요약은 2026-08 검수 기준으로
 * 코드에 고정한다. 개정 반영은 이후 조문 캐시 단계에서 이 상수를 교체한다.
 *
 * 이 일지는 산안법 별지 서식이 아니다. 안전관리자·보건관리자 순회점검·지도·
 * 조치 건의와 도급 작업장 순회점검 증빙을 남기기 위한 SafeNex 표준 양식이다.
 */

import { jobTitleLabel } from '@/lib/jobTitleLabel';
import { roleLabelKo } from '@/lib/mobileShell';
import { resolvePermitWorkDate, todayKst } from '@/lib/permitWorkDate';

export type PatrolChecklistItem = {
  code: string;
  label: string;
  legal_basis: string;
};

export const PATROL_LOG_FORM_ID = 'osh-patrol-log';
/** 화면·목록용 짧은 제목 */
export const PATROL_LOG_TITLE = '순회 안전점검일지';
/** 엑셀 기본 양식(LGC 배관망 증설 일지) 타이틀 띄어쓰기 */
export const PATROL_LOG_PRINT_TITLE = '순 회 안 전 점 검 일 지';
export const SITE_DIRECTOR_PATROL_TITLE = '총괄책임자(현장소장) 작업장 순회점검 일지';
export const PATROL_PROCESS_CATEGORY = '현장순회';
export const PATROL_INSPECTION_CATEGORY = '순회점검';

export type LegalCitation = {
  id: string;
  law: string;
  article: string;
  title: string;
  summary: string;
};

/** 인쇄 꼬리글·법적 근거 칸에 쓰는 고정 인용. */
export const PATROL_LOG_CITATIONS: LegalCitation[] = [
  {
    id: 'osh-act-17',
    law: '산업안전보건법',
    article: '제17조',
    title: '안전관리자',
    summary: '사업주는 안전관리자를 두어 안전에 관한 기술적인 사항을 보좌·지도하게 하여야 한다.',
  },
  {
    id: 'osh-decree-18-1-5',
    law: '산업안전보건법 시행령',
    article: '제18조제1항제5호',
    title: '안전관리자의 업무',
    summary: '사업장 순회점검, 지도 및 조치 건의. (안전관리자 순회 주기는 법에 횟수로 정하지 않음)',
  },
  {
    id: 'osh-act-18',
    law: '산업안전보건법',
    article: '제18조',
    title: '보건관리자',
    summary: '보건관리자를 두어 보건에 관한 기술적인 사항을 보좌·지도하게 하여야 한다.',
  },
  {
    id: 'osh-decree-22-1-9',
    law: '산업안전보건법 시행령',
    article: '제22조제1항제9호',
    title: '보건관리자의 업무',
    summary: '사업장 순회점검, 지도 및 조치 건의.',
  },
  {
    id: 'osh-act-64-1-2',
    law: '산업안전보건법',
    article: '제64조제1항제2호',
    title: '도급 시 산업재해 예방조치',
    summary: '관계수급인 근로자가 도급인 사업장에서 작업하는 경우 작업장을 순회점검하여야 한다. 건설·제조 등 도급은 업종별 주기(2일에 1회 이상 등)가 적용된다.',
  },
  {
    id: 'osh-act-164',
    law: '산업안전보건법',
    article: '제164조',
    title: '서류의 보존',
    summary: '안전·보건조치에 관한 서류 등은 3년간 보존한다. 세부 대상은 시행규칙 제241조.',
  },
];

export const PATROL_LOG_RETENTION =
  '본 일지는 「산업안전보건법」 제164조 및 같은 법 시행규칙 제241조에 따라 안전·보건조치 관련 기록으로 3년간 보존합니다.';

export const PATROL_LOG_DISCLAIMER =
  '본 문서는 현장 순회점검 증빙 작성을 지원합니다. 산업안전보건법상 사업주의 의무 이행을 대신하거나 보장하지 않습니다.';

/** 현장 엑셀 양식 점검사항 13항목 (안전관리자 순회). */
export const PATROL_CHECKLIST_ITEMS: PatrolChecklistItem[] = [
  { code: 'PT-01', label: '근로자 개인보호구 착용상태', legal_basis: '산업안전보건기준에 관한 규칙 제32조' },
  { code: 'PT-02', label: '위험개소 안전표지 설치상태', legal_basis: '산업안전보건법 제37조' },
  { code: 'PT-03', label: '화기작업구간 소화기설치상태', legal_basis: '산업안전보건기준에 관한 규칙 제232조, 제241조' },
  { code: 'PT-04', label: '근로자 이동통행로 상태', legal_basis: '산업안전보건기준에 관한 규칙 제3조, 제17조' },
  { code: 'PT-05', label: '장비사용 시 신호수,유도원 배치상태', legal_basis: '산업안전보건기준에 관한 규칙 제146조, 제200조' },
  { code: 'PT-06', label: '가설전기사용상태', legal_basis: '산업안전보건기준에 관한 규칙 제302조, 제304조' },
  { code: 'PT-07', label: '현장 정리정돈 상태', legal_basis: '산업안전보건기준에 관한 규칙 제3조' },
  { code: 'PT-08', label: '토공작업시 법면붕괴 예방', legal_basis: '산업안전보건기준에 관한 규칙 제338조' },
  { code: 'PT-09', label: '고소작업시 난간설치상태', legal_basis: '산업안전보건기준에 관한 규칙 제42조, 제56조' },
  { code: 'PT-10', label: '콘크리트타설 시 위험요소', legal_basis: '산업안전보건기준에 관한 규칙 제331조' },
  { code: 'PT-11', label: '추락위험구간 안전시설 설치상태', legal_basis: '산업안전보건기준에 관한 규칙 제42조' },
  { code: 'PT-12', label: '현장 출입구 관리상태', legal_basis: '산업안전보건기준에 관한 규칙 제17조' },
  { code: 'PT-13', label: '가설도로 교통안전시설물 관리상태', legal_basis: '산업안전보건기준에 관한 규칙 제13조' },
];

/** 같은 엑셀 하단 — 총괄책임자(현장소장) 순회 3항목. */
export const SITE_DIRECTOR_PATROL_ITEMS: Array<{
  code: string;
  sourceCode: string;
  category: string;
  label: string;
}> = [
  { code: 'SD-01', sourceCode: 'PT-04', category: '이동통행로', label: '가설이동통로 설치상태' },
  { code: 'SD-02', sourceCode: 'PT-01', category: '개인보호구', label: '근로자 개인보호구 착용 상태' },
  { code: 'SD-03', sourceCode: 'PT-07', category: '현장정리정돈', label: '작업구간 정리정돈상태' },
];

export function isPatrolInspection(type?: string | null): boolean {
  return String(type || '') === 'patrol';
}

export function citationLine(c: LegalCitation): string {
  return `「${c.law}」 ${c.article}(${c.title})`;
}

export function formatInspectorLine(name: string, title?: string | null): string {
  const n = String(name || '').trim();
  const t = String(title || '').trim();
  if (n && t) return `${n} / ${t}`;
  return n || t;
}

export function inspectorTitleFromMember(opts: {
  position?: string | null;
  role?: string | null;
}): string {
  const fromPos = jobTitleLabel(opts.position);
  if (fromPos) return fromPos;
  const role = String(opts.role || '').trim();
  if (!role) return '';
  return roleLabelKo(role);
}

export function joinPatrolRoute(locations: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of locations) {
    const key = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.join(' · ');
}

/** 당일 순회 구간에 넣을 허가서 상태 (발행·종료대기). 초안·반려 제외. */
export const TODAY_PATROL_PERMIT_STATUSES = new Set([
  '승인',
  '승인완료',
  '발행완료',
  'approved',
  'ISSUED',
  'APPROVED',
  '종료대기',
  'CLOSURE_PENDING',
]);

export type PermitRouteRow = {
  location?: string | null;
  work_name?: string | null;
  work_description?: string | null;
  status?: string | null;
  is_deleted?: boolean | null;
  permit_date?: string | null;
  work_start_at?: string | null;
  form_data?: {
    work_location?: string | null;
    work_name?: string | null;
    work_start?: string | null;
  } | null;
  weather_snapshot?: unknown;
  contractor_company?: string | null;
  personnel_count?: number | null;
};

export function collectTodayPermitRoute(
  permits: PermitRouteRow[],
  today = todayKst(),
): string {
  const locs: string[] = [];
  for (const p of permits) {
    if (p.is_deleted) continue;
    if (!TODAY_PATROL_PERMIT_STATUSES.has(String(p.status || ''))) continue;
    if (resolvePermitWorkDate(p) !== today) continue;
    const fd = p.form_data || {};
    const loc = String(fd.work_location || p.location || '').trim();
    const name = String(fd.work_name || p.work_name || '').trim();
    locs.push(loc || name);
  }
  return joinPatrolRoute(locs);
}

/** 엑셀 「작업내용」칸: 당일 허가서 작업명 목록. */
export function collectTodayPermitWorks(
  permits: PermitRouteRow[],
  today = todayKst(),
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of permits) {
    if (p.is_deleted) continue;
    if (!TODAY_PATROL_PERMIT_STATUSES.has(String(p.status || ''))) continue;
    if (resolvePermitWorkDate(p) !== today) continue;
    const fd = p.form_data || {};
    const name = String(fd.work_name || p.work_name || p.work_description || '').replace(/\s+/g, ' ').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function weatherLabelFromSnapshots(snaps: unknown[]): string {
  for (const snap of snaps) {
    if (!snap || typeof snap !== 'object') continue;
    const o = snap as Record<string, unknown>;
    const cur = (o.current || o.now || o) as Record<string, unknown>;
    const sky = cur.sky || cur.description || cur.condition || cur.summary || o.sky || o.description;
    if (sky) return String(sky).trim();
  }
  return '';
}

export type PatrolLogItem = {
  label: string;
  checklist_code?: string;
  legal_basis?: string;
  result?: string | null;
  note?: string | null;
  photos?: string[] | null;
};

export type PatrolLogAction = {
  issue: string;
  item_id?: string | null;
  assignee_name?: string | null;
  due_date?: string | null;
  status?: string | null;
  evidence_photos?: string[] | null;
};

export type PatrolManpowerRow = {
  group: string;
  title: string;
  today: number | string;
  cumulative?: number | string;
};

export type PatrolLogFacts = {
  projectName: string;
  siteName?: string | null;
  inspectedAt: string;
  inspectorName: string;
  inspectorTitle?: string | null;
  location: string;
  summary?: string | null;
  weather?: string | null;
  workItems?: string[] | null;
  manpower?: PatrolManpowerRow[] | null;
  tbmAttendees?: number | string | null;
  tbmRate?: string | null;
  items: PatrolLogItem[];
  actions: PatrolLogAction[];
};

export function resultLabelKo(result?: string | null): string {
  if (result === 'pass') return '양호';
  if (result === 'fail') return '불량';
  return '';
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function photoTags(urls?: string[] | null, size = 150): string {
  const h = Math.round(size * 0.75);
  return (urls || [])
    .filter(Boolean)
    .map(
      (u) =>
        `<img src="${escapeHtml(u)}" alt="" style="width:${size}px;height:${h}px;object-fit:cover;border:1px solid #999;margin:3px;" />`,
    )
    .join('');
}

export function formatInspectedAtKo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export function formatPatrolDateDot(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d).split('-');
  if (parts.length !== 3) return formatInspectedAtKo(iso);
  return `${parts[0]}. ${parts[1]}. ${parts[2]}.`;
}

/** 엑셀「순회 안전점검일지」틀: 머리글·출력현황·13항목·사진대지·총괄책임자. */
export function buildPatrolLogHtml(facts: PatrolLogFacts): string {
  const inspector = formatInspectorLine(facts.inspectorName, facts.inspectorTitle);
  const site = [facts.projectName, facts.siteName].filter(Boolean).join(' ') || facts.projectName;
  const dateDot = formatPatrolDateDot(facts.inspectedAt);
  const weather = String(facts.weather || '').trim() || '-';
  const works = (facts.workItems || []).filter(Boolean);
  const workHtml = works.length
    ? works.map((w) => `- ${escapeHtml(w)}`).join('<br/>')
    : (facts.location ? `- ${escapeHtml(facts.location)}` : '');
  const manpower = facts.manpower?.length
    ? facts.manpower
    : [{ group: '당 사', title: '관리', today: '', cumulative: '' }];
  const manRows = manpower.map((row, i) => {
    const tbm = i === 0 && facts.tbmAttendees != null && facts.tbmAttendees !== ''
      ? String(facts.tbmAttendees)
      : '';
    const rate = i === 0 ? String(facts.tbmRate || '') : '';
    return `<tr>
      <td>${escapeHtml(row.group)}</td>
      <td>${escapeHtml(row.title)}</td>
      <td class="c">${escapeHtml(String(row.today ?? ''))}</td>
      <td class="c">${escapeHtml(String(row.cumulative ?? ''))}</td>
      <td class="c">${escapeHtml(tbm)}</td>
      <td class="c">${escapeHtml(rate)}</td>
      ${i === 0 ? `<td class="work" rowspan="${manpower.length}">${workHtml}</td>` : ''}
    </tr>`;
  }).join('');

  const findingPhotos: string[] = [];
  const actionPhotos: string[] = [];
  const itemRows = facts.items.map((it, i) => {
    const fail = it.result === 'fail';
    const act = facts.actions.find((a) => String(a.issue || '') === String(it.label || ''))
      || (fail ? facts.actions.find((a) => !a.issue) : undefined);
    for (const p of it.photos || []) findingPhotos.push(p);
    if (act) for (const p of act.evidence_photos || []) actionPhotos.push(p);
    const actionCell = act
      ? [act.status === 'done' ? '조치완료' : '조치중', act.assignee_name].filter(Boolean).join(' · ')
      : '';
    return `<tr>
      <td class="c">${i + 1}</td>
      <td class="left">${escapeHtml(it.label)}</td>
      <td class="c ${fail ? 'bad' : it.result === 'pass' ? 'ok' : ''}">${escapeHtml(resultLabelKo(it.result))}</td>
      <td class="left">${escapeHtml(fail ? (it.note || '') : '')}</td>
      <td class="left">${escapeHtml(actionCell)}</td>
    </tr>`;
  }).join('');

  const sdRows = SITE_DIRECTOR_PATROL_ITEMS.map((sd) => {
    const src = facts.items.find((it) => it.checklist_code === sd.sourceCode);
    const r = src?.result;
    const mark = (want: 'pass' | 'na' | 'fail') => (r === want ? '○' : '');
    const improve = r === 'fail' ? (src?.note || '') : '';
    return `<tr>
      <td>${escapeHtml(sd.category)}</td>
      <td class="left">${escapeHtml(sd.label)}</td>
      <td class="c">${mark('pass')}</td>
      <td class="c">${mark('na')}</td>
      <td class="c">${mark('fail')}</td>
      <td class="left">${escapeHtml(improve)}</td>
      <td></td>
    </tr>`;
  }).join('');

  const citeShort = PATROL_LOG_CITATIONS.slice(0, 3).map((c) => citationLine(c)).join(' · ');

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/><title>${escapeHtml(PATROL_LOG_TITLE)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm 8mm; }
  body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;padding:0;margin:0;font-size:11px;color:#111}
  table.sheet{width:100%;border-collapse:collapse;table-layout:fixed}
  table.sheet th, table.sheet td{border:1px solid #111;padding:4px 5px;vertical-align:middle}
  .title{font-size:20px;letter-spacing:6px;text-align:center;font-weight:bold;height:36px}
  .site{text-align:left;font-weight:bold}
  .stamp{text-align:center;height:46px;vertical-align:top}
  .c{text-align:center}
  .left{text-align:left}
  .ok{color:#166534;font-weight:bold}
  .bad{color:#b91c1c;font-weight:bold}
  .work{text-align:left;vertical-align:top;line-height:1.45;font-size:10.5px}
  .sec{font-size:13px;font-weight:bold;text-align:center;background:#f3f4f6}
  .photos td{height:150px;vertical-align:top}
  .fine{font-size:9px;color:#333;margin-top:8px;line-height:1.4}
</style></head><body>
<table class="sheet">
  <tr><td class="title" colspan="7">${escapeHtml(PATROL_LOG_PRINT_TITLE)}</td></tr>
  <tr>
    <td class="site" colspan="4">현장명 : ${escapeHtml(site || '-')}</td>
    <td class="c" rowspan="2">결 재</td>
    <td class="stamp" rowspan="2">안전관리자<br/><span style="font-size:10px">${escapeHtml(inspector || '')}</span></td>
    <td class="stamp" rowspan="2">안전보건총괄</td>
  </tr>
  <tr>
    <td colspan="2">${escapeHtml(dateDot)}</td>
    <td colspan="2">날씨 : ${escapeHtml(weather)}</td>
  </tr>
  <tr>
    <td class="c">구 분</td><td class="c">직 책</td><td class="c">금일</td><td class="c">누 계</td>
    <td class="c">TBM 참석자</td><td class="c">참석률</td><td class="c">작 업 내 용</td>
  </tr>
  ${manRows}
</table>
<table class="sheet" style="margin-top:6px">
  <colgroup>
    <col style="width:6%"/><col style="width:32%"/><col style="width:8%"/><col style="width:27%"/><col style="width:27%"/>
  </colgroup>
  <tr>
    <th>구분</th><th>점 검 사 항</th><th>결과</th><th>지 적 사 항</th><th>지적사항 조치결과</th>
  </tr>
  ${itemRows || '<tr><td colspan="5">기록된 점검 항목이 없습니다.</td></tr>'}
  <tr class="photos">
    <td colspan="3"></td>
    <td>사진대지<br/>${photoTags(findingPhotos)}</td>
    <td>사진대지<br/>${photoTags(actionPhotos)}</td>
  </tr>
</table>
<table class="sheet" style="margin-top:8px">
  <tr><td class="sec" colspan="7">${escapeHtml(SITE_DIRECTOR_PATROL_TITLE)}</td></tr>
  <tr>
    <th style="width:14%">구 분</th>
    <th style="width:24%">점검항목</th>
    <th colspan="3">점검결과</th>
    <th style="width:22%">개선요망 사항</th>
    <th style="width:12%">비 고</th>
  </tr>
  <tr>
    <td></td><td></td>
    <td class="c" style="width:8%">양호</td>
    <td class="c" style="width:8%">보통</td>
    <td class="c" style="width:8%">불량</td>
    <td></td><td></td>
  </tr>
  ${sdRows}
</table>
<p class="fine">${escapeHtml(citeShort)}. ${escapeHtml(PATROL_LOG_RETENTION)} ${escapeHtml(PATROL_LOG_DISCLAIMER)}
출력 ${escapeHtml(formatInspectedAtKo(new Date().toISOString()))}${facts.summary ? ` · ${escapeHtml(facts.summary)}` : ''}</p>
</body></html>`;
}
