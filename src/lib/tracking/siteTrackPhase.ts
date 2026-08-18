import { SITE_EXIT_STREAK } from "./siteTrackBounds";

export type SiteTrackPhase = "tracking" | "suspended";

export function nextOutsideStreak(
  currentlyOutside: boolean,
  streak: number,
  needed = SITE_EXIT_STREAK,
): { streak: number; suspend: boolean } {
  if (!currentlyOutside) return { streak: 0, suspend: false };
  const next = streak + 1;
  return { streak: next, suspend: next >= needed };
}
