/** Pure helpers for storage archive purge policy (PR #684 §5.1). */

export type PurgeLimitInput = {
  consecutiveCanarySuccessNights: number;
  canaryMax?: number;
  normalMax?: number;
};

/** Canary 5 until 2 clean canary nights, then 15. */
export function resolvePurgeMaxFiles(input: PurgeLimitInput): number {
  const canary = Math.max(1, input.canaryMax ?? 5);
  const normal = Math.max(canary, input.normalMax ?? 15);
  if (input.consecutiveCanarySuccessNights >= 2) return normal;
  return canary;
}

export type CircuitKind = "fatal" | "transient" | "none";

const FATAL_MARKERS = [
  "invalid_grant",
  "gdrive_auth",
  "401",
  "403",
  "checksum_mismatch",
  "restore_probe_failed",
];

const TRANSIENT_MARKERS = ["500", "502", "503", "504", "timeout", "timed out", "quota_warn"];

export function classifyStorageCircuitError(message: string | null | undefined): CircuitKind {
  const msg = String(message || "").toLowerCase();
  if (!msg) return "none";
  if (FATAL_MARKERS.some((m) => msg.includes(m))) return "fatal";
  if (msg.includes("storagequotaexceeded") || /quota[^0-9]*9\d(\.\d+)?\s*%/.test(msg)) return "fatal";
  if (TRANSIENT_MARKERS.some((m) => msg.includes(m))) return "transient";
  if (/quota[^0-9]*8\d(\.\d+)?\s*%/.test(msg)) return "transient";
  return "none";
}

/** Restore probe is due when never verified or last verify older than 6 days. */
export function restoreProbeDue(lastVerifiedRestoreAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!lastVerifiedRestoreAt) return true;
  const ts = Date.parse(lastVerifiedRestoreAt);
  if (!Number.isFinite(ts)) return true;
  return nowMs - ts >= 6 * 86400_000;
}
