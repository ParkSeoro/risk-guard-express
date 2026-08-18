/**
 * Site fence for GPS auto-stop + check-in.
 *
 * Important: projects.site_lat/lng is often an address geocode (office / lot
 * pin) that can be hundreds of meters from the actual work pad. When
 * site_maps are georeferenced, use the map footprint as the site reference
 * (any project — not a single company hardcoded).
 *
 * Offsite "pause" session flags were removed — start policy is role-based
 * (worker = checked in, manager = inside fence) in WorkerGlobalGps.
 */
import { supabase } from "@/integrations/supabase/client";
import { calculateDistance } from "@/lib/geo/calculateDistance";
import {
  bottomRight,
  cornersCenter,
  loadCornersFromMap,
  type GeoCorners,
} from "@/lib/mapBounds";

/** Minimum tracking fence when only site_lat/lng exists (not check-in radius). */
export const SITE_TRACK_EXIT_M = 500;
/**
 * Resume uses the tracking radius (not a 350m city cap).
 * Exit still adds an accuracy pad, so start/stop keep a small hysteresis.
 */
export const SITE_TRACK_RESUME_M = SITE_TRACK_EXIT_M;
/** Hard cap so a bad map corner cannot keep tracking city-wide. */
export const SITE_TRACK_MAX_M = 2500;
/** Margin added beyond map extent. */
export const SITE_TRACK_MAP_PAD_M = 120;

/** Clock-in: hard floor when only address pin exists. */
export const SITE_CHECKIN_MIN_M = 100;
/** Clock-in: pad beyond farthest map corner when maps are georeferenced. */
export const SITE_CHECKIN_MAP_PAD_M = 50;
/** Clock-in hard cap (still much tighter than tracking). */
export const SITE_CHECKIN_MAX_M = 800;

/** Consecutive definite-outside fixes before auto-stop. */
export const SITE_EXIT_STREAK = 5;
/** Ignore outside samples when GPS accuracy is worse than this. */
export const SITE_EXIT_MAX_ACCURACY_M = 55;

/** Local danger siren: ignore junk fixes on both open and close. */
export const SIREN_MAX_ACCURACY_M = 40;

/**
 * Off-site low-power resume probe (F-03).
 * ~12 samples/hour at home vs ~80/hour at 45s eco — keeps the OS GPS icon off
 * between probes. Foreground visibility still probes immediately.
 */
export const SITE_RESUME_POLL_MS = 5 * 60_000;
/** First resume probe after suspend (avoid bouncing back on the exit sample). */
export const SITE_RESUME_FIRST_PROBE_MS = 30_000;

/** High-precision tracking only within this distance of a restricted zone edge. */
export const DANGER_PROXIMITY_M = 80;

export type SiteTrackingFence = {
  lat: number;
  lng: number;
  radiusM: number;
  /** How the center was chosen — for UI diagnostics. */
  source?: "site_map" | "site_pin";
};

type MapRow = {
  geo_anchor_nw_lat?: number | string | null;
  geo_anchor_nw_lng?: number | string | null;
  geo_anchor_se_lat?: number | string | null;
  geo_anchor_se_lng?: number | string | null;
  geo_transform?: unknown;
};

function numOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Collect georeferenced map corners for a project. */
export function collectMapCorners(maps: MapRow[] | null | undefined): GeoCorners[] {
  const out: GeoCorners[] = [];
  for (const row of maps || []) {
    const corners = loadCornersFromMap({
      geo_anchor_nw_lat: numOrNull(row.geo_anchor_nw_lat),
      geo_anchor_nw_lng: numOrNull(row.geo_anchor_nw_lng),
      geo_anchor_se_lat: numOrNull(row.geo_anchor_se_lat),
      geo_anchor_se_lng: numOrNull(row.geo_anchor_se_lng),
      geo_transform: row.geo_transform as any,
    });
    if (corners) out.push(corners);
  }
  return out;
}

/**
 * Build a circular site fence.
 * Prefer site_maps footprint center when available; else address pin.
 */
