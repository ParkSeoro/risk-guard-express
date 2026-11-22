/**
 * Zone event view / acknowledge (ack) policy mirror.
 *
 * Mirrors DB RLS helpers `can_view_zone_event` and `can_ack_zone_event` in
 * `supabase/migrations/20261122123500_worker_zone_events_rls_fix.sql` and
 * push recipient rules in `docs/zone-alarm-recipients.md`.
 */

export const ZONE_EVENT_PROJECT_ADMIN_POSITIONS = new Set(["OWNER_PM", "OWNER_CM"]);

export const ZONE_EVENT_VIEW_ROLES = new Set([
  "project_admin",
  "safety_manager",
  "site_manager",
  "supervisor",
  "site_supervisor",
]);

export const ZONE_EVENT_ACK_ROLES = new Set([
  "project_admin",
  "safety_manager",
  "site_manager",
  "site_supervisor",
]);

export const ZONE_EVENT_COMPANY_MANAGER_POSITIONS = new Set([
  "SITE_MANAGER",
  "HSE_MANAGER",
  "OWNER_HSE",
  "OWNER_SM",
  "SITE_SUPERVISOR",
  "SUPERVISOR",
]);

export type ZoneEventAccessSubject = {
  isMaster?: boolean;
  role?: string | null;
  position?: string | null;
  isClientSafetyViewer?: boolean;
  canReadCompanyData?: boolean;
  canAccessCompanyData?: boolean;
};

function normRole(role?: string | null): string {
  return String(role || "").trim().toLowerCase();
}

function normPosition(position?: string | null): string {
  return String(position || "").trim().toUpperCase();
}

function isProjectWideZoneAdmin(role: string, pos: string): boolean {
  if (role === "worker" || role === "viewer") return false;
  return role === "project_admin" || ZONE_EVENT_PROJECT_ADMIN_POSITIONS.has(pos);
}

/** Whether the caller can view a `worker_zone_events` row (mirrors `can_view_zone_event`). */
export function canViewZoneEventAccess(s: ZoneEventAccessSubject): boolean {
  if (s.isMaster) return true;
  const role = normRole(s.role);
  const pos = normPosition(s.position);

  if (isProjectWideZoneAdmin(role, pos)) return true;

  const isEligibleRole =
    Boolean(s.isClientSafetyViewer) ||
    (role !== "worker" &&
      role !== "viewer" &&
      (ZONE_EVENT_VIEW_ROLES.has(role) || ZONE_EVENT_COMPANY_MANAGER_POSITIONS.has(pos)));

  if (!isEligibleRole) return false;
  return Boolean(s.canReadCompanyData);
}

/** Whether the caller can acknowledge a `worker_zone_events` row (mirrors `can_ack_zone_event`). */
export function canAckZoneEventAccess(s: ZoneEventAccessSubject): boolean {
  if (s.isMaster) return true;
  const role = normRole(s.role);
  const pos = normPosition(s.position);

  if (role === "worker" || role === "viewer") return false;
  if (isProjectWideZoneAdmin(role, pos)) return true;

  const isEligibleAckManager =
    ZONE_EVENT_ACK_ROLES.has(role) || ZONE_EVENT_COMPANY_MANAGER_POSITIONS.has(pos);

  if (!isEligibleAckManager) return false;
  return Boolean(s.canAccessCompanyData);
}
