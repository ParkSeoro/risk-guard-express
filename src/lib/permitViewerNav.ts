/**
 * Where 문서보기 should return after the permit viewer.
 * `from=approvals` or an absolute /app/worker/... path.
 */
export function resolvePermitViewerBackPath(from: string | null | undefined): string | null {
  const raw = String(from || "").trim();
  if (!raw) return null;
  if (raw === "approvals") return "/app/worker/approvals";
  if (raw.startsWith("/app/worker/")) return raw;
  return null;
}

export function permitViewerPath(permitId: string, from?: string | null): string {
  const q = new URLSearchParams({ id: permitId });
  if (from) q.set("from", from === "approvals" ? "approvals" : from);
  return `/app/worker/permits?${q.toString()}`;
}
