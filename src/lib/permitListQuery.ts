import { resolvePermitCompanyName, resolvePermitWorkDate, todayKst } from '@/lib/permitWorkDate';

export type PermitListPeriod = '14d' | 'month' | 'all';

export type PermitListStatusFilter =
  | 'all'
  | 'draft'
  | 'in_approval'
  | 'issued'
  | 'closure_pending'
  | 'closed'
  | 'rejected';

const DRAFT = new Set(['작성중', '임시저장']);
const IN_APPROVAL = new Set(['결재중', '결재진행', '검토대기', '검토완료', '대기']);
const ISSUED = new Set(['승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED']);
const CLOSURE_PENDING = new Set(['종료대기', 'CLOSURE_PENDING']);
const CLOSED = new Set(['종료완료', 'CLOSED', '마감', '완료']);
const REJECTED = new Set(['반려']);

/** Inclusive calendar-day shift on a YYYY-MM-DD string. */
export function addCalendarDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + delta));
  return dt.toISOString().slice(0, 10);
}

export function permitListDateFrom(
  period: PermitListPeriod,
  today: string = todayKst(),
): string | null {
  if (period === 'all') return null;
  if (period === 'month') return `${today.slice(0, 7)}-01`;
  return addCalendarDaysYmd(today, -13);
}

export function matchesPermitDateRange(
  workDate: string | null,
  fromYmd: string | null,
  toYmd: string,
): boolean {
  if (!fromYmd) return true;
  if (!workDate) return true;
  return workDate >= fromYmd && workDate <= toYmd;
}

export function matchesPermitStatusFilter(
  status: string | null | undefined,
  filter: PermitListStatusFilter,
): boolean {
  if (filter === 'all') return true;
  const s = status || '';
  if (filter === 'draft') return DRAFT.has(s);
  if (filter === 'in_approval') return IN_APPROVAL.has(s);
  if (filter === 'issued') return ISSUED.has(s);
  if (filter === 'closure_pending') return CLOSURE_PENDING.has(s);
  if (filter === 'closed') return CLOSED.has(s);
  if (filter === 'rejected') return REJECTED.has(s);
  return true;
}

export function matchesPermitSearch(
  permit: {
    work_name?: string | null;
    work_description?: string | null;
    location?: string | null;
    contractor_company?: string | null;
    company_id?: string | null;
    form_data?: Record<string, unknown> | null;
  },
  query: string,
  companyNameById?: Map<string, string> | Record<string, string> | null,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const company = resolvePermitCompanyName(permit, companyNameById);
  const hay = [
    permit.work_name,
    permit.work_description,
    permit.location,
    company,
    permit.form_data?.work_location,
  ]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  return hay.includes(q);
}

export type PermitApprovalNameRow = {
  entity_id?: string | null;
  position?: string | null;
  status?: string | null;
  approver_name?: string | null;
  approved_at?: string | null;
};

function pos(row: PermitApprovalNameRow): string {
  return (row.position || '').toLowerCase();
}

function isApproved(row: PermitApprovalNameRow): boolean {
  return row.status === '승인' || (row.status || '').toLowerCase() === 'approved';
}

/** Issuance submitter name: column first, else 시공 상신 결재행. */
export function resolvePermitSubmittedByName(
  permit: { id?: string; submitted_by_name?: string | null },
  rows: PermitApprovalNameRow[],
): string {
  const col = String(permit.submitted_by_name || '').trim();
  if (col) return col;
  const hit = rows.find(
    (r) =>
      r.entity_id === permit.id &&
      (pos(r) === 'contractor_supervisor' || pos(r) === 'contractor_pic') &&
      r.approver_name,
  );
  return String(hit?.approver_name || '').trim();
}

/** Issuance final SM name: column first, else owner_sm 승인 행 (closure_sm 제외). */
export function resolvePermitApprovedByName(
  permit: { id?: string; approved_by_name?: string | null },
  rows: PermitApprovalNameRow[],
): string {
  const col = String(permit.approved_by_name || '').trim();
  if (col) return col;
  const hits = rows
    .filter(
      (r) =>
        r.entity_id === permit.id &&
        (pos(r) === 'owner_sm' || pos(r) === 'sm') &&
        isApproved(r) &&
        r.approver_name,
    )
    .sort((a, b) => String(a.approved_at || '').localeCompare(String(b.approved_at || '')));
  return String(hits[hits.length - 1]?.approver_name || '').trim();
}

export type ClosureListProgress = {
  label: string;
  supervisorDone: boolean;
  smWaiting: boolean;
};

export function closureListProgress(
  permitId: string,
  rows: PermitApprovalNameRow[],
): ClosureListProgress | null {
  const mine = rows.filter((r) => r.entity_id === permitId);
  const sup = mine.filter((r) => pos(r) === 'closure_supervisor');
  const sm = mine.filter((r) => pos(r) === 'closure_sm');
  if (sup.length === 0 && sm.length === 0) return null;

  const supApproved = sup.some(isApproved);
  const smOpen = sm.some((r) => r.status === '대기' || r.status === '진행중');
  const smApproved = sm.some(isApproved);
  const supOpen = sup.some((r) => r.status === '대기' || r.status === '진행중');
  const supName = (sup.find(isApproved) || sup.find((r) => r.approver_name))?.approver_name || '';
  const smName = (sm.find((r) => r.status === '진행중') || sm.find((r) => r.approver_name))?.approver_name || '';

  if (smApproved) {
    return { label: '작업 완료 종료됨', supervisorDone: true, smWaiting: false };
  }
  if (supApproved && smOpen) {
    return {
      label: `관리감독자 확인됨${supName ? ` (${supName})` : ''} · 발주처 SM 종료 승인 대기${smName ? ` (${smName})` : ''}`,
      supervisorDone: true,
      smWaiting: true,
    };
  }
  if (supOpen) {
    return {
      label: `관리감독자 완료 확인 대기${supName ? ` (${supName})` : ''}`,
      supervisorDone: false,
      smWaiting: false,
    };
  }
  if (smOpen) {
    return {
      label: `발주처 SM 종료 승인 대기${smName ? ` (${smName})` : ''}`,
      supervisorDone: supApproved,
      smWaiting: true,
    };
  }
  return { label: '종료 결재 진행중', supervisorDone: supApproved, smWaiting: smOpen };
}

export function filterPermitsForList<T extends {
  id?: string;
  status?: string | null;
  work_name?: string | null;
  work_description?: string | null;
  location?: string | null;
  contractor_company?: string | null;
  company_id?: string | null;
  permit_date?: string | null;
  work_start_at?: string | null;
  form_data?: Record<string, unknown> | null;
}>(
  permits: T[],
  opts: {
    period: PermitListPeriod;
    statusFilter: PermitListStatusFilter;
    search: string;
    today?: string;
    companyNameById?: Map<string, string> | Record<string, string> | null;
  },
): T[] {
  const today = opts.today || todayKst();
  const from = permitListDateFrom(opts.period, today);
  return permits.filter((p) => {
    if (!matchesPermitStatusFilter(p.status, opts.statusFilter)) return false;
    if (!matchesPermitSearch(p, opts.search, opts.companyNameById)) return false;
    const workDate = resolvePermitWorkDate(p as any);
    if (!matchesPermitDateRange(workDate, from, today)) return false;
    return true;
  });
}
