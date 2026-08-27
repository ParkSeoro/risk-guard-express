/** Classify special post-approval work-permit steps for UI labels. */
export type PermitPostStepKind =
  | 'closure_supervisor'
  | 'closure_sm'
  | 'extend_cm'
  | 'extend_sm'
  | 'normal';

export function permitPostStepKind(position?: string | null): PermitPostStepKind {
  const p = (position || '').toLowerCase();
  if (p === 'closure_supervisor') return 'closure_supervisor';
  if (p === 'closure_sm') return 'closure_sm';
  if (p === 'extend_cm') return 'extend_cm';
  if (p === 'extend_sm') return 'extend_sm';
  return 'normal';
}

/** Resolve step position key from approval row shape (approvals.position / RPC step_position). */
export function approvalStepPosition(
  step?: { position?: string | null; step_position?: string | null } | string | null,
): string {
  if (step == null) return '';
  if (typeof step === 'string') return step;
  return step.position || step.step_position || '';
}

export function isPostApprovalStep(
  positionOrStep?: string | null | { position?: string | null; step_position?: string | null },
): boolean {
  return permitPostStepKind(approvalStepPosition(positionOrStep)) !== 'normal';
}

export function permitPostStepBadge(kind: PermitPostStepKind): string | null {
  if (kind === 'closure_supervisor') return '관리감독자 완료 확인';
  if (kind === 'closure_sm') return '발주처 SM 종료 승인';
  if (kind === 'extend_cm') return '발주처 CM 연장 검토';
  if (kind === 'extend_sm') return '작업허가 연장 승인';
  return null;
}

export function permitPostStepApproveLabel(kind: PermitPostStepKind): string {
  if (kind === 'closure_supervisor') return '완료 확인';
  if (kind === 'closure_sm') return '작업 완료 및 종료';
  if (kind === 'extend_cm') return '연장 검토';
  if (kind === 'extend_sm') return '연장 승인';
  return '승인';
}

/**
 * Supervisor already approved completion, but SM row is still 대기 (not 진행중).
 * Inbox RPCs only return 진행중, so SM never sees these until repair.
 */
export function isStuckClosureSmInbox(
  rows: Array<{ position?: string | null; status?: string | null }>,
): boolean {
  const pos = (r: { position?: string | null }) => (r.position || '').toLowerCase();
  const supApproved = rows.some(
    (r) => pos(r) === 'closure_supervisor' && (r.status === '승인' || (r.status || '').toLowerCase() === 'approved'),
  );
  const smWaiting = rows.some((r) => pos(r) === 'closure_sm' && r.status === '대기');
  const smActive = rows.some((r) => pos(r) === 'closure_sm' && r.status === '진행중');
  return supApproved && smWaiting && !smActive;
}

export type ApprovalTimelineStep = {
  id?: string;
  step_order?: number | null;
  status?: string | null;
  position?: string | null;
  approval_version?: number | null;
  step?: string | null;
  approver_name?: string | null;
  company_name?: string | null;
  comment?: string | null;
  entity_type?: string | null;
  [key: string]: unknown;
};

export type SplitApprovalTimeline = {
  /** Latest issuance version steps (취소 제외) */
  issuanceSteps: ApprovalTimelineStep[];
  /** Latest post-approval version steps (완료/연장, 취소 제외) */
  postSteps: ApprovalTimelineStep[];
  /** Older issuance versions (취소 제외) — 「이전 상신」 */
  priorIssuanceSteps: ApprovalTimelineStep[];
  maxIssuanceVersion: number;
  maxPostVersion: number;
};

function sortByOrder<T extends { step_order?: number | null; approval_version?: number | null }>(
  steps: T[],
): T[] {
  return [...steps].sort((a, b) => {
    const av = a.approval_version ?? 1;
    const bv = b.approval_version ?? 1;
    if (av !== bv) return av - bv;
    return (a.step_order ?? 99) - (b.step_order ?? 99);
  });
}

/**
 * Split a document's approval rows into issuance vs post-approval (closure/extend).
 * Hides 취소 by default. Used so reject→resubmit comments never sit on the closure row.
 */
export function splitApprovalTimeline(
  steps: ApprovalTimelineStep[],
  opts?: { includeCancelled?: boolean },
): SplitApprovalTimeline {
  const includeCancelled = !!opts?.includeCancelled;
  const visible = (steps || []).filter((s) => includeCancelled || s.status !== '취소');

  const postAll = visible.filter((s) => isPostApprovalStep(s));
  const issuanceAll = visible.filter((s) => !isPostApprovalStep(s));

  const maxIssuanceVersion = issuanceAll.reduce(
    (m, s) => Math.max(m, s.approval_version || 1),
    0,
  );
  const maxPostVersion = postAll.reduce(
    (m, s) => Math.max(m, s.approval_version || 1),
    0,
  );

  const issuanceSteps = sortByOrder(
    issuanceAll.filter((s) => (s.approval_version || 1) === maxIssuanceVersion),
  );
  const priorIssuanceSteps = sortByOrder(
    issuanceAll.filter((s) => (s.approval_version || 1) < maxIssuanceVersion),
  );
  const postSteps = sortByOrder(
    postAll.filter((s) => (s.approval_version || 1) === maxPostVersion),
  );

  return {
    issuanceSteps,
    postSteps,
    priorIssuanceSteps,
    maxIssuanceVersion,
    maxPostVersion,
  };
}

/** Flat display list for a card: current issuance + current post (no prior, no 취소). */
export function currentTimelineSteps(steps: ApprovalTimelineStep[]): ApprovalTimelineStep[] {
  const { issuanceSteps, postSteps } = splitApprovalTimeline(steps);
  return [...issuanceSteps, ...postSteps];
}
