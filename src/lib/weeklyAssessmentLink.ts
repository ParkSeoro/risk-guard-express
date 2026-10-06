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
  author_user_id?: string | null;
  created_by?: string | null;
  /** Display only. Stamped from the effective company before the picker renders. */
  company_label?: string | null;
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
 * Companies must actually intersect.
 * A blank list is not every company, and two blank lists are not the same company.
 * Callers stamp the author's company onto a blank run before comparing.
 */
export function companyTargetsOverlap(
  a?: string[] | null,
  b?: string[] | null,
): boolean {
  const na = normalizeCompanyIds(a);
  const nb = normalizeCompanyIds(b);
  if (na.length === 0 || nb.length === 0) return false;
  const other = new Set(nb);
  return na.some((id) => other.has(id));
}

/** target_company_ids when set, otherwise the author's company. Never "blank = shared". */
export function effectiveCompanyIds(
  run: WeeklyLinkRun,
  authorCompanyByUser?: Record<string, string | null | undefined> | null,
): string[] {
  const targets = normalizeCompanyIds(run.target_company_ids);
  if (targets.length > 0) return targets;
  const map = authorCompanyByUser || {};
  const authorId = String(run.author_user_id || '').trim();
  const creatorId = String(run.created_by || '').trim();
  const author = (authorId && map[authorId]) || (creatorId && map[creatorId]) || '';
  const id = String(author || '').trim();
  return id ? [id] : [];
}

export function stampRunCompany<T extends WeeklyLinkRun>(
  run: T,
  authorCompanyByUser?: Record<string, string | null | undefined> | null,
  companyLabelById?: Record<string, string | null | undefined> | null,
): T {
  const ids = effectiveCompanyIds(run, authorCompanyByUser);
  const label = ids
    .map((id) => String(companyLabelById?.[id] || '').trim())
    .filter(Boolean)
    .join(', ');
  return { ...run, target_company_ids: ids, company_label: label || null };
}

function periodKey(run: WeeklyLinkRun): string | null {
  const start = String(run.start_date || '').trim();
  if (start) return start.slice(0, 10);
  const created = String(run.created_at || '').trim();
  return created ? created.slice(0, 10) : null;
}

function isSameProjectCandidate(current: WeeklyLinkRun, candidate: WeeklyLinkRun): boolean {
  if (!candidate?.id || candidate.id === current.id) return false;
  if (candidate.project_id !== current.project_id) return false;
  if (candidate.is_deleted) return false;
  return true;
}

/**
 * Same company chain only when effective target-company ids overlap.
 * The author's company fills a blank tag. It does not bridge two different tags.
 * A viewer who can see other companies still cannot attach those documents.
 */
export function assessmentCompanyChainMatch(
  a: WeeklyLinkRun,
  b: WeeklyLinkRun,
  authorCompanyByUser?: Record<string, string | null | undefined> | null,
): boolean {
  return companyTargetsOverlap(
    effectiveCompanyIds(a, authorCompanyByUser),
    effectiveCompanyIds(b, authorCompanyByUser),
  );
}

function isEligiblePrevious(
  current: WeeklyLinkRun,
  candidate: WeeklyLinkRun,
  authorCompanyByUser?: Record<string, string | null | undefined> | null,
): boolean {
  if (!isSameProjectCandidate(current, candidate)) return false;
  if (candidate.status !== '승인완료') return false;
  return assessmentCompanyChainMatch(current, candidate, authorCompanyByUser);
}

function compareNewestFirst(a: WeeklyLinkRun, b: WeeklyLinkRun): number {
  const ak = periodKey(a) || a.created_at;
  const bk = periodKey(b) || b.created_at;
  if (ak !== bk) return ak < bk ? 1 : -1;
  return a.created_at < b.created_at ? 1 : -1;
}

