import { SIREN_MAX_ACCURACY_M } from "./siteTrackBounds";

export const SIREN_ENTRY_STREAK_NEEDED = 2;
export const SIREN_EXIT_STREAK_NEEDED = 3;

export type ServerZoneJudgment = "inside" | "outside" | "unknown";

/** Server track-location payload → restricted-zone truth (S-01). */
export function serverConfirmsRestricted(data: {
  ignored?: string | null;
  zone_type?: string | null;
  event_type?: string | null;
  restricted_zone_id?: string | null;
}): ServerZoneJudgment {
  if (data.ignored) return "unknown";
  const t = String(data.event_type || "");
  if (/^(exit|leave|depart)/i.test(t) || /_exit$/i.test(t)) return "outside";
  if (data.restricted_zone_id) return "inside";
  if (data.zone_type === "danger" || data.zone_type === "restricted") return "inside";
  if (/unauthorized/i.test(t)) return "inside";
  return "outside";
}

export function isGpsAccurateEnoughForSiren(accuracyM?: number): boolean {
  const acc = Number.isFinite(accuracyM) ? Number(accuracyM) : 999;
  return acc <= SIREN_MAX_ACCURACY_M;
}

/**
 * Entry/exit hysteresis for one GPS sample.
 * Caller must feed preview OR fix samples, never both for the same physical ping (F-04).
 */
export function nextSirenHysteresis(args: {
  inside: boolean;
  accurate: boolean;
  entryStreak: number;
  exitStreak: number;
}): { entryStreak: number; exitStreak: number; open: boolean; close: boolean } {
  if (!args.accurate) {
    return {
      entryStreak: args.entryStreak,
      exitStreak: args.exitStreak,
      open: false,
      close: false,
    };
  }
  if (args.inside) {
    const entryStreak = args.entryStreak + 1;
    return {
      entryStreak,
      exitStreak: 0,
      open: entryStreak >= SIREN_ENTRY_STREAK_NEEDED,
      close: false,
    };
  }
  const exitStreak = args.exitStreak + 1;
  return {
    entryStreak: 0,
    exitStreak,
    open: false,
    close: exitStreak >= SIREN_EXIT_STREAK_NEEDED,
  };
}
