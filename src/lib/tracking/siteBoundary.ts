import { supabase } from "@/integrations/supabase/client";
import {
  distanceToZoneEdgeM,
  pointInRestrictedZone,
  type GeoPoint,
} from "@/lib/tracking/restrictedZoneGeom";
import {
  isDefinitelyOutsideAllSites,
  isInsideAnyResumeFence,
  SITE_EXIT_MAX_ACCURACY_M,
  type SiteTrackingFence,
} from "@/lib/tracking/siteTrackBounds";

export const SITE_BOUNDARY_BUFFER_MIN_M = 100;
export const SITE_BOUNDARY_BUFFER_MAX_M = 300;
export const SITE_BOUNDARY_BUFFER_DEFAULT_M = 150;
/** Extra GPS slop on top of the 100–300m attendance buffer. */
export const SITE_BOUNDARY_ACCURACY_PAD_CAP_M = 40;

export type SiteBoundaryGeometryType = "polygon" | "radius";

export type SiteBoundary = {
  id: string;
  project_id: string;
  name: string;
  geometry_type: SiteBoundaryGeometryType;
  geo_polygon: GeoPoint[] | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
  buffer_m: number;
};

export function clampSiteBoundaryBufferM(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return SITE_BOUNDARY_BUFFER_DEFAULT_M;
  return Math.min(SITE_BOUNDARY_BUFFER_MAX_M, Math.max(SITE_BOUNDARY_BUFFER_MIN_M, Math.round(n)));
}

export function parseSiteBoundaryRow(row: Record<string, unknown> | null | undefined): SiteBoundary | null {
  if (!row || typeof row.id !== "string" || typeof row.project_id !== "string") return null;
  const geometryType = row.geometry_type === "radius" ? "radius" : "polygon";
  const poly = Array.isArray(row.geo_polygon)
    ? (row.geo_polygon as GeoPoint[]).filter(
        (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)),
      )
    : null;
  return {
    id: row.id,
    project_id: row.project_id,
    name: typeof row.name === "string" && row.name.trim() ? row.name : "현장 테두리",
    geometry_type: geometryType,
    geo_polygon: poly && poly.length >= 3 ? poly : null,
    center_lat: Number.isFinite(Number(row.center_lat)) ? Number(row.center_lat) : null,
    center_lng: Number.isFinite(Number(row.center_lng)) ? Number(row.center_lng) : null,
    radius_m: Number.isFinite(Number(row.radius_m)) ? Number(row.radius_m) : null,
    buffer_m: clampSiteBoundaryBufferM(row.buffer_m),
  };
}

function asZone(boundary: SiteBoundary) {
  return {
    id: boundary.id,
    name: boundary.name,
    geometry_type: boundary.geometry_type,
    geo_polygon: boundary.geo_polygon,
    center_lat: boundary.center_lat,
    center_lng: boundary.center_lng,
    radius_m: boundary.radius_m,
    banned_worker_ids: null,
    banned_company_ids: null,
    banned_job_types: null,
  };
}

export function pointInSiteBoundary(lat: number, lng: number, boundary: SiteBoundary): boolean {
  return pointInRestrictedZone(lat, lng, asZone(boundary));
}

/** 0 if inside the drawn shape; otherwise meters to the edge. */
export function distanceToSiteBoundaryEdgeM(
  lat: number,
  lng: number,
  boundary: SiteBoundary,
): number {
  return distanceToZoneEdgeM(lat, lng, asZone(boundary));
}

export function isWithinSiteAttendance(
  lat: number,
  lng: number,
  boundary: SiteBoundary,
  accuracyM?: number,
): boolean {
  const buffer = clampSiteBoundaryBufferM(boundary.buffer_m);
  const dist = distanceToSiteBoundaryEdgeM(lat, lng, boundary);
  const acc = Number.isFinite(accuracyM) ? Math.max(0, Number(accuracyM)) : 0;
  const pad = Math.min(acc, SITE_BOUNDARY_ACCURACY_PAD_CAP_M);
  return dist <= buffer + pad;
}

export function isDefinitelyOutsideSiteBoundary(
  boundary: SiteBoundary,
  rawLat: number,
  rawLng: number,
  accuracyM: number,
): { outside: boolean; distanceM: number; radiusM: number } {
  const buffer = clampSiteBoundaryBufferM(boundary.buffer_m);
  const distanceM = distanceToSiteBoundaryEdgeM(rawLat, rawLng, boundary);
  const acc = Number.isFinite(accuracyM) ? accuracyM : 999;
  if (acc > SITE_EXIT_MAX_ACCURACY_M) {
    return { outside: false, distanceM, radiusM: buffer };
  }
  return { outside: distanceM > buffer, distanceM, radiusM: buffer };
}

