/** Project GPS bias helpers for edge functions (keep in sync with src/lib/tracking/gpsCalibration.ts). */

export type GpsCalibration = {
  d_lat: number;
  d_lng: number;
};

export function parseGpsCalibration(raw: unknown): GpsCalibration | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const dLat = Number(o.d_lat);
  const dLng = Number(o.d_lng);
  if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) return null;
  if (dLat === 0 && dLng === 0) return null;
  return { d_lat: dLat, d_lng: dLng };
}

export function applyGpsCalibration(
  lat: number,
  lng: number,
  cal: GpsCalibration | null | undefined,
): { lat: number; lng: number; calibrated: boolean } {
  if (!cal || !Number.isFinite(cal.d_lat) || !Number.isFinite(cal.d_lng)) {
    return { lat, lng, calibrated: false };
  }
  if (cal.d_lat === 0 && cal.d_lng === 0) {
    return { lat, lng, calibrated: false };
  }
  return {
    lat: lat + cal.d_lat,
    lng: lng + cal.d_lng,
    calibrated: true,
  };
}
