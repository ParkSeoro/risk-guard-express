/**
 * Desktop 전자결재 inbox — document preview helpers.
 * Overlay stays on /app/admin/approvals; full-page escape uses ?from=approvals.
 */
import { appendFromQuery } from "@/lib/approvalDocPreview";

export const ADMIN_APPROVALS_PATH = "/app/admin/approvals";

export type ApprovalPreviewTarget = {
  entityType: string;
  entityId: string;
  title?: string | null;
};

/** Same routes as Approvals ENTITY_LINK (admin desktop). */
export function desktopApprovalEntityPath(
  entityType?: string | null,
  entityId?: string | null,
): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "assessment_run":
      return `/assessment-run/${entityId}`;
    case "assessment_run_feedback":
      return `/assessment-run/${entityId}?tab=feedback`;
    case "work_plan":
      return `/work-plan/${entityId}`;
    case "work_permit":
      return `/work-permits/${entityId}`;
    case "safety_cost":
      return `/safety-cost`;
    case "incident":
      return `/incidents`;
    case "emergency_drill":
      return `/emergency-drills`;
    case "tbm":
      return `/app/admin/tbm-logs`;
    default:
      return null;
  }
}

/** Full-page open from inbox — returns to admin approvals via ?from=approvals. */
export function desktopApprovalEntityPathFromInbox(
  entityType?: string | null,
  entityId?: string | null,
): string | null {
  const path = desktopApprovalEntityPath(entityType, entityId);
  if (!path) return null;
  return appendFromQuery(path, "approvals");
}

export function resolveAdminApprovalsReturnPath(
  from: string | null | undefined,
): string | null {
  const raw = String(from || "").trim();
  if (!raw) return null;
  if (raw === "approvals") return ADMIN_APPROVALS_PATH;
  if (raw.startsWith("/app/admin/")) return raw;
  return null;
}

export function approvalsBackOr(
  defaultPath: string,
  from: string | null | undefined,
): string {
  return resolveAdminApprovalsReturnPath(from) || defaultPath;
}

export function canInlineApprovalPreview(entityType?: string | null): boolean {
  return (
    entityType === "assessment_run" ||
    entityType === "assessment_run_feedback" ||
    entityType === "work_plan" ||
    entityType === "work_permit"
  );
}
