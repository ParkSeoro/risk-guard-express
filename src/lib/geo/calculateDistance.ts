/**
 * Haversine distance in meters between two WGS84 points.
 * Earth radius = 6,371,000 m (same as track-location / restrictedZoneGeom).
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** True when current fix is within radiusM of site office coordinates. */
export function isWithinSiteRadius(
  siteLat: number,
  siteLng: number,
  lat: number,
  lng: number,
  radiusM = 100,
): boolean {
  if (![siteLat, siteLng, lat, lng].every((n) => Number.isFinite(n))) return false;
  return calculateDistance(siteLat, siteLng, lat, lng) <= radiusM;
}
