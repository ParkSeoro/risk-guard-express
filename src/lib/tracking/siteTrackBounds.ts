/**
 * Site fence for GPS auto-stop + offsite pause session flag.
 *
 * Important: construction sites are often hundreds of meters across.
 * A hard 100m circle around projects.site_lat/lng (often an office pin)
 * falsely marks workers as "off site". We expand using site_maps corners.
 */
import { supabase } from "@/integrations/supabase/client";
import { calculateDistance } from "@/lib/geo/calculateDistance";
import { bottomRight, loadCornersFromMap } from "@/lib/mapBounds";

const PREFIX = "safenex-gps-offsite-pause:";

/** Minimum tracking fence when only site_lat/lng exists (not check-in radius). */
export const SITE_TRACK_EXIT_M = 500;
/** Resume when closer than this (hysteresis vs exit). */
export const SITE_TRACK_RESUME_M = 350;
/** Hard cap so a bad map corner cannot keep tracking city-wide. */
export const SITE_TRACK_MAX_M = 2500;
/** Margin added beyond map extent. */
export const SITE_TRACK_MAP_PAD_M = 120;
/** Consecutive definite-outside fixes before auto-stop. */
export const SITE_EXIT_STREAK = 5;
/** Ignore outside samples when GPS accuracy is worse than this. */
export const SITE_EXIT_MAX_ACCURACY_M = 55;

/** High-precision tracking only within this distance of a restricted zone edge. */
export const DANGER_PROXIMITY_M = 80;

export type SiteTrackingFence = {
  lat: number;
  lng: number;
  radiusM: number;
};

export function offsitePauseKey(projectId: string) {
  return `${PREFIX}${projectId}`;
}

export function isGpsPausedOffsite(projectId: string | null | undefined): boolean {
  if (!projectId) return false;
  try {
    return sessionStorage.getItem(offsitePauseKey(projectId)) === "1";
  } catch {
    return false;
  }
}

export function setGpsPausedOffsite(projectId: string, paused: boolean) {
  try {
    if (paused) sessionStorage.setItem(offsitePauseKey(projectId), "1");
    else sessionStorage.removeItem(offsitePauseKey(projectId));
  } catch {
    /* ignore */
  }
}

/**
 * True only when raw GPS is clearly outside the fence.
 * Uses raw (not map-calibrated) coords vs site_lat/lng / map WGS84.
 */
export function isDefinitelyOutsideSite(
  fence: SiteTrackingFence,
  rawLat: number,
  rawLng: number,
  accuracyM: number,
): { outside: boolean; distanceM: number } {
  const distanceM = calculateDistance(fence.lat, fence.lng, rawLat, rawLng);
  const acc = Number.isFinite(accuracyM) ? accuracyM : 999;
  if (acc > SITE_EXIT_MAX_ACCURACY_M) {
    return { outside: false, distanceM };
  }
  const threshold = fence.radiusM + Math.max(acc, 25);
  return { outside: distanceM > threshold, distanceM };
}

export function isInsideResumeFence(
  fence: SiteTrackingFence,
  lat: number,
  lng: number,
): boolean {
  const d = calculateDistance(fence.lat, fence.lng, lat, lng);
  return d <= Math.min(fence.radiusM, SITE_TRACK_RESUME_M) || d <= fence.radiusM * 0.7;
}

/** Build tracking fence from project pin + optional drone map corners. */
export async function resolveSiteTrackingFence(
  projectId: string,
): Promise<SiteTrackingFence | null> {
  const { data: proj } = await supabase
    .from("projects")
    .select("site_lat, site_lng")
    .eq("id", projectId)
    .maybeSingle();
  const siteLat = Number((proj as { site_lat?: number } | null)?.site_lat);
  const siteLng = Number((proj as { site_lng?: number } | null)?.site_lng);
  if (!Number.isFinite(siteLat) || !Number.isFinite(siteLng)) return null;

  let radiusM = SITE_TRACK_EXIT_M;

  try {
    const { data: maps } = await supabase
      .from("site_maps")
      .select(
        "geo_anchor_nw_lat,geo_anchor_nw_lng,geo_anchor_se_lat,geo_anchor_se_lng,geo_transform",
      )
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .limit(8);

    let maxCornerDist = 0;
    for (const row of maps || []) {
      const corners = loadCornersFromMap(row as any);
      if (!corners) continue;
      const br = bottomRight(corners);
      for (const p of [corners.tl, corners.tr, corners.bl, br]) {
        if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        maxCornerDist = Math.max(
          maxCornerDist,
          calculateDistance(siteLat, siteLng, p.lat, p.lng),
        );
      }
    }
    if (maxCornerDist > 0) {
      radiusM = Math.max(SITE_TRACK_EXIT_M, Math.ceil(maxCornerDist + SITE_TRACK_MAP_PAD_M));
    }
  } catch {
    /* keep default radius */
  }

  return {
    lat: siteLat,
    lng: siteLng,
    radiusM: Math.min(radiusM, SITE_TRACK_MAX_M),
  };
}
