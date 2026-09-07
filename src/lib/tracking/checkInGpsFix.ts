/**
 * Clock-in must use device raw WGS84, not map-calibrated preview coords.
 * Tracker lastGpsFix.lat/lng can be shifted for the site map; the fence is WGS84.
 */
export type CheckInGpsFix = {
  lat: number;
  lng: number;
  accuracy: number;
  at?: number;
};

export type TrackerFixLike = {
  lat: number;
  lng: number;
  accuracy: number;
  at?: number;
  raw_lat?: number | null;
  raw_lng?: number | null;
};

export function rawCheckInFix(fix: TrackerFixLike | null | undefined): CheckInGpsFix | null {
  if (!fix) return null;
  const lat = Number(fix.raw_lat ?? fix.lat);
  const lng = Number(fix.raw_lng ?? fix.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const accuracy = Number(fix.accuracy);
  return {
    lat,
    lng,
    accuracy: Number.isFinite(accuracy) ? accuracy : 0,
    at: fix.at,
  };
}

/** Prefer the more accurate sample; tie-break to the newer one. */
export function pickCheckInGpsFix(
  a: CheckInGpsFix | null | undefined,
  b: CheckInGpsFix | null | undefined,
): CheckInGpsFix | null {
  if (!a) return b ?? null;
  if (!b) return a;
  if (a.accuracy !== b.accuracy) return a.accuracy < b.accuracy ? a : b;
  return (b.at ?? 0) >= (a.at ?? 0) ? b : a;
}

export function readFreshCheckInFix(timeoutMs = 12_000): Promise<CheckInGpsFix | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: Date.now(),
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
  });
}
