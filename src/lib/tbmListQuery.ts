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
