/** 발행 허가서 작업취소 요청. 즉시 취소(project_admin·마스터)와 별도다. */

import { isWorkDocVoided } from "@/lib/workDocVoid";

export const ISSUED_PERMIT_STATUSES = new Set([
  "승인",
  "승인완료",
  "발행완료",
  "approved",
  "ISSUED",
  "APPROVED",
]);

const CLIENT_COMPANY_TYPES = new Set(["client", "발주처", "owner"]);

export type VoidRequestDecision = "void" | "keep_issued" | "other";

/** Server action from act_on_entity_approval. void_rejected must not flip an issued permit to 반려. */
export function voidRequestDecisionEffect(action?: string | null): VoidRequestDecision {
  if (action === "voided") return "void";
  if (action === "void_rejected") return "keep_issued";
  return "other";
}

export function canRequestWorkPermitVoid(opts: {
  userId?: string | null;
  userRole?: string | null;
  isMaster?: boolean;
  userCompanyId?: string | null;
  userCompanyType?: string | null;
  status?: string | null;
  voidedAt?: string | null;
  createdBy?: string | null;
  permitCompanyId?: string | null;
  parentCompanyId?: string | null;
  pending?: boolean;
}): boolean {
  if (!opts.userId || opts.pending) return false;
  if (opts.isMaster === true || opts.userRole === "master" || opts.userRole === "project_admin") {
    return false;
  }
  if (isWorkDocVoided({ status: opts.status, voided_at: opts.voidedAt })) return false;
  if (!ISSUED_PERMIT_STATUSES.has(opts.status || "")) return false;
  if (opts.createdBy && opts.createdBy === opts.userId) return true;

  const role = opts.userRole || "";
  if (role !== "site_manager" && role !== "safety_manager") return false;
  if (CLIENT_COMPANY_TYPES.has((opts.userCompanyType || "").toLowerCase())) return false;
  if (!opts.userCompanyId) return false;
  if (opts.userCompanyId === opts.permitCompanyId) return true;
  return !!opts.parentCompanyId && opts.userCompanyId === opts.parentCompanyId;
}

export function voidRequestErrorMessage(code: string): string {
  const c = String(code || "");
  if (c.includes("UNAUTHENTICATED")) return "로그인이 필요합니다.";
  if (c.includes("REASON_REQUIRED")) return "취소 사유를 입력하세요.";
  if (c.includes("NOT_FOUND")) return "허가서를 찾을 수 없습니다.";
  if (c.includes("ALREADY_VOIDED")) return "이미 취소된 허가서입니다.";
  if (c.includes("NOT_APPROVED")) return "발행된 허가서만 작업취소 요청을 할 수 있습니다.";
  if (c.includes("USE_DIRECT_VOID")) return "프로젝트 관리자는 작업 취소를 사용하세요.";
  if (c.includes("ALREADY_PENDING")) return "이미 작업취소 결재가 진행 중입니다.";
  if (c.includes("PENDING_POST_APPROVAL")) return "작업완료 또는 연장 결재가 진행 중입니다.";
  if (c.includes("NO_CLIENT_APPROVER")) return "승인할 발주처 SM/CM이 없습니다.";
  if (c.includes("FORBIDDEN")) return "작업취소 요청 권한이 없습니다.";
  return c || "작업취소 요청에 실패했습니다.";
}