export function asSiteOutlines(
  boundary: SiteBoundary | SiteBoundary[] | null | undefined,
): SiteBoundary[] {
  if (!boundary) return [];
  return Array.isArray(boundary) ? boundary.filter(Boolean) : [boundary];
}

export function isWithinAnySiteAttendance(
  outlines: SiteBoundary[],
  lat: number,
  lng: number,
  accuracyM?: number,
): boolean {
  return outlines.some((o) => isWithinSiteAttendance(lat, lng, o, accuracyM));
}

export function distanceToNearestSiteOutlineM(
  outlines: SiteBoundary[],
  lat: number,
  lng: number,
): number | null {
  if (!outlines.length) return null;
  let best = Number.POSITIVE_INFINITY;
  for (const o of outlines) {
    best = Math.min(best, distanceToSiteBoundaryEdgeM(lat, lng, o));
  }
  return Number.isFinite(best) ? best : null;
}

export function isDefinitelyOutsideAnySiteOutline(
  outlines: SiteBoundary[],
  rawLat: number,
  rawLng: number,
  accuracyM: number,
): { outside: boolean; distanceM: number; radiusM: number } {
  let nearest = {
    outside: true,
    distanceM: Number.POSITIVE_INFINITY,
    radiusM: clampSiteBoundaryBufferM(outlines[0]?.buffer_m),
  };
  for (const o of outlines) {
    const r = isDefinitelyOutsideSiteBoundary(o, rawLat, rawLng, accuracyM);
    if (!r.outside) return r;
    if (r.distanceM < nearest.distanceM) nearest = r;
  }
  return nearest;
}

export function pickCurrentSiteOutline(
  outlines: SiteBoundary[],
  lat: number,
  lng: number,
  opts?: { lastId?: string | null; accuracyM?: number },
): SiteBoundary | null {
  const inside = outlines.filter((o) =>
    isWithinSiteAttendance(lat, lng, o, opts?.accuracyM),
  );
  if (!inside.length) return null;
  const ranked = inside
    .map((o) => ({ o, d: distanceToSiteBoundaryEdgeM(lat, lng, o) }))
    .sort((a, b) => a.d - b.d);
  const best = ranked[0];
  const lastId = opts?.lastId;
  if (lastId) {
    const last = ranked.find((r) => r.o.id === lastId);
    if (last && last.d - best.d <= 40) return last.o;
  }
  return best.o;
}

export function outlineToDrawnShape(outline: SiteBoundary):
  | { kind: "circle"; center: GeoPoint; radius_m: number }
  | { kind: "polygon"; latlngs: GeoPoint[] }
  | null {
  if (
    outline.geometry_type === "radius"
    && outline.center_lat != null
    && outline.center_lng != null
    && Number(outline.radius_m) > 0
  ) {
    return {
      kind: "circle",
      center: { lat: outline.center_lat, lng: outline.center_lng },
      radius_m: Number(outline.radius_m),
    };
  }
  if (outline.geo_polygon && outline.geo_polygon.length >= 3) {
    return { kind: "polygon", latlngs: outline.geo_polygon };
  }
  return null;
}

export function ringCentroid(poly: GeoPoint[]): { lat: number; lng: number } | null {
  const pts = poly.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!pts.length) return null;
  let lat = 0;
  let lng = 0;
  for (const p of pts) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / pts.length, lng: lng / pts.length };
}

export function parseSiteSpotRow(row: Record<string, unknown> | null | undefined): SiteBoundary | null {
  if (!row || typeof row.id !== "string" || typeof row.project_id !== "string") return null;
  const fromBoundary = parseSiteBoundaryRow({
    ...row,
    name: typeof row.name === "string" && row.name.trim() ? row.name : "개소",
  });
  if (!fromBoundary) return null;
  if (fromBoundary.geometry_type === "polygon" && (fromBoundary.geo_polygon?.length ?? 0) >= 3) {
    return fromBoundary;
  }
  if (
    fromBoundary.center_lat != null
    && fromBoundary.center_lng != null
    && Number(fromBoundary.radius_m) > 0
  ) {
    return { ...fromBoundary, geometry_type: "radius" };
  }
  return null;
}

