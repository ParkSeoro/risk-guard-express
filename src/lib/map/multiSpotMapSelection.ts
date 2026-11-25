/**
 * Multi-spot drone map selection helpers shared across SiteControlMap,
 * WorkerDistribution, and MobileMapCalibration.
 *
 * Backward-compatibility rule:
 * - `site_spot_id == null` means a shared project-wide map.
 * - When a specific `spotId` is active, prefer a map linked to that `spotId`,
 *   otherwise fall back to a shared (`null`) map, otherwise the first available map.
 */

export type SpotLinkableMap = {
  id: string;
  site_spot_id?: string | null;
};

export type SpotSummary = {
  id: string;
  name: string;
};

export function pickMapForSpot<T extends SpotLinkableMap>(
  maps: T[],
  spotId: string | null | undefined,
): T | null {
  if (!maps.length) return null;
  if (spotId) {
    const exact = maps.find((m) => m.site_spot_id === spotId);
    if (exact) return exact;
  }
  const shared = maps.find((m) => !m.site_spot_id);
  return shared ?? maps[0] ?? null;
}

export function mapSpotBadgeLabel(
  siteSpotId: string | null | undefined,
  spots: SpotSummary[],
): string {
  if (!siteSpotId) return "공용 (전체)";
  const found = spots.find((s) => s.id === siteSpotId);
  return found ? found.name : "공용 (전체)";
}

export function countMapsForSpot(
  maps: SpotLinkableMap[],
  spotId: string,
): number {
  return maps.filter((m) => m.site_spot_id === spotId).length;
}
