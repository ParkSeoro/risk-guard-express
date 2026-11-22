/**
 * Access predicate for mobile & PC site map GPS georeferencing / calibration.
 * Uses an explicit client/GC company-type allowlist matching `public.can_calibrate_site_map`.
 */

const CALIBRATION_ROLES = new Set(["master", "project_admin", "safety_manager"]);
const ALLOWED_COMPANY_TYPES = new Set(["client", "owner", "gc", "발주처", "시공사", "원청"]);

export function canCalibrateSiteMap(opts: {
  isMaster?: boolean;
  role?: string | null;
  companyType?: string | null;
}): boolean {
  if (opts.isMaster) return true;
  const role = String(opts.role || "").trim().toLowerCase();
  if (!CALIBRATION_ROLES.has(role)) return false;
  const cType = String(opts.companyType || "").trim().toLowerCase();
  return ALLOWED_COMPANY_TYPES.has(cType);
}
