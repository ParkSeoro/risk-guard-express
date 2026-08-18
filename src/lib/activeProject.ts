/**
 * Active project SSOT (F-07).
 *
 * Canonical key: selectedProjectId (header, GPS, mobile).
 * Legacy key:    currentProjectId (older map/zone/QR screens).
 * Writes always mirror both so a map-page switch restarts GPS in the same tab.
 */

export const CANONICAL_PROJECT_KEY = "selectedProjectId";
export const LEGACY_PROJECT_KEY = "currentProjectId";
export const ACTIVE_PROJECT_CHANGED_EVENT = "mobile:project-changed";

function peek(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function poke(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* ignore quota / private mode */
  }
}

export function isActiveProjectStorageKey(key: string | null | undefined): boolean {
  return key === CANONICAL_PROJECT_KEY || key === LEGACY_PROJECT_KEY;
}

/** Prefer selectedProjectId; fall back to currentProjectId and copy it forward. */
export function readActiveProjectId(): string {
  const canonical = peek(CANONICAL_PROJECT_KEY);
  if (canonical) {
    if (peek(LEGACY_PROJECT_KEY) !== canonical) poke(LEGACY_PROJECT_KEY, canonical);
    return canonical;
  }
  const legacy = peek(LEGACY_PROJECT_KEY);
  if (legacy) {
    poke(CANONICAL_PROJECT_KEY, legacy);
    return legacy;
  }
  return "";
}

export function writeActiveProjectId(id: string): void {
  const next = String(id || "").trim();
  const prev = peek(CANONICAL_PROJECT_KEY) || peek(LEGACY_PROJECT_KEY);
  poke(CANONICAL_PROJECT_KEY, next);
  poke(LEGACY_PROJECT_KEY, next);
  if (prev === next) return;
  try {
    window.dispatchEvent(new Event(ACTIVE_PROJECT_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}
