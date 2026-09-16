import {
  isDefinitelyOutsideAllSites,
  listTrackingFences,
  type SiteTrackingFence,
} from "./siteTrackBounds";
export { isGpsAccurateEnoughForSiren } from "./sirenHysteresis";

/**
 * Home / off-site GPS must not open the violator siren.
 * Restricted-zone geometry can be wrong or city-wide; the site fence is the
 * first gate. No fence configured → do not suppress (cannot prove off-site).
 */
export function shouldSuppressLocalSirenOffsite(opts: {
  fence?: SiteTrackingFence | null | undefined;
  fences?: SiteTrackingFence[] | null;
  rawLat: number;
  rawLng: number;
  accuracyM?: number;
  /** Master off-site alarm test — siren vs dropped test zones must still fire. */
  allowOffsite?: boolean;
}): boolean {
  if (opts.allowOffsite) return false;
  const fences = listTrackingFences({ siteFences: opts.fences, siteCenter: opts.fence });
  if (!fences.length) return false;
  const acc = Number.isFinite(opts.accuracyM) ? Number(opts.accuracyM) : 999;
  return isDefinitelyOutsideAllSites(fences, opts.rawLat, opts.rawLng, acc).outside;
}

