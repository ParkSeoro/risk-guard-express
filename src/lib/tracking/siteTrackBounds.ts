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

/** Clock-in: hard floor when a georeferenced map exists (tiny overlay). */
export const SITE_CHECKIN_MIN_M = 100;
/** Clock-in: pad beyond farthest map corner when maps are georeferenced. */
export const SITE_CHECKIN_MAP_PAD_M = 50;
/**
 * Pin-only check-in radius. Address geocodes (lot / office) are often hundreds
 * of metres from the pad — 100m blocked people standing on site.
 */
export const SITE_CHECKIN_PIN_M = 350;
/**
 * Clock-in hard cap. Must cover industrial complexes where the address pin and
 * drone overlay sit ~1km apart (e.g. GSC 여수 적량동 vs H2/LCO2 pad).
 */
export const SITE_CHECKIN_MAX_M = 1200;
/** GPS accuracy pad for check-in (capped so a 200m indoor fix cannot roam). */
export const CHECKIN_ACCURACY_PAD_CAP_M = 80;

/** Consecutive definite-outside fixes before auto-stop. */
export const SITE_EXIT_STREAK = 5;
/** Ignore outside samples when GPS accuracy is worse than this. */
export const SITE_EXIT_MAX_ACCURACY_M = 55;

/** Local danger siren: ignore junk fixes on both open and close. */
export const SIREN_MAX_ACCURACY_M = 40;

/** Approach banner (not the siren): allow a slightly looser GPS circle. */
export const ZONE_APPROACH_MAX_ACCURACY_M = 60;
/** Consecutive outside-buffer samples before the approach banner closes. */
export const ZONE_APPROACH_EXIT_STREAK = 2;

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
  source?: "site_map" | "site_pin" | "site_union" | "site_spot";
  id?: string;
  name?: string;
};

/** Admin default when creating a GPS 개소. */
export const SITE_SPOT_DEFAULT_RADIUS_M = 400;
export const SITE_SPOT_MIN_RADIUS_M = 50;
/** Keep last 개소 when two overlapping centers are this close. */
export const SITE_SPOT_HYSTERESIS_M = 40;

