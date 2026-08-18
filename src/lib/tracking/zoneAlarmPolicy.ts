/**
 * Mirrors supabase/functions/track-location matching.
 * Once a project has any restricted_zones row (통합 관제맵), leftover
 * site_zones danger/restricted polygons must not emit unauthorized_entry.
 */
export function shouldSkipLegacySiteDangerMatch(opts: {
  unifiedRestrictedZoneCount: number;
  siteZoneType: string | null | undefined;
}): boolean {
  if ((opts.unifiedRestrictedZoneCount || 0) <= 0) return false;
  const t = String(opts.siteZoneType || "");
  return t === "danger" || t === "restricted";
}

export function siteZoneEntryEventType(opts: {
  unifiedSsot: boolean;
  siteZoneType: string | null | undefined;
}): "unauthorized_entry" | "entry" {
  const legacyDanger = opts.siteZoneType === "danger" || opts.siteZoneType === "restricted";
  return legacyDanger && !opts.unifiedSsot ? "unauthorized_entry" : "entry";
}
