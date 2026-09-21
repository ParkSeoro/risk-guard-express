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

/** Prefer the drawn site outline; otherwise the legacy circular fences. */
export function evaluateSiteLeave(
  boundary: SiteBoundary | null | undefined,
  fences: SiteTrackingFence[],
  rawLat: number,
  rawLng: number,
  accuracyM: number,
): { outside: boolean; distanceM: number; radiusM: number } | null {
  if (boundary) return isDefinitelyOutsideSiteBoundary(boundary, rawLat, rawLng, accuracyM);
  if (!fences.length) return null;
  return isDefinitelyOutsideAllSites(fences, rawLat, rawLng, accuracyM);
}

export function canResumeOnSite(
  boundary: SiteBoundary | null | undefined,
  fences: SiteTrackingFence[],
  lat: number,
  lng: number,
  accuracyM: number,
): boolean {
  if (boundary) {
    if (accuracyM > SITE_EXIT_MAX_ACCURACY_M) return false;
    return isWithinSiteAttendance(lat, lng, boundary, accuracyM);
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
