export type PendingApprovalRow = {
  entity_type?: string | null;
  entity_date?: string | null;
  step?: string | null;
  company_name?: string | null;
  personnel_count?: number | null;
  resubmit_count?: number | null;
  approval_version?: number | null;
};

/** Inbox row title. Feedback RPC used to return '' → UI showed '-'. */
export function pendingInboxTitle(e: {
  entity_type?: string | null;
  entity_title?: string | null;
}): string {
  const title = String(e.entity_title || "").trim();
  if (title) return title;
  if (e.entity_type === "assessment_run_feedback") return "위험성평가 피드백";
  return "-";
}

/** Subtitle so two same-title permits (회사·인원·재상신) are distinguishable. */
export function formatPendingApprovalMeta(e: PendingApprovalRow): string {
  const parts: string[] = [];
  if (e.entity_date) parts.push(String(e.entity_date));
  if (e.step) parts.push(String(e.step));
  if (e.company_name) parts.push(String(e.company_name).trim());
  if (e.entity_type === "work_permit" && e.personnel_count != null && e.personnel_count !== undefined) {
    parts.push(`인원 ${Number(e.personnel_count)}명`);
  }
  const resubmits = Number(e.resubmit_count || 0);
  if (resubmits > 0) parts.push(`재상신 ${resubmits}회`);
  return parts.filter(Boolean).join(" · ");
}

export function mapApprovalActionError(raw: unknown): string {
  const code = String(raw || "");
  if (code.includes("SUBMITTER_STEP_NO_SELF_APPROVE")) {
    return "상신(기안) 단계는 승인/반려할 수 없습니다.";
  }
  if (code.includes("WORK_PERMIT_LOCKED")) {
    return "문서 잠금 충돌이 발생했습니다. 페이지를 새로고침 후 다시 시도하세요.";
  }
  if (code.includes("ACCOUNT_INACTIVE")) {
    return "로그인 차단된 계정은 결재할 수 없습니다.";
  }
  if (code.includes("ENTITY_DELETED")) {
    return "삭제된 문서는 결재할 수 없습니다.";
  }
  if (code.includes("WORK_PERMIT_APPROVAL_RPC_REQUIRED")) {
    return "허가서 승인은 결재선으로만 처리할 수 있습니다. 결재상신을 이용하세요.";
  }
  return code || "처리에 실패했습니다.";
}
