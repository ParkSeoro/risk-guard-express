/** KST calendar date helpers + permit list visibility for work_permits. */

export const DRAFT_PERMIT_STATUSES = new Set(['작성중', '임시저장']);
export const REJECTED_PERMIT_STATUSES = new Set(['반려']);
export const APPROVED_PERMIT_STATUSES_FOR_VALIDITY = new Set([
  '승인',
  '승인완료',
  '발행완료',
  'approved',
  'ISSUED',
  'APPROVED',
  '종료대기',
  'CLOSURE_PENDING',
  '종료완료',
  'CLOSED',
  '마감',
]);

/**
 * 반려 사유는 현재 상태가 반려일 때만 표시.
 * 재상신·발행 완료 후에도 rejection_reason 컬럼이 남아 있어도 UI에 노출하지 않음.
 */
export function shouldShowPermitRejectionReason(
  status?: string | null,
  rejectionReason?: string | null,
): boolean {
  if (!REJECTED_PERMIT_STATUSES.has(status || '')) return false;
  return Boolean(String(rejectionReason || '').trim());
}

/** Display label for the contractor / submitting company on permit list cards. */
export function resolvePermitCompanyName(
  permit: {
    contractor_company?: string | null;
    company_id?: string | null;
    form_data?: Record<string, unknown> | null;
  } | null | undefined,
  companyNameById?: Map<string, string> | Record<string, string> | null,
): string {
  if (!permit) return '';
  const fd = (permit.form_data || {}) as Record<string, unknown>;
  const fromFields = [
    permit.contractor_company,
    fd.contractor_company,
    fd.applicant_company,
  ]
    .map((v) => String(v || '').trim())
    .find(Boolean);
  if (fromFields) return fromFields;

  const companyId = permit.company_id || null;
  if (!companyId || !companyNameById) return '';
  if (companyNameById instanceof Map) return companyNameById.get(companyId) || '';
  return companyNameById[companyId] || '';
}

/** Today's date in Asia/Seoul as YYYY-MM-DD. */
export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Extract YYYY-MM-DD.
 * - date-only / datetime-local (no Z/offset): use leading calendar date (user intent)
 * - absolute ISO (Z or ±offset): Asia/Seoul calendar day
 */
export function datePartFromDateTime(value?: string | null): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed) || trimmed.includes('Z');
  if (hasTz) {
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return null;
    return todayKst(d);
  }
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return todayKst(d);
}

/**
 * Canonical work date for list/validity:
 * form_data.work_start → work_start_at → permit_date
 */
export function resolvePermitWorkDate(permit: {
  permit_date?: string | null;
  work_start_at?: string | null;
  form_data?: { work_start?: string | null } | null;
}): string | null {
  const fromForm = datePartFromDateTime(permit?.form_data?.work_start);
  if (fromForm) return fromForm;
  const fromCol = datePartFromDateTime(permit?.work_start_at);
  if (fromCol) return fromCol;
  return datePartFromDateTime(permit?.permit_date);
}

/** Sync permit_date from work_start (datetime-local or ISO); keep fallback if empty. */
export function syncPermitDateFromWorkStart(
  workStart?: string | null,
  fallbackPermitDate?: string | null,
): string {
  return datePartFromDateTime(workStart) || datePartFromDateTime(fallbackPermitDate) || todayKst();
}

export type PermitValidityKind = 'expired' | 'today' | 'scheduled' | null;

export function permitValidityKind(
  workDate: string | null | undefined,
  today: string = todayKst(),
): PermitValidityKind {
  if (!workDate) return null;
  if (workDate < today) return 'expired';
  if (workDate === today) return 'today';
  return 'scheduled';
}

/** Validity badges only for issued/closed docs — not drafts/rejected. */
export function shouldShowPermitValidityBadge(status?: string | null): boolean {
  return APPROVED_PERMIT_STATUSES_FOR_VALIDITY.has(status || '');
}

export interface PermitListVisibilityOpts {
  userId?: string | null;
  /** master / project_admin / safety_manager */
  isPermitAdmin?: boolean;
  /** Permit ids where user appears on the approval line */
  involvedPermitIds?: Set<string> | ReadonlySet<string>;
}

/**
 * List visibility:
 * - 작성중/임시저장: author or admin
 * - 반려: author, admin, or approval-line participant
 * - else: visible (company/RLS still apply upstream)
 */
export function canViewPermitInList(
  permit: { id?: string; status?: string | null; created_by?: string | null },
  opts: PermitListVisibilityOpts,
): boolean {
  const status = permit.status || '';
  const isAuthor = !!opts.userId && permit.created_by === opts.userId;
  if (opts.isPermitAdmin || isAuthor) return true;

  if (DRAFT_PERMIT_STATUSES.has(status)) return false;

  if (REJECTED_PERMIT_STATUSES.has(status)) {
    return !!(permit.id && opts.involvedPermitIds?.has(permit.id));
  }

  return true;
}

export function isUserInvolvedInPermit(
  permit: { id?: string; created_by?: string | null },
  opts: Pick<PermitListVisibilityOpts, 'userId' | 'involvedPermitIds'>,
): boolean {
  if (!opts.userId) return false;
  if (permit.created_by === opts.userId) return true;
  return !!(permit.id && opts.involvedPermitIds?.has(permit.id));
}
