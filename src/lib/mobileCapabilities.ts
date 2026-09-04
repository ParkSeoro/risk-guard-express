/**
 * Project-scoped mobile capabilities (SSOT for shell UI).
 * AuthGuard still uses global role union for desktop vs phone shell entry;
 * Once inside /app/worker, use selected-project role from useMobileAccess.
 */
import type { MobileRole } from "@/hooks/useMobileAccess";
import { isManagerMobileRole, resolveMobileShellBucket } from "@/lib/mobileShell";

export type MobileCapability =
  | "approve"
  | "inspect"
  | "manage_workers"
  | "suspend_workers"
  | "view_team_actions"
  | "submit_work_stop"
  | "submit_health"
  | "check_in"
  | "view_distribution";

export function mobileCapabilities(
  role: MobileRole | string,
  isMaster?: boolean,
): Set<MobileCapability> {
  const bucket = resolveMobileShellBucket(role, isMaster);
  const caps = new Set<MobileCapability>(["submit_work_stop", "view_team_actions"]);

  if (bucket === "worker") {
    caps.add("submit_health");
    caps.add("check_in");
    return caps;
  }

  // manager + master
  caps.add("approve");
  caps.add("inspect");
  caps.add("manage_workers");
  caps.add("suspend_workers");
  caps.add("view_distribution");
  if (bucket === "master") {
    /* master gets manager set */
  }
  return caps;
}

export function canMobileApprove(role: MobileRole | string, isMaster?: boolean): boolean {
  return mobileCapabilities(role, isMaster).has("approve");
}

export function canMobileManageWorkers(role: MobileRole | string, isMaster?: boolean): boolean {
  return isManagerMobileRole(role, isMaster);
}
