import {
  distanceToZoneEdgeM,
  isSubjectBanned,
  type BanSubject,
  type RestrictedZoneGeom,
} from "./restrictedZoneGeom";
import { isPresenceZoneCategory } from "./accessRules";
import { ZONE_APPROACH_MAX_ACCURACY_M } from "./siteTrackBounds";

/** Client default when restricted_zones.buffer_m is NULL. */
export const ZONE_BUFFER_DEFAULT_M = 25;
export const ZONE_BUFFER_MAX_M = 200;

export type ZoneTier = "core" | "buffer" | "outside";

export type ZoneProximity = {
  zone: RestrictedZoneGeom;
  distanceM: number;
  bufferM: number;
  tier: Exclude<ZoneTier, "outside">;
};

export type ParsedZoneBuffer = { ok: true; value: number | null } | { ok: false };

export function zoneBufferM(buffer_m?: number | null): number {
  if (buffer_m == null || !Number.isFinite(Number(buffer_m))) return ZONE_BUFFER_DEFAULT_M;
  return Math.max(0, Math.min(ZONE_BUFFER_MAX_M, Number(buffer_m)));
}

export function parseZoneBufferInput(raw: string): ParsedZoneBuffer {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > ZONE_BUFFER_MAX_M) return { ok: false };
  return { ok: true, value: n };
}

export function classifyZoneTier(distanceM: number, bufferM: number): ZoneTier {
  if (!Number.isFinite(distanceM)) return "outside";
  if (distanceM <= 0) return "core";
  if (bufferM > 0 && distanceM <= bufferM) return "buffer";
  return "outside";
}

export function isGpsAccurateEnoughForApproach(accuracyM?: number): boolean {
  const acc = Number.isFinite(accuracyM) ? Number(accuracyM) : 999;
  return acc <= ZONE_APPROACH_MAX_ACCURACY_M;
}

/**
 * Prefer a core hit over a buffer hit. Same tier: nearer edge wins.
 * Presence / inactive / not-banned zones are ignored.
 */
export function findZoneProximity(
  lat: number,
  lng: number,
  zones: RestrictedZoneGeom[],
  subject: BanSubject,
): ZoneProximity | null {
  let best: ZoneProximity | null = null;
  for (const zone of zones) {
    if (zone.is_active === false) continue;
    if (isPresenceZoneCategory(zone.zone_category)) continue;
    if (!isSubjectBanned(zone, subject)) continue;
    const distanceM = distanceToZoneEdgeM(lat, lng, zone);
    const bufferM = zoneBufferM(zone.buffer_m);
    const tier = classifyZoneTier(distanceM, bufferM);
    if (tier === "outside") continue;
    const cand: ZoneProximity = { zone, distanceM, bufferM, tier };
    if (!best) {
      best = cand;
      continue;
    }
    if (cand.tier === "core" && best.tier !== "core") {
      best = cand;
      continue;
    }
    if (cand.tier === best.tier && cand.distanceM < best.distanceM) {
      best = cand;
    }
  }
  return best;
}

/**
 * Only quote a meter figure when GPS accuracy is strictly better than the distance.
 * Otherwise the phone is guessing — show 「근처」.
 */
export function formatApproachDistance(distanceM: number, accuracyM?: number | null): string {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return "내부";
  const acc = Number.isFinite(accuracyM) ? Number(accuracyM) : Number.POSITIVE_INFINITY;
  if (acc >= distanceM) return "근처";
  return `약 ${Math.round(distanceM)}m 앞`;
}
