/** Public manual role buckets — 7 app roles collapse to 3 reading views. */

export type ManualAudience = "worker" | "supervisor" | "admin";

export const MANUAL_AUDIENCE_STORAGE_KEY = "manual:audience";

export const MANUAL_AUDIENCE_OPTIONS: {
  id: ManualAudience;
  label: string;
  hint: string;
}[] = [
  { id: "worker", label: "근로자", hint: "출근·TBM·작업중지 · 용어 없이 하루 흐름" },
  { id: "supervisor", label: "관리감독자", hint: "위험성평가 작성 · 허가서 · TBM · 의견 수렴" },
  { id: "admin", label: "안전관리자·관리자", hint: "결재·점검·비용·관제 등 현장 운영" },
];

export function isManualAudience(value: unknown): value is ManualAudience {
  return value === "worker" || value === "supervisor" || value === "admin";
}

export function readStoredManualAudience(): ManualAudience | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MANUAL_AUDIENCE_STORAGE_KEY);
    return isManualAudience(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredManualAudience(audience: ManualAudience): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MANUAL_AUDIENCE_STORAGE_KEY, audience);
  } catch {
    /* private mode */
  }
}

export function clearStoredManualAudience(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(MANUAL_AUDIENCE_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * Map live roles to a manual bucket.
 * site_supervisor = 관리감독자. supervisor(감리) is an admin reader, not the RA author.
 */
export function manualAudienceFromRoles(roles: readonly string[] | null | undefined): ManualAudience | null {
  const set = new Set(roles || []);
  if (set.size === 0) return null;

  const isAdmin =
    set.has("master") ||
    set.has("project_admin") ||
    set.has("safety_manager") ||
    set.has("site_manager") ||
    set.has("supervisor") ||
    set.has("admin") ||
    set.has("owner") ||
    set.has("pm") ||
    set.has("cm") ||
    set.has("sm") ||
    set.has("manager") ||
    set.has("hq") ||
    set.has("partner_manager");

  if (isAdmin) return "admin";
  if (set.has("site_supervisor")) return "supervisor";
  if (
    set.has("worker") ||
    set.has("contractor") ||
    set.has("partner_worker") ||
    set.has("viewer") ||
    set.has("user")
  ) {
    return "worker";
  }
  return null;
}

export function resolveManualAudience(
  stored: ManualAudience | null,
  roles: readonly string[] | null | undefined,
): ManualAudience | null {
  if (stored) return stored;
  return manualAudienceFromRoles(roles);
}

export function audienceIncludes(
  audience: ManualAudience,
  allowed: readonly ManualAudience[],
): boolean {
  return allowed.includes(audience);
}
