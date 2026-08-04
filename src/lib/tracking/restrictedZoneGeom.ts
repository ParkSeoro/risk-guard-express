import { pointInPolygon } from "./geofence";
import { isAccessForbidden } from "./accessRules";

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
};

function haversineM(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
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

/** Distance in meters to the nearest restricted-zone edge (0 if inside). */
export function minDistanceToRestrictedZoneEdge(
  lat: number,
  lng: number,
  zones: RestrictedZoneGeom[],
): number {
  let best = Number.POSITIVE_INFINITY;
  const here = { lat, lng };
  for (const z of zones) {
    if (z.is_active === false) continue;
    if (pointInRestrictedZone(lat, lng, z)) return 0;
    if (z.geometry_type === "radius" && z.center_lat != null && z.center_lng != null && z.radius_m) {
      const d =
        haversineM(here, { lat: z.center_lat, lng: z.center_lng }) - Number(z.radius_m);
      best = Math.min(best, Math.max(0, d));
      continue;
    }
    const poly = z.geo_polygon;
    if (!poly || poly.length < 3) continue;
    for (const p of poly) {
      best = Math.min(best, haversineM(here, p));
    }
  }
  return Number.isFinite(best) ? best : Number.POSITIVE_INFINITY;
}
