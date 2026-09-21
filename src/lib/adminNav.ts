/** Canonical admin shell prefix (role-split routing). */
export const ADMIN_APP_BASE = "/app/admin";

/** Public pages that must not be rewritten to /app/admin/... */
export const PUBLIC_ABSOLUTE_PATHS = [
  "/manual",
  "/privacy",
  "/landing",
  "/auth",
  "/login",
  "/register",
] as const;

export function isPublicAbsolutePath(url: string): boolean {
  const path = (url || "").split("?")[0];
  return PUBLIC_ABSOLUTE_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export function toAdminUrl(url: string): string {
  if (!url || url.startsWith("http")) return url;
  if (url === "/") return ADMIN_APP_BASE;
  if (url.startsWith(ADMIN_APP_BASE)) return url;
  if (isPublicAbsolutePath(url)) return url;
  return `${ADMIN_APP_BASE}${url.startsWith("/") ? url : `/${url}`}`;
}