/** Prefer 개소 outlines, then a single project outline; otherwise circular fences. */
export function evaluateSiteLeave(
  boundary: SiteBoundary | SiteBoundary[] | null | undefined,
  fences: SiteTrackingFence[],
  rawLat: number,
  rawLng: number,
  accuracyM: number,
): { outside: boolean; distanceM: number; radiusM: number } | null {
  const outlines = asSiteOutlines(boundary);
  if (outlines.length) return isDefinitelyOutsideAnySiteOutline(outlines, rawLat, rawLng, accuracyM);
  if (!fences.length) return null;
  return isDefinitelyOutsideAllSites(fences, rawLat, rawLng, accuracyM);
}

export function canResumeOnSite(
  boundary: SiteBoundary | SiteBoundary[] | null | undefined,
  fences: SiteTrackingFence[],
  lat: number,
  lng: number,
  accuracyM: number,
): boolean {
  const outlines = asSiteOutlines(boundary);
  if (outlines.length) {
    if (accuracyM > SITE_EXIT_MAX_ACCURACY_M) return false;
    return isWithinAnySiteAttendance(outlines, lat, lng, accuracyM);
  }
  return fences.length > 0 && isInsideAnyResumeFence(fences, lat, lng, accuracyM);
}

export async function fetchActiveSiteBoundary(projectId: string): Promise<SiteBoundary | null> {
  if (!projectId) return null;
  try {
    const { data, error } = await supabase
      .from("project_site_boundaries" as any)
      .select(
        "id, project_id, name, geometry_type, geo_polygon, center_lat, center_lng, radius_m, buffer_m",
      )
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data) return null;
    return parseSiteBoundaryRow(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function fetchActiveSiteOutlines(projectId: string): Promise<SiteBoundary[]> {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase
      .from("project_site_spots" as any)
      .select(
        "id, project_id, name, geometry_type, geo_polygon, center_lat, center_lng, radius_m, buffer_m, sort_order",
      )
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) return [];
    return ((data || []) as Record<string, unknown>[])
      .map((row) => parseSiteSpotRow(row))
      .filter((row): row is SiteBoundary => !!row);
  } catch {
    return [];
  }
}

/** 개소가 있으면 그 합집합, 없으면 프로젝트 테두리 하나. */
export async function fetchAttendanceOutlines(projectId: string): Promise<SiteBoundary[]> {
  const spots = await fetchActiveSiteOutlines(projectId);
  if (spots.length > 0) return spots;
  const one = await fetchActiveSiteBoundary(projectId);
  return one ? [one] : [];
}

export type LatLngBox = { south: number; west: number; north: number; east: number };

/** Bounding box around an 개소 outline, padded in meters (camera only). */
export function siteOutlineBounds(outline: SiteBoundary, padM = 40): LatLngBox | null {
  if (
    outline.geometry_type === "radius"
    && outline.center_lat != null
    && outline.center_lng != null
    && Number(outline.radius_m) > 0
  ) {
    const r = Number(outline.radius_m) + Math.max(0, padM);
    const lat = outline.center_lat;
    const lng = outline.center_lng;
    const dLat = r / 111_195;
    const dLng = r / (111_195 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    return {
      south: lat - dLat,
      west: lng - dLng,
      north: lat + dLat,
      east: lng + dLng,
    };
  }
  const poly = outline.geo_polygon;
  if (!poly || poly.length < 3) return null;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const p of poly) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  const pad = Math.max(0, padM);
  const dLat = pad / 111_195;
  const mid = (south + north) / 2;
  const dLng = pad / (111_195 * Math.max(0.2, Math.cos((mid * Math.PI) / 180)));
  return {
    south: south - dLat,
    west: west - dLng,
    north: north + dLat,
    east: east + dLng,
  };
}

export function zoneSpotLabel(
  siteSpotId: string | null | undefined,
  spots: { id: string; name: string }[],
): string {
  if (!siteSpotId) return "개소 미지정";
  return spots.find((s) => s.id === siteSpotId)?.name ?? "삭제된 개소";
}

/** When 2+ 개소, the zone list for the 개소 currently being drawn. */
export function zonesForWorkSpot<T extends { site_spot_id?: string | null }>(
  zones: T[],
  spotId: string | null,
  spotCount: number,
): T[] {
  if (spotCount < 2 || !spotId) return zones;
  return zones.filter((z) => z.site_spot_id === spotId);
}

export function unassignedZones<T extends { site_spot_id?: string | null }>(
  zones: T[],
  spotCount: number,
): T[] {
  if (spotCount < 2) return [];
  return zones.filter((z) => !z.site_spot_id);
}
