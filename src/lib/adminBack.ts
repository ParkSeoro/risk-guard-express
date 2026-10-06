import { ADMIN_APP_BASE, toAdminUrl } from "@/lib/adminNav";

/**
 * Admin route pattern → parent path inside the admin shell.
 * `null` means this screen is a root (dashboard) and has no back button.
 * A new `<Route path>` in AdminAppRoutes must be added here or the registry test fails.
 */
export const ADMIN_BACK_PARENTS: Record<string, string | null> = {
  index: null,
  projects: "/",
  "project/:projectId": "/projects",
  "risk-assessment": "/",
  "risk-assessment/:projectId": "/risk-assessment",
  "assessment-run/:runId": "/risk-assessment",
  "schedule-upload": "/",
  "schedule-upload/:projectId": "/schedule-upload",
  verification: "/",
  "verification-center": "/",
  "master-data": "/",
  "risk-library": "/",
  "admin/risk-library": "/",
  approvals: "/",
  "audit-logs": "/",
  "user-management": "/",
  "permission-test": "/",
  manual: "/",
  profile: "/",
  settings: "/",
  "settings/account": "/settings",
  "settings/permissions": "/settings",
  "settings/approval-routes": "/settings",
  "settings/notifications": "/settings",
  "settings/ai": "/settings",
  "settings/weather": "/settings",
  "settings/mobile-preview": "/settings",
  "settings/mobile-releases": "/settings",
  "settings/permit-forms": "/settings",
  "settings/work-plan-attachments": "/settings",
  "settings/companies": "/settings",
  "work-plans": "/",
  "work-plan/:planId": "/work-plans",
  "legal-duties": "/",
  todo: "/",
  todos: "/",
  "ai-assistant": "/",
  "site-weather": "/",
  "safety-cost": "/",
  "work-permits": "/",
  "work-permits/:id": "/work-permits",
  "tbm-logs": "/",
  "inspection-mode": "/",
  "safety-inspections": "/",
  incidents: "/",
  "emergency-drills": "/",
  "worker-education": "/",
  "safety-appointments": "/",
  alerts: "/",
  "work-stop": "/",
  "contractor-scorecard": "/",
  "assessment-notices": "/",
  announcements: "/",
  "vision-fleet": "/",
  "safety-cost-validation": "/",
  "site-readiness": "/",
  "education-materials": "/",
  "project-library": "/",
  workers: "/",
  "workers/legal-mapping": "/workers",
  "workers/:id": "/workers",
  "worker-attendance": "/",
  "admin/ai-test": "/",
  "admin/ai-logs": "/",
  "admin/system-test": "/",
  "admin/consistency-audit": "/",
  "admin/data-audit": "/",
  "admin/trash": "/",
  health: "/",
  "health/checkups": "/health",
  "health/chemicals": "/health",
  "health/measurements": "/health",
  "health/education": "/health",
  "health/hazard-surveys": "/health",
  "site-control-map": "/",
  "site-maps": "/",
  "restricted-zones": "/",
  "georef-map": "/",
  "zone-events": "/",
  "worker-distribution": "/",
  "admin/tracking-health": "/",
  companies: "/",
  "companies/:id": "/companies",
  "*": "/",
};

function patternToRegExp(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${body}$`);
}

/** Registered parent URL, or null on the dashboard and outside the admin shell. */
export function adminBackTarget(pathname: string): string | null {
  const path = (pathname || "").split("?")[0].replace(/\/+$/, "") || "/";
  if (path !== ADMIN_APP_BASE && !path.startsWith(`${ADMIN_APP_BASE}/`)) return null;
  const rel = path === ADMIN_APP_BASE ? "" : path.slice(ADMIN_APP_BASE.length + 1);
  if (!rel) return null;

  let best: { len: number; parent: string | null } | null = null;
  for (const [pattern, parent] of Object.entries(ADMIN_BACK_PARENTS)) {
    if (pattern === "index") continue;
    if (!patternToRegExp(pattern).test(rel)) continue;
    if (!best || pattern.length > best.len) best = { len: pattern.length, parent };
  }
  if (!best || best.parent == null) return null;
  return toAdminUrl(best.parent);
}
