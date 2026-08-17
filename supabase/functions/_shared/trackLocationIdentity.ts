/** Pure helpers for track-location JWT ↔ body identity binding. */

export function digitsOnlyPhone(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
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
