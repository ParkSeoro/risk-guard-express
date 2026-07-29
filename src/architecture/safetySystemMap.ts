/**
 * Architecture map for role-split routing + safety work ERD.
 * See also: supabase/migrations/20260729030000_safety_work_bundle_fks.sql
 *           supabase/migrations/20260729140000_fix_fks_and_relations.sql
 *
 * Routing (canonical):
 *   /app/worker/*  → WorkerAppRoutes (AuthGuard + global GPS + daily home)
 *   /app/admin/*   → AdminAppRoutes  (AuthGuard admin shell)
 * Legacy /m/* and /* redirect into the above (role-aware for /).
 *
 * ERD (core):
 *   assessment_runs 1──* work_permit_assessment_links *──1 work_permits
 *   assessment_runs 1──* tbm_sessions
 *   work_plans      1──* work_permits / tbm_sessions
 *   work_permits    *──1 tbm_sessions (optional)
 *   workers         1──* tbm_participations / worker_entry_logs / work_permit_workers
 *   View: v_safety_work_bundle (permit ⨝ primary RA ⨝ TBM ⨝ plan)
 *
 * Daily worker pipeline:
 *   GPS 100m check-in (entry_at) → TBM modal → no-accident check-out (exit_at)
 */
export const ARCH_ROUTE_BASES = {
  worker: "/app/worker",
  admin: "/app/admin",
} as const;
