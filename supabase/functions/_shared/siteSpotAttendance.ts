/**
 * Attendance match for a GPS fix: inside a site spot/boundary, or within its
 * 100–300m buffer. Same rule as client isWithinSiteAttendance and the SQL
 * function point_within_attendance.
 */

export type AttendancePoint = { lat: number; lng: number };

export type AttendanceShape = {
  id?: string;
  name?: string | null;
  geometry_type?: string | null;
  geo_polygon?: AttendancePoint[] | null;
  center_lat?: number | null;
  center_lng?: number | null;
  radius_m?: number | null;
  buffer_m?: number | null;
};

const BUFFER_MIN_M = 100;
const BUFFER_MAX_M = 300;
const BUFFER_DEFAULT_M = 150;
const ACCURACY_PAD_CAP_M = 40;
/** Pin-only sites (no drawn 개소). Matches SITE_CHECKIN_PIN_M. */
export const PIN_ATTENDANCE_RADIUS_M = 350;

function clampBufferM(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return BUFFER_DEFAULT_M;
  return Math.min(BUFFER_MAX_M, Math.max(BUFFER_MIN_M, Math.round(n)));
}

function haversineM(a: AttendancePoint, b: AttendancePoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, s)));
}

function toLocalM(origin: AttendancePoint, p: AttendancePoint): { x: number; y: number } {
  const lat0 = (origin.lat * Math.PI) / 180;
  const mPerDegLat = 111_195;
  const mPerDegLng = 111_195 * Math.cos(lat0);
  return {
    x: (p.lng - origin.lng) * mPerDegLng,
    y: (p.lat - origin.lat) * mPerDegLat,
  };
}

function pointToSegmentM(p: AttendancePoint, a: AttendancePoint, b: AttendancePoint): number {
  const A = toLocalM(a, a);
  const B = toLocalM(a, b);
  const P = toLocalM(a, p);
  const abx = B.x - A.x;
  const aby = B.y - A.y;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-12) return haversineM(p, a);
  let t = ((P.x - A.x) * abx + (P.y - A.y) * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const dx = P.x - (A.x + t * abx);
  const dy = P.y - (A.y + t * aby);
  return Math.hypot(dx, dy);
}

function pointInPolygon(lat: number, lng: number, poly: AttendancePoint[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng;
    const yi = poly[i].lat;
    const xj = poly[j].lng;
    const yj = poly[j].lat;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToEdgeM(lat: number, lng: number, shape: AttendanceShape): number {
  const here = { lat, lng };
  const poly = Array.isArray(shape.geo_polygon) ? shape.geo_polygon : [];
  const isRadius = shape.geometry_type === "radius" || (poly.length < 3 && shape.center_lat != null);
  if (isRadius) {
    if (shape.center_lat == null || shape.center_lng == null || !shape.radius_m) {
      return Number.POSITIVE_INFINITY;
    }
    const center = { lat: Number(shape.center_lat), lng: Number(shape.center_lng) };
    const d = haversineM(here, center) - Number(shape.radius_m);
    return d <= 0 ? 0 : d;
  }
  if (pointInPolygon(lat, lng, poly)) return 0;
  if (poly.length < 2) return Number.POSITIVE_INFINITY;
  const n = poly.length;
  const closed = n > 2 && poly[0].lat === poly[n - 1].lat && poly[0].lng === poly[n - 1].lng;
  const edgeCount = closed ? n - 1 : n;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < edgeCount; i++) {
    best = Math.min(best, pointToSegmentM(here, poly[i], poly[(i + 1) % n]));
  }
  return best;
}

export function isWithinAttendanceShape(
  lat: number,
  lng: number,
  shape: AttendanceShape,
  accuracyM?: number | null,
): boolean {
  const buffer = clampBufferM(shape.buffer_m);
  const dist = distanceToEdgeM(lat, lng, shape);
  const acc = Number.isFinite(Number(accuracyM)) ? Math.max(0, Number(accuracyM)) : 0;
  const pad = Math.min(acc, ACCURACY_PAD_CAP_M);
  return dist <= buffer + pad;
}

/** First matching 개소/테두리 name, or null when the fix is outside every shape. */
export function matchingAttendanceSpotName(
  lat: number,
  lng: number,
  shapes: AttendanceShape[],
  accuracyM?: number | null,
): string | null {
  for (const shape of shapes) {
    if (isWithinAttendanceShape(lat, lng, shape, accuracyM)) {
      const name = String(shape.name || "").trim();
      return name || "현장";
    }
  }
  return null;
}

export function isWithinPinAttendance(
  lat: number,
  lng: number,
  pinLat: number,
  pinLng: number,
  accuracyM?: number | null,
  radiusM = PIN_ATTENDANCE_RADIUS_M,
): boolean {
  if (!Number.isFinite(pinLat) || !Number.isFinite(pinLng)) return false;
  const d = haversineM({ lat, lng }, { lat: pinLat, lng: pinLng });
  const acc = Number.isFinite(Number(accuracyM)) ? Math.max(0, Number(accuracyM)) : 0;
  const pad = Math.min(acc, 80);
  return d <= radiusM + pad;
}
