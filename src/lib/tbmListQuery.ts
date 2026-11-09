/**
 * TBM lists must wait until company scope is ready.
 *
 * Mobile access starts as role "viewer" with companyId null and an empty
 * allowlist. That filter matches a nil company, so the first query is empty.
 * The default role is already a manager shell, so the manager flag does not
 * change when the real role arrives and a date-only effect does not run again.
 * Opening yesterday and coming back to today was the refetch that showed the log.
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
