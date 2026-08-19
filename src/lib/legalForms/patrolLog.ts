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
export const PATROL_LOG_TITLE = '작업장 순회점검일지';
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

export const PATROL_CHECKLIST_ITEMS: PatrolChecklistItem[] = [
  {
    code: 'PT-001',
    label: '현장 전반 유해·위험요인 및 안전조치 상태',
    legal_basis: '산업안전보건법 시행령 제18조제1항제5호',
  },
  {
    code: 'PT-002',
    label: '근로자 안전수칙 준수 및 보호구 착용',
    legal_basis: '산업안전보건법 제38조, 산업안전보건기준에 관한 규칙 제32조',
  },
  {
    code: 'PT-003',
    label: '안전표지·경고표지·통로·난간 등 안전시설',
    legal_basis: '산업안전보건법 제37조, 산업안전보건기준에 관한 규칙 제13조',
  },
  {
    code: 'PT-004',
    label: '도급·협력업체 작업장 순회 및 조치 건의',
    legal_basis: '산업안전보건법 제64조제1항제2호',
  },
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
  assignee_name?: string | null;
  due_date?: string | null;
  status?: string | null;
  evidence_photos?: string[] | null;
};

export type PatrolLogFacts = {
  projectName: string;
  siteName?: string | null;
  inspectedAt: string;
  inspectorName: string;
  inspectorTitle?: string | null;
  location: string;
  summary?: string | null;
  items: PatrolLogItem[];
  actions: PatrolLogAction[];
};

export function resultLabelKo(result?: string | null): string {
  if (result === 'pass') return '이상없음';
  if (result === 'fail') return '조치필요';
  if (result === 'na') return '해당없음';
  return '미기재';
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function photoTags(urls?: string[] | null): string {
  return (urls || [])
    .filter(Boolean)
    .map(
      (u) =>
        `<img src="${escapeHtml(u)}" alt="" style="width:110px;height:82px;object-fit:cover;border:1px solid #ccc;margin:2px;" />`,
    )
    .join('');
}

export function formatInspectedAtKo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

/** 순회점검일지 인쇄 HTML. 다른 점검 유형 인쇄와 분리한다. */
export function buildPatrolLogHtml(facts: PatrolLogFacts): string {
  const inspector = formatInspectorLine(facts.inspectorName, facts.inspectorTitle);
  const site = [facts.projectName, facts.siteName].filter(Boolean).join(' / ');
  const citeRows = PATROL_LOG_CITATIONS.map(
    (c) =>
      `<tr><td>${escapeHtml(citationLine(c))}</td><td>${escapeHtml(c.summary)}</td></tr>`,
  ).join('');
  const itemRows = facts.items
    .map((it, i) => {
      const fail = it.result === 'fail';
      return `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(it.checklist_code || '')}</td>
        <td>${escapeHtml(it.label)}</td>
        <td style="font-size:10px;color:#555">${escapeHtml(it.legal_basis || '')}</td>
        <td style="text-align:center;font-weight:bold;color:${fail ? '#b91c1c' : it.result === 'pass' ? '#166534' : '#6b7280'}">${escapeHtml(resultLabelKo(it.result))}</td>
        <td>${escapeHtml(it.note || '')}</td>
        <td>${photoTags(it.photos)}</td>
      </tr>`;
    })
    .join('');
  const actionRows = facts.actions
    .map((a, i) => {
      const done = a.status === 'done';
      const st = done ? '완료' : a.status === 'in_progress' ? '진행중' : '대기';
      return `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(a.issue)}</td>
        <td>${escapeHtml(a.assignee_name || '-')}</td>
        <td>${escapeHtml(a.due_date || '-')}</td>
        <td style="text-align:center;color:${done ? '#166534' : '#b45309'}">${st}</td>
        <td>${photoTags(a.evidence_photos)}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/><title>${escapeHtml(PATROL_LOG_TITLE)}</title>
<style>
  body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;padding:16px;font-size:12px;color:#111}
  h1{font-size:20px;text-align:center;margin:0 0 4px}
  .sub{text-align:center;font-size:11px;color:#555;margin-bottom:12px}
  h2{font-size:13px;border-bottom:2px solid #111;padding-bottom:4px;margin:18px 0 8px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{border:1px solid #333;padding:6px;vertical-align:top}
  th{background:#f3f4f6;font-weight:bold}
  .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:0;margin:10px 0;border:1px solid #333}
  .meta div{border:1px solid #333;padding:7px}
  .meta b{display:inline-block;min-width:5.5em}
  .sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:28px}
  .sign div{border:1px solid #333;height:72px;padding:6px;font-size:11px}
  .fine{margin-top:16px;font-size:10px;color:#444;line-height:1.45}
  @media print{body{padding:8mm} .no-print{display:none}}
</style></head><body>
<h1>${escapeHtml(PATROL_LOG_TITLE)}</h1>
<div class="sub">산업안전보건법 시행령 제18조·제22조 / 법 제64조 증빙</div>
<div class="meta">
  <div><b>현장명</b> ${escapeHtml(site || '-')}</div>
  <div><b>점검일시</b> ${escapeHtml(formatInspectedAtKo(facts.inspectedAt))}</div>
  <div><b>점검자·직책</b> ${escapeHtml(inspector || '-')}</div>
  <div><b>순회 구간</b> ${escapeHtml(facts.location || '-')}</div>
</div>
${facts.summary ? `<p><b>개요</b> ${escapeHtml(facts.summary)}</p>` : ''}
<h2>순회 관찰 (${facts.items.length})</h2>
<table>
  <thead><tr><th>#</th><th>코드</th><th>항목</th><th>법적 근거</th><th>결과</th><th>발견사항·즉시조치</th><th>사진</th></tr></thead>
  <tbody>${itemRows || '<tr><td colspan="7">기록된 관찰 항목이 없습니다.</td></tr>'}</tbody>
</table>
${
  facts.actions.length
    ? `<h2>조치 건의 (${facts.actions.length})</h2>
<table><thead><tr><th>#</th><th>내용</th><th>담당</th><th>기한</th><th>상태</th><th>증빙</th></tr></thead>
<tbody>${actionRows}</tbody></table>`
    : ''
}
<h2>법적 근거 (시스템 고정)</h2>
<table><thead><tr><th>조문</th><th>요지</th></tr></thead><tbody>${citeRows}</tbody></table>
<div class="sign">
  <div>점검자 서명<br/></div>
  <div>확인자(관리감독자) 서명<br/></div>
  <div>안전관리자 서명<br/></div>
</div>
<p class="fine">${escapeHtml(PATROL_LOG_RETENTION)} ${escapeHtml(PATROL_LOG_DISCLAIMER)}
출력: ${escapeHtml(formatInspectedAtKo(new Date().toISOString()))}</p>
</body></html>`;
}
