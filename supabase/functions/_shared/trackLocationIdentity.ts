/** Pure helpers for track-location JWT ↔ body identity binding. */

export function digitsOnlyPhone(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
}

export const TRACK_LOCATION_MAX_ACCURACY_M = 100;
export const SITE_ZONE_MATCH_MAX_ACCURACY_M = 50;
export const ZONE_EVENT_LOOKBACK_MS = 12 * 60 * 60 * 1000;

/**
 * Discard a GPS ping before zone evaluation.
 * `force_restricted_check` must not bypass this — it only names a zone.
 */
export function shouldIgnoreLowAccuracyFix(accuracyM: number, wifiScanLength: number): boolean {
  return accuracyM > TRACK_LOCATION_MAX_ACCURACY_M && wifiScanLength === 0;
}

export function zoneEventLookbackSince(now = new Date()): Date {
  return new Date(now.getTime() - ZONE_EVENT_LOOKBACK_MS);
}

export type ZoneEventWorkerKey = { col: "worker_qr_id" | "worker_phone"; val: string };

/** Prefer roster id; never fall through to display-name matching. */
export function resolveZoneEventWorkerKey(args: {
  workerQrId?: string | null;
  workerPhone?: string | null;
  workerId?: string | null;
}): ZoneEventWorkerKey | null {
  const qr = String(args.workerQrId || args.workerId || "").trim();
  if (qr) return { col: "worker_qr_id", val: qr };
  const phone = String(args.workerPhone || "").trim();
  if (phone) return { col: "worker_phone", val: phone };
  return null;
}

/**
 * Returns true when the client claim disagrees with the JWT-resolved identity.
 * Empty claims are allowed (server fills from profile/roster).
 */
export function trackIdentityClaimMismatch(args: {
  profilePhoneDigits: string;
  resolvedWorkerId: string | null;
  resolvedWorkerPhoneDigits: string | null;
  claimedWorkerId?: string | null;
  claimedWorkerPhone?: string | null;
}): boolean {
  const claimedId = String(args.claimedWorkerId || "").trim();
  if (claimedId) {
    if (!args.resolvedWorkerId || claimedId !== args.resolvedWorkerId) return true;
  }

  const claimDigits = digitsOnlyPhone(args.claimedWorkerPhone);
  if (!claimDigits) return false;

  if (args.profilePhoneDigits && claimDigits !== args.profilePhoneDigits) return true;
  if (args.resolvedWorkerPhoneDigits && claimDigits !== args.resolvedWorkerPhoneDigits) {
    return true;
  }
  return false;
}
