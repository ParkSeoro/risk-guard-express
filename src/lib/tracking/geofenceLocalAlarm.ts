import {
  isDefinitelyOutsideAllSites,
  isInsideAnyResumeFence,
  listTrackingFences,
  type SiteTrackingFence,
} from "./siteTrackBounds";
import {
  isWithinAnySiteAttendance,
  type SiteBoundary,
} from "./siteBoundary";
export { isGpsAccurateEnoughForSiren } from "./sirenHysteresis";

/**
 * Home / off-site GPS must not open the violator siren.
 * Restricted-zone geometry can be wrong or city-wide; the site fence is the
 * first gate. No fence configured → do not suppress (cannot prove off-site).
 */
export function shouldSuppressLocalSirenOffsite(opts: {
  fence?: SiteTrackingFence | null | undefined;
  fences?: SiteTrackingFence[] | null;
  outlines?: SiteBoundary[] | null;
  rawLat: number;
  rawLng: number;
  calLat?: number;
  calLng?: number;
  accuracyM?: number;
  /** Master off-site alarm test — siren vs dropped test zones must still fire. */
  allowOffsite?: boolean;
}): boolean {
  if (opts.allowOffsite) return false;
  const acc = Number.isFinite(opts.accuracyM) ? Number(opts.accuracyM) : 999;
  const testLat = opts.calLat ?? opts.rawLat;
  const testLng = opts.calLng ?? opts.rawLng;

  // 1. If polygon site outlines exist, check them first
  if (opts.outlines && opts.outlines.length > 0) {
    const insideWithCal = isWithinAnySiteAttendance(opts.outlines, testLat, testLng, acc);
    const insideWithRaw = isWithinAnySiteAttendance(opts.outlines, opts.rawLat, opts.rawLng, acc);
    if (insideWithCal || insideWithRaw) return false;
  }

  // 2. Check circular fences
  const fences = listTrackingFences({ siteFences: opts.fences, siteCenter: opts.fence });
  if (!fences.length) {
    // If no circular fence and either no outlines or inside outlines, do not suppress
    return opts.outlines && opts.outlines.length > 0;
  }

  const insideFenceCal = isInsideAnyResumeFence(fences, testLat, testLng, acc);
  const insideFenceRaw = isInsideAnyResumeFence(fences, opts.rawLat, opts.rawLng, acc);
  if (insideFenceCal || insideFenceRaw) return false;

  return isDefinitelyOutsideAllSites(fences, opts.rawLat, opts.rawLng, acc).outside;
}