export function buildSiteFence(opts: {
  siteLat: number;
  siteLng: number;
  maps?: MapRow[] | null;
  minRadiusM: number;
  mapPadM: number;
  maxRadiusM: number;
}): SiteTrackingFence {
  const cornerSets = collectMapCorners(opts.maps);
  const allPoints: { lat: number; lng: number }[] = [];
  for (const c of cornerSets) {
    const br = bottomRight(c);
    allPoints.push(c.tl, c.tr, c.bl, br);
  }

  if (allPoints.length > 0) {
    // Average of per-map centers (stable if multiple maps)
    let lat = 0;
    let lng = 0;
    for (const c of cornerSets) {
      const mid = cornersCenter(c);
      lat += mid.lat;
      lng += mid.lng;
    }
    lat /= cornerSets.length;
    lng /= cornerSets.length;
    let maxDist = 0;
    for (const p of allPoints) {
      maxDist = Math.max(maxDist, calculateDistance(lat, lng, p.lat, p.lng));
    }
    return {
      lat,
      lng,
      radiusM: Math.min(
        opts.maxRadiusM,
        Math.max(opts.minRadiusM, Math.ceil(maxDist + opts.mapPadM)),
      ),
      source: "site_map",
    };
  }

  return {
    lat: opts.siteLat,
    lng: opts.siteLng,
    radiusM: opts.minRadiusM,
    source: "site_pin",
  };
}

async function fetchProjectSiteAndMaps(projectId: string): Promise<{
  siteLat: number;
  siteLng: number;
  maps: MapRow[];
} | null> {
  const { data: proj } = await supabase
    .from("projects")
    .select("site_lat, site_lng")
    .eq("id", projectId)
    .maybeSingle();
  const siteLat = Number((proj as { site_lat?: number } | null)?.site_lat);
  const siteLng = Number((proj as { site_lng?: number } | null)?.site_lng);
  if (!Number.isFinite(siteLat) || !Number.isFinite(siteLng)) {
    // Maps alone can still define the site when pin is missing
    const { data: mapsOnly } = await supabase
      .from("site_maps")
      .select(
        "geo_anchor_nw_lat,geo_anchor_nw_lng,geo_anchor_se_lat,geo_anchor_se_lng,geo_transform",
      )
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .limit(8);
    const corners = collectMapCorners(mapsOnly as MapRow[]);
    if (corners.length === 0) return null;
    const mid = cornersCenter(corners[0]);
    return { siteLat: mid.lat, siteLng: mid.lng, maps: (mapsOnly || []) as MapRow[] };
  }

  const { data: maps } = await supabase
    .from("site_maps")
    .select(
      "geo_anchor_nw_lat,geo_anchor_nw_lng,geo_anchor_se_lat,geo_anchor_se_lng,geo_transform",
    )
    .eq("project_id", projectId)
    .eq("is_deleted", false)
    .limit(8);

  return { siteLat, siteLng, maps: (maps || []) as MapRow[] };
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
  accuracyM = 30,
): boolean {
  const acc = Number.isFinite(accuracyM) ? accuracyM : 999;
  // Junk / stale GPS must not start tracking at home.
  if (acc > SITE_EXIT_MAX_ACCURACY_M) return false;
  const d = calculateDistance(fence.lat, fence.lng, lat, lng);
  return d <= fence.radiusM;
}

/** Build tracking fence from project pin + optional drone map corners. */
export async function resolveSiteTrackingFence(
  projectId: string,
): Promise<SiteTrackingFence | null> {
  try {
    const base = await fetchProjectSiteAndMaps(projectId);
    if (!base) return null;
    return buildSiteFence({
      siteLat: base.siteLat,
      siteLng: base.siteLng,
      maps: base.maps,
      minRadiusM: SITE_TRACK_EXIT_M,
      mapPadM: SITE_TRACK_MAP_PAD_M,
      maxRadiusM: SITE_TRACK_MAX_M,
    });
  } catch {
    return null;
  }
}

/**
 * Clock-in fence: 100m around address pin, or map footprint (+pad) when
 * site_maps are georeferenced — so a wrong lot geocode cannot block check-in
 * on the actual work pad.
 */
export async function resolveSiteCheckInFence(
  projectId: string,
): Promise<SiteTrackingFence | null> {
  try {
    const base = await fetchProjectSiteAndMaps(projectId);
    if (!base) return null;
    return buildSiteFence({
      siteLat: base.siteLat,
      siteLng: base.siteLng,
      maps: base.maps,
      minRadiusM: SITE_CHECKIN_MIN_M,
      mapPadM: SITE_CHECKIN_MAP_PAD_M,
      maxRadiusM: SITE_CHECKIN_MAX_M,
    });
  } catch {
    return null;
  }
}
