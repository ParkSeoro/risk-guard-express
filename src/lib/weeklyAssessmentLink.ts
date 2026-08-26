/** Weekly RA link: 차주 회차 ↔ 전회차(금주 작업분) without copying risk rows. */

export type WeeklyLinkRun = {
  id: string;
  project_id: string;
  type?: string | null;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  created_at: string;
  target_company_ids?: string[] | null;
  period_label?: string | null;
  is_deleted?: boolean | null;
  feedback_status?: string | null;
};

export function normalizeCompanyIds(ids?: string[] | null): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Empty vs non-empty must not match (Hi-Tech vs 진남 isolation).
 * Both empty = same unspecified bucket.
 */
export function companyTargetsOverlap(
  a?: string[] | null,
  b?: string[] | null,
): boolean {
  const na = normalizeCompanyIds(a);
  const nb = normalizeCompanyIds(b);
  if (na.length === 0 && nb.length === 0) return true;
  if (na.length === 0 || nb.length === 0) return false;
  const other = new Set(nb);
  return na.some((id) => other.has(id));
}

function periodKey(run: WeeklyLinkRun): string | null {
  const start = String(run.start_date || '').trim();
  if (start) return start.slice(0, 10);
  const created = String(run.created_at || '').trim();
  return created ? created.slice(0, 10) : null;
}

function isEligiblePrevious(current: WeeklyLinkRun, candidate: WeeklyLinkRun): boolean {
  if (!candidate?.id || candidate.id === current.id) return false;
  if (candidate.project_id !== current.project_id) return false;
  if (candidate.status !== '승인완료') return false;
  if (candidate.is_deleted) return false;
  return companyTargetsOverlap(current.target_company_ids, candidate.target_company_ids);
}

function compareNewestFirst(a: WeeklyLinkRun, b: WeeklyLinkRun): number {
  const ak = periodKey(a) || a.created_at;
  const bk = periodKey(b) || b.created_at;
  if (ak !== bk) return ak < bk ? 1 : -1;
  return a.created_at < b.created_at ? 1 : -1;
}

/** Same project + overlapping companies + 승인완료. Prefer same type, then latest period before current start. */
export function pickPreviousApprovedRun(
  current: WeeklyLinkRun,
  candidates: WeeklyLinkRun[],
): WeeklyLinkRun | null {
  const eligible = (candidates || []).filter((c) => isEligiblePrevious(current, c));
  if (eligible.length === 0) return null;

  const sameType = current.type
    ? eligible.filter((c) => c.type === current.type)
    : [];
  const pool = sameType.length > 0 ? sameType : eligible;

  const currentStart = String(current.start_date || '').trim().slice(0, 10);
  const beforeByStart = currentStart
    ? pool.filter((c) => {
        const key = periodKey(c);
        return !!key && key < currentStart;
      })
    : [];
  const beforeByCreated = pool.filter((c) => c.created_at < current.created_at);
  const ranked = (beforeByStart.length > 0
    ? beforeByStart
    : beforeByCreated.length > 0
      ? beforeByCreated
      : []).slice();
  if (ranked.length === 0) return null;
  ranked.sort(compareNewestFirst);
  return ranked[0] || null;
}

/**
 * Which run stores 조치 전후 사진.
 * - 차주 작성 중, or 승인됐지만 작업 시작일 전 → 전회차
 * - 이 회차가 승인되고 시작일이 지났으면 → 이 회차 (다음 회의의 금주)
 * - 첫 회차(전회차 없음) → 승인 후에만 이 회차
 */
export function resolveExecutionFeedbackTarget(opts: {
  current: WeeklyLinkRun;
  previous: WeeklyLinkRun | null;
  today: string;
}): WeeklyLinkRun | null {
  const { current, previous, today } = opts;
  const approved = current.status === '승인완료';
  const start = String(current.start_date || '').trim().slice(0, 10);

  if (previous && !approved) return previous;
  if (previous && approved && start && today < start) return previous;
  if (approved) return current;
  return previous;
}

/**
 * Print 금주 사진 섹션: always 전회차 when linked.
 * First cycle (no previous): this run's own feedback after 승인완료.
 */
export function resolvePrintFeedbackRun(opts: {
  current: WeeklyLinkRun;
  previous: WeeklyLinkRun | null;
}): WeeklyLinkRun | null {
  if (opts.previous) return opts.previous;
  if (opts.current.status === '승인완료') return opts.current;
  return null;
}

export function isManagedResidualHigh(item: { improved_risk_grade?: string | null }): boolean {
  return item.improved_risk_grade === '상';
}

/**
 * Candidate list for 전회차 lookup. Keep this off schema-optional columns
 * (`feedback_status` etc.): PostgREST rejects the whole select if one name is
 * missing, which blanks the 금주 이행 tab while print (service role, different
 * column list) still shows photos.
 */
export const WEEKLY_LINK_CANDIDATE_SELECT =
  'id, project_id, type, status, start_date, end_date, created_at, target_company_ids, period_label, is_deleted';

export function unresolvedFeedback<T extends { status?: string | null }>(rows: T[]): T[] {
  return (rows || []).filter((f) => f.status === '미조치' || f.status === '진행중');
}

export function unresolvedFeedbackCount(rows: Array<{ status?: string | null }>): number {
  return unresolvedFeedback(rows).length;
}

/** Badge/heading count for the 금주 이행 tab (all statuses on the execution target). */
export function executionFeedbackCount(opts: {
  executionId: string | null | undefined;
  previousId: string | null | undefined;
  currentId: string | null | undefined;
  previousFeedbackCount: number;
  currentFeedbackCount: number;
}): number {
  const { executionId, previousId, currentId } = opts;
  if (!executionId) return 0;
  if (previousId && executionId === previousId) return opts.previousFeedbackCount;
  if (currentId && executionId === currentId) return opts.currentFeedbackCount;
  return 0;
}