function rankPreviousPool(current: WeeklyLinkRun, pool: WeeklyLinkRun[]): WeeklyLinkRun | null {
  if (pool.length === 0) return null;
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

/** Same project + same company + 승인완료. Prefer same type, then latest period before current start. */
export function pickPreviousApprovedRun(
  current: WeeklyLinkRun,
  candidates: WeeklyLinkRun[],
  authorCompanyByUser?: Record<string, string | null | undefined> | null,
): WeeklyLinkRun | null {
  const eligible = (candidates || []).filter((c) => isEligiblePrevious(current, c, authorCompanyByUser));
  if (eligible.length === 0) return null;

  const sameType = current.type
    ? eligible.filter((c) => c.type === current.type)
    : [];
  const picked = rankPreviousPool(current, sameType.length > 0 ? sameType : eligible);
  if (picked) return picked;
  // Same-type pool existed but none were actually earlier → try other types.
  if (sameType.length > 0) return rankPreviousPool(current, eligible);
  return null;
}

const MANUAL_PREVIOUS_STATUSES = new Set(['승인완료', '결재진행']);

/**
 * Picker list: 승인완료·결재진행 of the same target companies only.
 * A different company is never listed, even when the same person wrote it
 * or the viewer can open that company's other documents.
 */
export function listManualPreviousCandidates(
  current: WeeklyLinkRun,
  candidates: WeeklyLinkRun[],
  authorCompanyByUser?: Record<string, string | null | undefined> | null,
): WeeklyLinkRun[] {
  const rows = (candidates || []).filter((c) => {
    if (!isSameProjectCandidate(current, c)) return false;
    if (!MANUAL_PREVIOUS_STATUSES.has(c.status)) return false;
    return assessmentCompanyChainMatch(current, c, authorCompanyByUser);
  });
  rows.sort(compareNewestFirst);
  return rows;
}

/** Saved link wins only when it overlaps this document's companies. Otherwise auto. */
export function resolvePreviousRun(
  current: WeeklyLinkRun,
  candidates: WeeklyLinkRun[],
  overrideId?: string | null,
  authorCompanyByUser?: Record<string, string | null | undefined> | null,
): WeeklyLinkRun | null {
  const id = String(overrideId || '').trim();
  if (id && id !== current.id) {
    const hit = listManualPreviousCandidates(current, candidates, authorCompanyByUser).find((c) => c.id === id);
    if (hit) return hit;
  }
  return pickPreviousApprovedRun(current, candidates, authorCompanyByUser);
}

/**
 * A chain lookup that returns no previous must not erase one the screen already has.
 * A loaded chain previous is used only when accept() allows it.
 */
export function mergeFeedbackChainPrevious(opts: {
  chain: AssessmentFeedbackChain | null;
  chainPrevious: WeeklyLinkRun | null;
  chainAuto: WeeklyLinkRun | null;
  localPrevious: WeeklyLinkRun | null;
  localAuto: WeeklyLinkRun | null;
  accept?: (run: WeeklyLinkRun) => boolean;
}): { previous: WeeklyLinkRun | null; auto: WeeklyLinkRun | null } {
  const keep = (run: WeeklyLinkRun | null) => {
    if (!run) return null;
    if (opts.accept && !opts.accept(run)) return null;
    return run;
  };
  const auto = keep(opts.chainAuto) || keep(opts.localAuto);
  const local = keep(opts.localPrevious);
  if (!opts.chain) return { previous: local || auto, auto };
  return { previous: keep(opts.chainPrevious) || local || auto, auto };
}

export function formatPreviousRunOptionLabel(
  run: WeeklyLinkRun,
  managedCount?: number,
): string {
  const period = String(run.period_label || '').trim() || '회차';
  const type = String(run.type || '').trim();
  const start = String(run.start_date || '').trim().slice(0, 10);
  const company = String(run.company_label || '').trim();
  const bits = company ? [company, period] : [period];
  if (type) bits.push(type);
  bits.push(run.status);
  if (start) bits.push(start);
  if (managedCount != null) bits.push(`관리대상 ${managedCount}건`);
  return bits.join(' · ');
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

/**
 * Print / 결재 미리보기 이행 확인 섹션.
 * - assessment: 금주 = 전회차 사진, 전회차 = 그 이전 회차 사진
 * - feedback: 결재 대상 회차 사진을 금주로, 그 이전을 전회차로
 */
export function resolvePrintFeedbackSections(opts: {
  current: WeeklyLinkRun;
  previous: WeeklyLinkRun | null;
  previousOfPrevious?: WeeklyLinkRun | null;
  mode?: 'assessment' | 'feedback';
}): { geumju: WeeklyLinkRun | null; jeonhoe: WeeklyLinkRun | null } {
  if (opts.mode === 'feedback') {
    return { geumju: opts.current, jeonhoe: opts.previous };
  }
  if (opts.previous) {
    return { geumju: opts.previous, jeonhoe: opts.previousOfPrevious || null };
  }
  if (opts.current.status === '승인완료') {
    return { geumju: opts.current, jeonhoe: null };
  }
  return { geumju: null, jeonhoe: null };
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
  'id, project_id, type, status, start_date, end_date, created_at, target_company_ids, author_user_id, created_by, period_label, is_deleted';

export type AssessmentFeedbackChain = {
  previousRunId: string | null;
  previousOfPreviousRunId: string | null;
  autoPreviousRunId: string | null;
};

/** One row from assessment_feedback_chain. Empty or malformed input is a failed lookup. */
export function parseAssessmentFeedbackChain(data: unknown): AssessmentFeedbackChain | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const rec = row as Record<string, unknown>;
  const id = (key: string) => {
    const value = String(rec[key] ?? '').trim();
    return value || null;
  };
  return {
    previousRunId: id('previous_run_id'),
    previousOfPreviousRunId: id('previous_of_previous_run_id'),
    autoPreviousRunId: id('auto_previous_run_id'),
  };
}

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
