/** Phase-explicit labels for the two RA approval pipes. */

export const RA_WRITE_PHASE_LABEL = "위평 작성";
export const RA_FEEDBACK_PHASE_LABEL = "이행 확인";

export function isFeedbackApprovalEntity(entityType?: string | null): boolean {
  return String(entityType || "").trim() === "assessment_run_feedback";
}

export function raApprovalEntityLabel(entityType?: string | null): string {
  return isFeedbackApprovalEntity(entityType)
    ? `위험성평가 · ${RA_FEEDBACK_PHASE_LABEL}`
    : `위험성평가 · ${RA_WRITE_PHASE_LABEL}`;
}

export function feedbackStatusBadge(status?: string | null): string | null {
  const s = String(status || "").trim();
  if (s === "pending_approval") return "조치 결재중";
  if (s === "closed" || s === "approved") return "조치 확인 완료";
  if (s === "in_progress") return "조치 작성중";
  if (s === "rejected") return "조치 반려";
  return null;
}

export function inboxPeriodTitle(opts: {
  entityType?: string | null;
  periodLabel?: string | null;
}): string {
  const period = String(opts.periodLabel || "").trim();
  const phase = isFeedbackApprovalEntity(opts.entityType)
    ? RA_FEEDBACK_PHASE_LABEL
    : RA_WRITE_PHASE_LABEL;
  return period ? `${period} · ${phase}` : `위험성평가 · ${phase}`;
}
