import { isPresenceZoneCategory } from "@/lib/tracking/accessRules";
import { GPS_DELAYED_MS, GPS_LIVE_MS } from "@/lib/tracking/gpsTrackingHealth";
import { pointInRestrictedZone, type RestrictedZoneGeom } from "@/lib/tracking/restrictedZoneGeom";
import { latLngToUv } from "@/lib/tracking/imageSpaceGeo";

type LatLng = { lat: number; lng: number };
export type DistributionCorners = { tl: LatLng; tr: LatLng; bl: LatLng };

/** How the site distribution map places a checked-in worker. */
export function distributionZoneId(opts: {
  lastFixAt?: string | Date | null;
  zoneId?: string | null;
  now?: Date;
  freshMs?: number;
}): string | null {
  const freshMs = opts.freshMs ?? 12 * 60 * 60 * 1000;
  const at = opts.lastFixAt
    ? opts.lastFixAt instanceof Date
      ? opts.lastFixAt.getTime()
      : Date.parse(String(opts.lastFixAt))
    : NaN;
  if (!Number.isFinite(at)) return null;
  const now = (opts.now ?? new Date()).getTime();
  if (now - at > freshMs) return null;
  return opts.zoneId || null;
}

/**
 * Project a WGS84 fix onto the sitemap image (percent, top-left origin).
 * Returns null when the point is well outside the photo.
 */
export function distributionImagePoint(
  lat: number,
  lng: number,
  corners: DistributionCorners,
  pad = 0.08,
): { x: number; y: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const uv = latLngToUv({ lat, lng }, corners);
  if (!Number.isFinite(uv.u) || !Number.isFinite(uv.v)) return null;
  if (uv.u < -pad || uv.u > 1 + pad || uv.v < -pad || uv.v > 1 + pad) return null;
  return { x: uv.u * 100, y: uv.v * 100 };
}

export function zoneCategoryToType(
  category?: string | null,
): "normal" | "work" | "restricted" | "danger" {
  if (category === "일반") return "normal";
  if (category === "작업구역") return "work";
  const c = (category || "").toLowerCase();
  if (/위험|밀폐|추락|danger/.test(c)) return "danger";
  if (/제한|restricted/.test(c)) return "restricted";
  if (/작업|work/.test(c)) return "work";
  return "normal";
}

/** GPS 점이 들어간 구역. 위험 > 작업구역 > 일반. 근로자 개별 지정 없음. */
export function matchDistributionZone(
  lat: number,
  lng: number,
  zones: RestrictedZoneGeom[],
): RestrictedZoneGeom | null {
  const hits = zones.filter((z) => z.is_active !== false && pointInRestrictedZone(lat, lng, z));
  if (!hits.length) return null;
  const rank = (z: RestrictedZoneGeom) => {
    if (!isPresenceZoneCategory(z.zone_category)) return 2;
    return z.zone_category === "작업구역" ? 1 : 0;
  };
  return [...hits].sort((a, b) => rank(b) - rank(a))[0];
}

/** Spread stacked GPS dots so a gate cluster is visible. */
export function distributionDotJitter(index: number, radius = 1.15): { dx: number; dy: number } {
  if (index <= 0) return { dx: 0, dy: 0 };
  const a = index * 2.39996;
  return { dx: Math.cos(a) * radius, dy: Math.sin(a) * radius };
}

/** How honest the distribution map should be about a plotted point. */
export type DistributionFixKind = "live" | "recent" | "checkin" | "stale";

export function classifyDistributionFix(opts: {
  source?: string | null;
  updatedAt?: string | Date | null;
  now?: number;
}): DistributionFixKind {
  const now = opts.now ?? Date.now();
  const at = opts.updatedAt
    ? opts.updatedAt instanceof Date
      ? opts.updatedAt.getTime()
      : Date.parse(String(opts.updatedAt))
    : NaN;
  if (!Number.isFinite(at)) return "stale";
  const age = now - at;
  if (age <= GPS_LIVE_MS) return "live";
  const source = String(opts.source || "").toLowerCase();
  if (source === "checkin") return "checkin";
  if (age <= GPS_DELAYED_MS) return "recent";
  return "stale";
}

export function distributionFixLabel(kind: DistributionFixKind): string {
  if (kind === "live") return "실시간";
  if (kind === "recent") return "최근 GPS";
  if (kind === "checkin") return "출근 위치";
  return "오래된 위치";
}

export function summarizeDistributionFixes(
  positions: Array<{ source?: string | null; updated_at?: string | Date | null }>,
  now = Date.now(),
  checkedIn = positions.length,
): { live: number; recent: number; checkin: number; stale: number; missing: number; plotted: number } {
  let live = 0;
  let recent = 0;
  let checkin = 0;
  let stale = 0;
  for (const p of positions) {
    const kind = classifyDistributionFix({ source: p.source, updatedAt: p.updated_at, now });
    if (kind === "live") live += 1;
    else if (kind === "recent") recent += 1;
    else if (kind === "checkin") checkin += 1;
    else stale += 1;
  }
  return {
    live,
    recent,
    checkin,
    stale,
    plotted: positions.length,
    missing: Math.max(0, checkedIn - positions.length),
  };
}
