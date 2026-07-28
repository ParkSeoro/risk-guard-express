import { pointInPolygon } from "./geofence";

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
 * Entry is forbidden when the subject matches any configured ban list.
 * Empty ban lists ⇒ everyone is banned (zone is a full no-entry danger zone).
 */
export function isSubjectBanned(zone: RestrictedZoneGeom, subject: BanSubject): boolean {
  const workers = zone.banned_worker_ids || [];
  const companies = zone.banned_company_ids || [];
  const jobs = (zone.banned_job_types || []).map((j) => j.trim().toLowerCase()).filter(Boolean);

  if (workers.length === 0 && companies.length === 0 && jobs.length === 0) {
    return true;
  }
  if (subject.worker_id && workers.includes(subject.worker_id)) return true;
  if (subject.company_id && companies.includes(subject.company_id)) return true;
  if (subject.job_type && jobs.includes(subject.job_type.trim().toLowerCase())) return true;
  return false;
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
