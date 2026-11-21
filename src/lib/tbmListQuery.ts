/**
 * TBM lists must wait until company scope is ready.
 *
 * Mobile access starts as role "viewer" with companyId null and an empty
 * allowlist. That filter matches a nil company, so a query before scope is
 * ready comes back empty. scopeStatus "pending" blocks that query. Viewer
 * stays on the worker shell, so a later manager role runs the effect again.
 */
export function tbmListQueryBlock(opts: {
  projectId?: string | null;
  /** Omit or pass ready when this screen has no company-scope hook. */
  scopeStatus?: "pending" | "ready" | null;
}): "no-project" | "scope-pending" | null {
  if (!opts.projectId) return "no-project";
  if (opts.scopeStatus === "pending") return "scope-pending";
  return null;
}

export const TBM_ALL_DATES_PAGE_SIZE = 50;

/**
 * PostgREST embedded `tbm_participations(count)` returns `[{ count: N }]` (or `{ count: N }`).
 * Extracts a safe non-negative integer without fetching raw participation rows.
 */
export function extractTbmParticipantCount(row: {
  tbm_participations?: Array<{ count?: number | null }> | { count?: number | null } | null;
}): number {
  const rel = row?.tbm_participations;
  if (!rel) return 0;
  const raw = Array.isArray(rel) ? rel[0]?.count : rel.count;
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
