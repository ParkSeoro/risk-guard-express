/**
 * Mobile shell navigation helpers — never send users to bare `/m`
 * (legacy redirect lands on WorkerDailyHome, which tangles manager UX).
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { MOBILE_ADMIN_HOME, WORKER_HOME } from "@/components/AuthGuard";

const WORKER = "/app/worker";

/** Role-aware mobile home: both land on Today (content differs by project role). */
export function resolveMobileHomePath(_roles: string[]): string {
  return WORKER_HOME;
}

/** Hook: back / home button → correct mobile home. */
export function useNavigateMobileHome() {
  const navigate = useNavigate();
  const { roles } = useAuth();
  return useCallback(() => {
    navigate(resolveMobileHomePath(roles));
  }, [navigate, roles]);
}

/**
 * Map entity → best mobile path. Falls back to menu when no mobile page exists.
 * Desktop-only entities return `{ path, desktopFallback }` for optional labeling.
 */
export function mobileEntityPath(
  entityType: string,
  entityId?: string | null,
): { path: string; desktopOnly?: boolean; desktopPath?: string } {
  const id = entityId || "";
  switch (entityType) {
    case "assessment_run":
      return { path: id ? `${WORKER}/risk-assessment/${id}` : `${WORKER}/risk-assessment` };
    case "work_plan":
      return { path: id ? `${WORKER}/work-plans/${id}` : `${WORKER}/work-plans` };
    case "work_permit":
      // Approvals inbox is the action surface; permits route is document viewer only.
      return {
        path: id ? `${WORKER}/approvals` : `${WORKER}/permits`,
        desktopOnly: !!id,
        desktopPath: id ? `/app/admin/work-permits/${id}` : "/app/admin/work-permits",
      };
    case "approval":
      return { path: id ? `${WORKER}/approvals/${id}` : `${WORKER}/approvals` };
    case "safety_inspection":
      return { path: `${WORKER}/inspect` };
    case "incident":
    case "incident_report":
      return { path: `${WORKER}/incident` };
    case "tbm":
      return { path: `${WORKER}/tbm` };
    case "work_stop":
      return { path: `${WORKER}/work-stop` };
    case "todo":
    case "safety_cost":
    case "safety_cost_report":
    case "education":
    case "chemical":
    case "zone_event":
    case "emergency_drill":
    case "worker":
      return {
        path: MOBILE_ADMIN_HOME,
        desktopOnly: true,
        desktopPath: `/app/admin`,
      };
    default:
      return { path: `${WORKER}/alerts` };
  }
}
