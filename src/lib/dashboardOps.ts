/** Pure helpers for the ops-oriented admin dashboard. */

export type AttentionSeverity = 'critical' | 'warning' | 'info';

export type AttentionItem = {
  id: string;
  label: string;
  count: number;
  severity: AttentionSeverity;
  path: string;
  detail?: string;
};

export type SitePulse = {
  onSiteWorkers: number;
  todayEntries: number;
  todayTbm: number;
  activePermits: number;
  draftPermits: number;
  approvalPendingPermits: number;
  workPlans: number;
  zoneAlerts: number;
};

const PERMIT_DRAFT = new Set(['작성중', '임시저장']);
const PERMIT_APPROVAL = new Set(['결재중', '결재진행', '검토대기', '검토완료', '대기']);
const PERMIT_ACTIVE = new Set([
  '승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED', '작업중',
]);
const PERMIT_CLOSURE = new Set(['종료대기', 'CLOSURE_PENDING']);

export function todayKstDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

export function summarizePermits(permits: Array<{ status?: string | null }>) {
  let draft = 0;
  let inApproval = 0;
  let active = 0;
  let closurePending = 0;
  let rejected = 0;
  for (const p of permits) {
    const s = p.status || '';
    if (PERMIT_DRAFT.has(s)) draft++;
    else if (PERMIT_APPROVAL.has(s)) inApproval++;
    else if (PERMIT_ACTIVE.has(s)) active++;
    else if (PERMIT_CLOSURE.has(s)) closurePending++;
    else if (s === '반려') rejected++;
  }
  return { draft, inApproval, active, closurePending, rejected, total: permits.length };
}

export function buildAttentionItems(input: {
  myPendingApprovals: number;
  permitDraft: number;
  permitInApproval: number;
  permitClosurePending: number;
  permitRejected: number;
  todoOpenDaily: number;
  zoneAlerts: number;
  safetyCostViolations: number;
  raFeedbackUnresolved: number;
  residualHigh: number;
  showSafetyCost: boolean;
  showZone: boolean;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.myPendingApprovals > 0) {
    items.push({
      id: 'approvals',
      label: '내 결재 대기',
      count: input.myPendingApprovals,
      severity: 'critical',
      path: '/approvals',
      detail: '승인·반려가 필요한 문서',
    });
  }
  if (input.permitClosurePending > 0) {
    items.push({
      id: 'permit-closure',
      label: '허가서 종료 확인 대기',
      count: input.permitClosurePending,
      severity: 'critical',
      path: '/work-permits',
      detail: '작업 완료 확인이 필요합니다',
    });
  }
  if (input.permitInApproval > 0) {
    items.push({
      id: 'permit-approval',
      label: '허가서 결재 진행',
      count: input.permitInApproval,
      severity: 'warning',
      path: '/work-permits',
    });
  }
  if (input.permitDraft > 0) {
    items.push({
      id: 'permit-draft',
      label: '허가서 작성중',
      count: input.permitDraft,
      severity: 'info',
      path: '/work-permits',
    });
  }
  if (input.permitRejected > 0) {
    items.push({
      id: 'permit-rejected',
      label: '허가서 반려',
      count: input.permitRejected,
      severity: 'warning',
      path: '/work-permits',
      detail: '보완 후 재상신',
    });
  }
  if (input.todoOpenDaily > 0) {
    items.push({
      id: 'todo-daily',
      label: '일간 법적업무 미완료',
      count: input.todoOpenDaily,
      severity: 'warning',
      path: '/todo',
    });
  }
  if (input.showZone && input.zoneAlerts > 0) {
    items.push({
      id: 'zone',
      label: '구역 경보 미확인',
      count: input.zoneAlerts,
      severity: 'critical',
      path: '/zone-events',
    });
  }
  if (input.showSafetyCost && input.safetyCostViolations > 0) {
    items.push({
      id: 'safety-cost',
      label: '산안비 검증 위반',
      count: input.safetyCostViolations,
      severity: 'warning',
      path: '/safety-cost?tab=validation',
    });
  }
  if (input.raFeedbackUnresolved > 0) {
    items.push({
      id: 'ra-feedback',
      label: '위험성평가 미조치 피드백',
      count: input.raFeedbackUnresolved,
      severity: 'warning',
      path: '/risk-assessment',
    });
  }
  if (input.residualHigh > 0) {
    items.push({
      id: 'ra-residual',
      label: "개선 후에도 '상' 잔존",
      count: input.residualHigh,
      severity: 'info',
      path: '/risk-assessment',
    });
  }

  const rank: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);
}

export function countOnSite(logs: Array<{ entry_at?: string | null; exit_at?: string | null }>) {
  const todayEntries = logs.length;
  const onSiteWorkers = logs.filter((l) => l.entry_at && !l.exit_at).length;
  return { todayEntries, onSiteWorkers };
}
