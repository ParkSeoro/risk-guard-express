/**
 * Access predicate for mobile & PC site map GPS georeferencing / calibration.
 * Must stay 1:1 with `public.can_calibrate_site_map(_uid, _project_id)` in Postgres.
 */

const CALIBRATION_ROLES = new Set(["master", "project_admin", "safety_manager"]);
const CONTRACTOR_COMPANY_TYPES = new Set(["contractor", "vendor", "협력사", "공급사"]);

export function canCalibrateSiteMap(opts: {
  isMaster?: boolean;
  role?: string | null;
  companyType?: string | null;
}): boolean {
  if (opts.isMaster) return true;
  const role = String(opts.role || "").trim().toLowerCase();
  if (!CALIBRATION_ROLES.has(role)) return false;
  const cType = String(opts.companyType || "").trim().toLowerCase();
  if (CONTRACTOR_COMPANY_TYPES.has(cType)) return false;
  return true;
}
