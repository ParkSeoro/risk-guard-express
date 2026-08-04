/** Session pause when worker leaves site tracking radius (>100m). */
const PREFIX = "safenex-gps-offsite-pause:";

export const SITE_TRACK_EXIT_M = 100;
/** Resume only when closer than this (hysteresis). */
export const SITE_TRACK_RESUME_M = 80;
/** Consecutive outside fixes before auto-stop (GPS jitter). */
export const SITE_EXIT_STREAK = 3;

export function offsitePauseKey(projectId: string) {
  return `${PREFIX}${projectId}`;
}

export function isGpsPausedOffsite(projectId: string | null | undefined): boolean {
  if (!projectId) return false;
  try {
    return sessionStorage.getItem(offsitePauseKey(projectId)) === "1";
  } catch {
    return false;
  }
}

export function setGpsPausedOffsite(projectId: string, paused: boolean) {
  try {
    if (paused) sessionStorage.setItem(offsitePauseKey(projectId), "1");
    else sessionStorage.removeItem(offsitePauseKey(projectId));
  } catch {
    /* ignore */
  }
}
