import { pointInPolygon } from "./geofence";
import { isAccessForbidden, isPresenceZoneCategory } from "./accessRules";

export type GeoPoint = { lat: number; lng: number };

export type RestrictedZoneGeom = {
  id: string;
  name: string;
  geometry_type: "polygon" | "radius";
  geo_polygon: GeoPoint[] | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
  banned_worker_ids: string[] | null;
  banned_company_ids: string[] | null;
  banned_job_types: string[] | null;
  access_rules?: unknown;
  rule_type?: string | null;
  zone_category?: string | null;
  zone_color?: string | null;
  is_active?: boolean;
  /** Approach ring in meters. NULL = client default. 0 = no buffer. */
  buffer_m?: number | null;
};

function haversineM(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, s)));
}

/** Local meters relative to `origin` (equirectangular). Accurate at construction-site scale. */
function toLocalM(origin: GeoPoint, p: GeoPoint): { x: number; y: number } {
  const lat0 = (origin.lat * Math.PI) / 180;
  const mPerDegLat = 111_195;
  const mPerDegLng = 111_195 * Math.cos(lat0);
  return {
    x: (p.lng - origin.lng) * mPerDegLng,
    y: (p.lat - origin.lat) * mPerDegLat,
  };
}

/** Shortest ground distance from `p` to segment `a`–`b` (meters). */
export function pointToSegmentM(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
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

function distanceToPolygonEdgeM(here: GeoPoint, poly: GeoPoint[]): number {
  const n = poly.length;
  if (n < 2) return Number.POSITIVE_INFINITY;
  const closed =
    n > 2 && poly[0].lat === poly[n - 1].lat && poly[0].lng === poly[n - 1].lng;
  const edgeCount = closed ? n - 1 : n;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < edgeCount; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    best = Math.min(best, pointToSegmentM(here, a, b));
  }
  return best;
}

/** True when (lat,lng) intersects the zone geometry. */
export function pointInRestrictedZone(lat: number, lng: number, zone: RestrictedZoneGeom): boolean {
  if (zone.geometry_type === "radius") {
    if (zone.center_lat == null || zone.center_lng == null || !zone.radius_m) return false;
    return haversineM({ lat, lng }, { lat: zone.center_lat, lng: zone.center_lng }) <= zone.radius_m;
  }
  const poly = zone.geo_polygon;
  if (!poly || poly.length < 3) return false;
  const xy = poly.map((p) => ({ x: p.lng, y: p.lat }));
  return pointInPolygon({ x: lng, y: lat }, xy);
}

export type BanSubject = {
  worker_id?: string | null;
  company_id?: string | null;
  job_type?: string | null;
};

/**
 * Entry is forbidden when access_rules / rule_type say so.
 * ALLOW = whitelist, DENY = blacklist (see accessRules.ts).
 */
export function isSubjectBanned(zone: RestrictedZoneGeom, subject: BanSubject): boolean {
  if (isPresenceZoneCategory(zone.zone_category)) return false;
  return isAccessForbidden(zone.access_rules, subject, {
    banned_worker_ids: zone.banned_worker_ids,
    banned_company_ids: zone.banned_company_ids,
    banned_job_types: zone.banned_job_types,
    rule_type: zone.rule_type,
  });
}

export function findViolatingRestrictedZone(
  lat: number,
  lng: number,
  zones: RestrictedZoneGeom[],
  subject: BanSubject
): RestrictedZoneGeom | null {
  for (const z of zones) {
    if (z.is_active === false) continue;
    if (!pointInRestrictedZone(lat, lng, z)) continue;
    if (isSubjectBanned(z, subject)) return z;
  }
  return null;
}

/** Distance in meters to this zone's edge (0 if inside). */
export function distanceToZoneEdgeM(
  lat: number,
  lng: number,
  zone: RestrictedZoneGeom,
): number {
  if (pointInRestrictedZone(lat, lng, zone)) return 0;
  const here = { lat, lng };
  if (zone.geometry_type === "radius" && zone.center_lat != null && zone.center_lng != null && zone.radius_m) {
    const d =
      haversineM(here, { lat: zone.center_lat, lng: zone.center_lng }) - Number(zone.radius_m);
    return Math.max(0, d);
  }
  const poly = zone.geo_polygon;
  if (!poly || poly.length < 3) return Number.POSITIVE_INFINITY;
  return distanceToPolygonEdgeM(here, poly);
}

/** Distance in meters to the nearest restricted-zone edge (0 if inside). */
export function minDistanceToRestrictedZoneEdge(
  lat: number,
  lng: number,
  zones: RestrictedZoneGeom[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const z of zones) {
    if (z.is_active === false) continue;
    if (isPresenceZoneCategory(z.zone_category)) continue;
    const d = distanceToZoneEdgeM(lat, lng, z);
    if (d === 0) return 0;
    best = Math.min(best, d);
  }
  return Number.isFinite(best) ? best : Number.POSITIVE_INFINITY;
}
