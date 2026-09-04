/** How the site distribution map places a checked-in worker. */
export function distributionZoneId(opts: {
  lastFixAt?: string | Date | null;
  zoneId?: string | null;
  now?: Date;
  freshMs?: number;
}): string | null {
  const freshMs = opts.freshMs ?? 12 * 60 * 60 * 1000;
  const at = opts.lastFixAt
    ? opts.lastFixAt instanceof Date
      ? opts.lastFixAt.getTime()
      : Date.parse(String(opts.lastFixAt))
    : NaN;
  if (!Number.isFinite(at)) return null;
  const now = (opts.now ?? new Date()).getTime();
  if (now - at > freshMs) return null;
  return opts.zoneId || null;
}
