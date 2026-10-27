import { applyGpsCalibration, type GpsCalibration } from "./gpsCalibration";

export type CheckInGpsFix = {
  lat: number;
  lng: number;
  accuracy: number;
  at?: number;
  raw_lat?: number;
  raw_lng?: number;
  calibrated?: boolean;
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
  const rawLat = Number(fix.raw_lat ?? fix.lat);
  const rawLng = Number(fix.raw_lng ?? fix.lng);
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return null;
  const accuracy = Number(fix.accuracy);
  return {
    lat: rawLat,
    lng: rawLng,
    accuracy: Number.isFinite(accuracy) ? accuracy : 0,
    at: fix.at,
  };
}

/** Returns the calibrated fix (aligned with map boundaries and geofences). */
export function calibratedCheckInFix(
  fix: TrackerFixLike | null | undefined,
  cal?: GpsCalibration | null,
): CheckInGpsFix | null {
  if (!fix) return null;
  const rawLat = Number(fix.raw_lat ?? fix.lat);
  const rawLng = Number(fix.raw_lng ?? fix.lng);
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return null;

  // If fix.lat was already calibrated (differing from raw_lat) and no new cal is provided
  if (fix.raw_lat != null && fix.lat !== fix.raw_lat && !cal) {
    return {
      lat: fix.lat,
      lng: fix.lng,
      raw_lat: rawLat,
      raw_lng: rawLng,
      accuracy: Number.isFinite(fix.accuracy) ? fix.accuracy : 0,
      at: fix.at,
      calibrated: true,
    };
  }

  const aligned = applyGpsCalibration(rawLat, rawLng, cal);
  return {
    lat: aligned.lat,
    lng: aligned.lng,
    raw_lat: rawLat,
    raw_lng: rawLng,
    accuracy: Number.isFinite(fix.accuracy) ? fix.accuracy : 0,
    at: fix.at,
    calibrated: aligned.calibrated,
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

export function readFreshCheckInFix(
  timeoutMs = 12_000,
  cal?: GpsCalibration | null,
): Promise<CheckInGpsFix | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const rawLat = pos.coords.latitude;
        const rawLng = pos.coords.longitude;
        const aligned = applyGpsCalibration(rawLat, rawLng, cal);
        resolve({
          lat: aligned.lat,
          lng: aligned.lng,
          raw_lat: rawLat,
          raw_lng: rawLng,
          accuracy: pos.coords.accuracy,
          at: Date.now(),
          calibrated: aligned.calibrated,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
  });
}
