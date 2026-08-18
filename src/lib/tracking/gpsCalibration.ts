/**
 * Project GPS bias calibration (master 1-point field align).
 * corrected = { lat: raw.lat + d_lat, lng: raw.lng + d_lng }
 */
export type GpsCalibration = {
  d_lat: number;
  d_lng: number;
  accuracy_m: number;
  site_map_id: string;
  map_lat: number;
  map_lng: number;
  raw_lat: number;
  raw_lng: number;
  calibrated_at: string;
  calibrated_by?: string | null;
};

export const GPS_CAL_MAX_ACCURACY_M = 35;
/** Reject absurd taps / multipath (project-wide shift would be dangerous). */
export const GPS_CAL_MAX_OFFSET_M = 250;

export function parseGpsCalibration(raw: unknown): GpsCalibration | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const dLat = Number(o.d_lat);
  const dLng = Number(o.d_lng);
  if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) return null;
  if (dLat === 0 && dLng === 0) return null;
  return {
    d_lat: dLat,
    d_lng: dLng,
    accuracy_m: Number(o.accuracy_m) || 0,
    site_map_id: String(o.site_map_id || ""),
    map_lat: Number(o.map_lat) || 0,
    map_lng: Number(o.map_lng) || 0,
    raw_lat: Number(o.raw_lat) || 0,
    raw_lng: Number(o.raw_lng) || 0,
    calibrated_at: String(o.calibrated_at || ""),
    calibrated_by: (o.calibrated_by as string | null) ?? null,
  };
}

export function computeGpsOffset(
  mapPoint: { lat: number; lng: number },
  rawGps: { lat: number; lng: number },
): { d_lat: number; d_lng: number } {
  return {
    d_lat: mapPoint.lat - rawGps.lat,
    d_lng: mapPoint.lng - rawGps.lng,
  };
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

/** Approximate ground distance in meters between two WGS84 points. */
export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, s)));
}

export function offsetMagnitudeM(dLat: number, dLng: number, atLat: number): number {
  return haversineM({ lat: atLat, lng: 0 }, { lat: atLat + dLat, lng: dLng });
}

const cache = new Map<string, { at: number; cal: GpsCalibration | null }>();
const CACHE_TTL_MS = 60_000;

export const GPS_CAL_CACHE_TTL_MS = CACHE_TTL_MS;
export const GPS_CAL_CHANGED_EVENT = "gps_cal_changed";

export function gpsCalChannelName(projectId: string): string {
  return `gps-cal:${projectId}`;
}

export function clearGpsCalibrationCache(projectId?: string) {
  if (projectId) cache.delete(projectId);
  else cache.clear();
}

export async function fetchProjectGpsCalibration(
  projectId: string,
  fetcher: (id: string) => Promise<unknown>,
): Promise<GpsCalibration | null> {
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.cal;
  const raw = await fetcher(projectId);
  const cal = parseGpsCalibration(raw);
  cache.set(projectId, { at: Date.now(), cal });
  return cal;
}
