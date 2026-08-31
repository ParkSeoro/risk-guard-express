/**
 * Work-stop (작업중지권) SSOT — identity, insert payload, notify copy, home layout.
 * Legal basis: 산업안전보건법 제52조 (근로자의 작업중지 · 불리한 처우 금지).
 */

export const ANONYMOUS_REPORTER_LABEL = "익명 근로자";
export const WORK_STOP_LEGAL_CITE = "산업안전보건법 제52조";
export const WORK_STOP_OPEN_STATUSES = ["접수", "확인중"] as const;

export type WorkStopIdentityMode = "anonymous" | "named";

export type WorkStopIdentityRow = {
  is_anonymous?: boolean | null;
  reporter_name?: string | null;
};

/** Admin / list / push display name. Never returns a stored legal name when anonymous. */
export function workStopDisplayName(row: WorkStopIdentityRow): string {
  if (row.is_anonymous) return ANONYMOUS_REPORTER_LABEL;
  const name = (row.reporter_name || "").trim();
  return name || "근로자";
}

export function workStopNotifyMessage(row: WorkStopIdentityRow & {
  location?: string | null;
  hazard_description?: string | null;
}): string {
  const who = workStopDisplayName(row);
  const loc = (row.location || "").trim();
  const hazard = (row.hazard_description || "").trim() || "위험상황";
  return loc ? `${who} · ${loc} — ${hazard}` : `${who} — ${hazard}`;
}

export function validateWorkStopForm(opts: {
  projectId?: string | null;
  isAnonymous: boolean;
  reporterName: string;
  hazardDescription: string;
}): string | null {
  if (!opts.projectId) return "프로젝트 선택이 필요합니다";
  if (!opts.hazardDescription.trim()) return "위험상황은 필수입니다";
  if (!opts.isAnonymous && !opts.reporterName.trim()) {
    return "실명 신고 시 보고자명이 필요합니다";
  }
  return null;
}

/** Persist placeholder name when anonymous so select(*) UIs cannot leak identity. */
export function buildWorkStopInsert(opts: {
  projectId: string;
  workerId?: string | null;
  reporterUserId?: string | null;
  reporterName: string;
  location?: string | null;
  hazardDescription: string;
  isAnonymous: boolean;
}): {
  project_id: string;
  worker_id: string | null;
  reporter_user_id: string | null;
  is_anonymous: boolean;
  reporter_name: string;
  location: string | null;
  hazard_description: string;
  status: "접수";
} {
  return {
    project_id: opts.projectId,
    worker_id: opts.workerId || null,
    reporter_user_id: opts.reporterUserId || null,
    is_anonymous: opts.isAnonymous,
    reporter_name: opts.isAnonymous
      ? ANONYMOUS_REPORTER_LABEL
      : opts.reporterName.trim(),
    location: (opts.location || "").trim() || null,
    hazard_description: opts.hazardDescription.trim(),
    status: "접수",
  };
}

/** GPS diagnostics stay off the worker home after clock-in (tracking continues in background). */
export function shouldShowHomeGpsCard(isCheckedIn: boolean): boolean {
  return !isCheckedIn;
}

/** Work-stop CTA is a legal emergency control — only after the worker is on site. */
export function shouldShowHomeWorkStopCard(isCheckedIn: boolean): boolean {
  return isCheckedIn;
}

export function isWorkStopOpenStatus(status: string | null | undefined): boolean {
  return WORK_STOP_OPEN_STATUSES.includes((status || "") as (typeof WORK_STOP_OPEN_STATUSES)[number]);
}

/** Recipients: same-company managers + project safety + 발주처 OWNER_* (no workers/viewers). */
export function isWorkStopNotifyRecipient(member: {
  role_new?: string | null;
  position_new?: string | null;
  company_id?: string | null;
  user_id?: string | null;
}, reporterCompanyId: string | null): boolean {
  if (!member.user_id) return false;
  const role = member.role_new || "";
  if (role === "worker" || role === "viewer") return false;
  const pos = member.position_new || "";
  if (reporterCompanyId && member.company_id === reporterCompanyId) return true;
  if (role === "project_admin" || role === "safety_manager" || role === "site_manager") return true;
  return (
    pos === "OWNER_HSE" ||
    pos === "OWNER_SM" ||
    pos === "OWNER_PM" ||
    pos === "OWNER_CM" ||
    pos === "SITE_MANAGER" ||
    pos === "HSE_MANAGER"
  );
}