export type ProjectSiteSpotRow = {
  id: string;
  project_id: string;
  name: string;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  sort_order?: number;
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

async function resolveLegacyTrackingFence(
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

/** Build tracking fence from project pin + optional drone map corners. */
export async function resolveSiteTrackingFence(
  projectId: string,
): Promise<SiteTrackingFence | null> {
  const fences = await resolveSiteTrackingFences(projectId);
  return fences[0] ?? null;
}

/**
 * Clock-in fence for industrial sites.
 * Address pin and drone overlay are often far apart — cover BOTH so a worker
 * standing on either the pad or the lot gate is not told they are "outside".
 */
export function buildCheckInFence(opts: {
  siteLat: number;
  siteLng: number;
  maps?: MapRow[] | null;
}): SiteTrackingFence {
  const cornerSets = collectMapCorners(opts.maps);
  const pinOk = Number.isFinite(opts.siteLat) && Number.isFinite(opts.siteLng);
  const points: { lat: number; lng: number }[] = [];
  for (const c of cornerSets) {
    const br = bottomRight(c);
    points.push(c.tl, c.tr, c.bl, br);
  }
  if (pinOk) points.push({ lat: opts.siteLat, lng: opts.siteLng });

  if (points.length === 0) {
    return {
      lat: opts.siteLat,
      lng: opts.siteLng,
      radiusM: SITE_CHECKIN_PIN_M,
      source: "site_pin",
    };
  }

  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  lat /= points.length;
  lng /= points.length;
  let maxDist = 0;
  for (const p of points) {
    maxDist = Math.max(maxDist, calculateDistance(lat, lng, p.lat, p.lng));
  }
  const minR = cornerSets.length > 0 ? SITE_CHECKIN_MIN_M : SITE_CHECKIN_PIN_M;
  const pad = cornerSets.length > 0 ? SITE_CHECKIN_MAP_PAD_M : 0;
  const source: SiteTrackingFence["source"] =
    cornerSets.length > 0 && pinOk
      ? "site_union"
      : cornerSets.length > 0
        ? "site_map"
        : "site_pin";
  return {
    lat,
    lng,
    radiusM: Math.min(SITE_CHECKIN_MAX_M, Math.max(minR, Math.ceil(maxDist + pad))),
    source,
  };
}

/** Check-in: allow a capped GPS-accuracy pad at the fence edge. */
export function isInsideCheckInFence(
  fence: SiteTrackingFence,
  lat: number,
  lng: number,
  accuracyM?: number,
): boolean {
  const d = calculateDistance(fence.lat, fence.lng, lat, lng);
  const acc = Number.isFinite(accuracyM) ? Number(accuracyM) : 0;
  const pad = Math.min(Math.max(acc, 0), CHECKIN_ACCURACY_PAD_CAP_M);
  return d <= fence.radiusM + pad;
}

async function resolveLegacyCheckInFence(
  projectId: string,
): Promise<SiteTrackingFence | null> {
  try {
    const base = await fetchProjectSiteAndMaps(projectId);
    if (!base) return null;
    return buildCheckInFence({
      siteLat: base.siteLat,
      siteLng: base.siteLng,
      maps: base.maps,
    });
  } catch {
    return null;
  }
}

export async function resolveSiteCheckInFence(
  projectId: string,
): Promise<SiteTrackingFence | null> {
  const fences = await resolveSiteCheckInFences(projectId);
  return fences[0] ?? null;
}

export function clampSiteSpotRadiusM(radiusM: number): number {
  const n = Number(radiusM);
  if (!Number.isFinite(n)) return SITE_SPOT_DEFAULT_RADIUS_M;
  return Math.min(SITE_TRACK_MAX_M, Math.max(SITE_SPOT_MIN_RADIUS_M, n));
}

export function fenceFromSiteSpot(row: ProjectSiteSpotRow): SiteTrackingFence {
  return {
    id: row.id,
    name: row.name,
    lat: Number(row.center_lat),
    lng: Number(row.center_lng),
    radiusM: clampSiteSpotRadiusM(Number(row.radius_m)),
    source: "site_spot",
  };
}

export async function fetchActiveSiteSpots(projectId: string): Promise<ProjectSiteSpotRow[]> {
  if (!projectId) return [];
  try {
    const { data, error } = await supabase
      .from("project_site_spots" as any)
      .select("id, project_id, name, center_lat, center_lng, radius_m, sort_order")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) return [];
    return ((data || []) as ProjectSiteSpotRow[]).filter(
      (s) => Number.isFinite(Number(s.center_lat)) && Number.isFinite(Number(s.center_lng)),
    );
  } catch {
    return [];
  }
}

export function listTrackingFences(opts: {
  siteFences?: SiteTrackingFence[] | null;
  siteCenter?: SiteTrackingFence | null;
}): SiteTrackingFence[] {
  if (opts.siteFences && opts.siteFences.length > 0) return opts.siteFences;
  if (opts.siteCenter) return [opts.siteCenter];
  return [];
}

export function isInsideAnyCheckInFence(
  fences: SiteTrackingFence[],
  lat: number,
  lng: number,
  accuracyM?: number,
): boolean {
  return fences.some((f) => isInsideCheckInFence(f, lat, lng, accuracyM));
}

export function isInsideAnyResumeFence(
  fences: SiteTrackingFence[],
  lat: number,
  lng: number,
  accuracyM = 30,
): boolean {
  return fences.some((f) => isInsideResumeFence(f, lat, lng, accuracyM));
}

/** True only when raw GPS is clearly outside every 개소 (or the legacy single fence). */
export function isDefinitelyOutsideAllSites(
  fences: SiteTrackingFence[],
  rawLat: number,
  rawLng: number,
  accuracyM: number,
): { outside: boolean; distanceM: number; radiusM: number } {
  if (!fences.length) return { outside: false, distanceM: 0, radiusM: 0 };
  let nearest = {
    outside: true,
    distanceM: Number.POSITIVE_INFINITY,
    radiusM: fences[0].radiusM,
  };
  for (const f of fences) {
    const r = isDefinitelyOutsideSite(f, rawLat, rawLng, accuracyM);
    if (!r.outside) {
      return { outside: false, distanceM: r.distanceM, radiusM: f.radiusM };
    }
    if (r.distanceM < nearest.distanceM) {
      nearest = { outside: true, distanceM: r.distanceM, radiusM: f.radiusM };
    }
  }
  return nearest;
}

export function nearestFenceDistanceM(
  fences: SiteTrackingFence[],
  lat: number,
  lng: number,
): number | null {
  if (!fences.length) return null;
  let min = Number.POSITIVE_INFINITY;
  for (const f of fences) {
    min = Math.min(min, calculateDistance(f.lat, f.lng, lat, lng));
  }
  return Number.isFinite(min) ? min : null;
}

export function pickCurrentSiteSpot(
  fences: SiteTrackingFence[],
  lat: number,
  lng: number,
  opts?: {
    lastId?: string | null;
    accuracyM?: number;
    mode?: "checkin" | "track";
  },
): SiteTrackingFence | null {
  const mode = opts?.mode ?? "checkin";
  const acc = opts?.accuracyM;
  const inside = fences.filter((f) =>
    mode === "track"
      ? isInsideResumeFence(f, lat, lng, acc ?? 30)
      : isInsideCheckInFence(f, lat, lng, acc),
  );
  if (!inside.length) return null;
  const ranked = inside
    .map((f) => ({ f, d: calculateDistance(f.lat, f.lng, lat, lng) }))
    .sort((a, b) => a.d - b.d);
  const best = ranked[0];
  const lastId = opts?.lastId;
  if (lastId) {
    const last = ranked.find((r) => r.f.id === lastId);
    if (last && last.d - best.d <= SITE_SPOT_HYSTERESIS_M) return last.f;
  }
  return best.f;
}

function lastSpotStorageKey(projectId: string): string {
  return `snx-site-spot:${projectId}`;
}

export function readLastSiteSpotId(projectId: string): string | null {
  if (!projectId || typeof sessionStorage === "undefined") return null;
  try {
    return sessionStorage.getItem(lastSpotStorageKey(projectId));
  } catch {
    return null;
  }
}

export function writeLastSiteSpotId(projectId: string, id: string | null | undefined): void {
  if (!projectId || typeof sessionStorage === "undefined") return;
  try {
    const key = lastSpotStorageKey(projectId);
    if (id) sessionStorage.setItem(key, id);
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export async function resolveSiteTrackingFences(projectId: string): Promise<SiteTrackingFence[]> {
  const spots = await fetchActiveSiteSpots(projectId);
  if (spots.length > 0) return spots.map(fenceFromSiteSpot);
  const legacy = await resolveLegacyTrackingFence(projectId);
  return legacy ? [legacy] : [];
}

export async function resolveSiteCheckInFences(projectId: string): Promise<SiteTrackingFence[]> {
  const spots = await fetchActiveSiteSpots(projectId);
  if (spots.length > 0) return spots.map(fenceFromSiteSpot);
  const legacy = await resolveLegacyCheckInFence(projectId);
  return legacy ? [legacy] : [];
}
