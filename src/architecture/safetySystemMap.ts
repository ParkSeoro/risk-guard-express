/**
 * Architecture map for role-split routing + safety work ERD.
 * See also: supabase/migrations/20260729030000_safety_work_bundle_fks.sql
 *
 * Routing (canonical):
 *   /app/worker/*  → WorkerAppRoutes (lazy mobile pages, no Leaflet)
 *   /app/admin/*   → AdminAppRoutes  (lazy admin pages incl. SiteControlMap)
 * Legacy /m/* and /* redirect into the above.
 *
 * ERD (core):
 *   assessment_runs 1──* work_permit_assessment_links *──1 work_permits
 *   assessment_runs 1──* tbm_sessions
 *   work_plans      1──* work_permits / tbm_sessions
 *   work_permits    *──1 tbm_sessions (optional)
 *   View: v_safety_work_bundle (permit ⨝ primary RA ⨝ TBM ⨝ plan)
 */
export const ARCH_ROUTE_BASES = {
  worker: "/app/worker",
  admin: "/app/admin",
} as const;
