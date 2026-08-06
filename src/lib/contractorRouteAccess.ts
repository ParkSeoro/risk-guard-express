/**
 * Partner (협력사) admin-shell route allowlist.
 * Paths may be legacy (`/work-permits`) or role-split (`/app/admin/work-permits`).
 */
export const ADMIN_APP_BASE = "/app/admin";

/**
 * Logical prefixes (without /app/admin). "/" = admin home.
 * Keep aligned with AppSidebar CONTRACTOR_ALLOWED_URLS so menu links don't bounce.
 */
export const CONTRACTOR_ALLOWED_PREFIXES = [
  "/",
  "/work-plans",
  "/work-plan/",
  "/work-permits",
  "/risk-assessment",
  "/assessment-run/",
  "/approvals",
  "/tbm-logs",
  "/incidents",
  "/work-stop",
  "/workers",
  "/ai-assistant",
  "/verification-center",
  "/profile",
  "/settings/account",
  "/project-library",
  "/education-materials",
  "/worker-education",
  "/manual",
] as const;

/** Strip /app/admin so legacy allowlist rules still apply. */
export function normalizeAdminPathname(pathname: string): string {
  if (!pathname) return "/";
  if (pathname === ADMIN_APP_BASE || pathname === `${ADMIN_APP_BASE}/`) return "/";
  if (pathname.startsWith(`${ADMIN_APP_BASE}/`)) {
    return pathname.slice(ADMIN_APP_BASE.length) || "/";
  }
  return pathname;
}

export function isAllowedForContractor(pathname: string): boolean {
  const path = normalizeAdminPathname(pathname);
  if (path === "/") return true;
  return CONTRACTOR_ALLOWED_PREFIXES.some((p) => {
    if (p === "/") return false;
    return path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`);
  });
}
