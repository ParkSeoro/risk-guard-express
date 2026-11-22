/**
 * Pure helpers for PR 1-B / PR 2-B (`Dashboard` zone alerts & `ZoneEvents` queries/residuals/live presence).
 */
import {
  pointInRestrictedZone,
  type RestrictedZoneGeom,
} from "@/lib/tracking/restrictedZoneGeom";

export type ZoneEventRecord = {
  id: string;
  project_id: string;
  zone_id: string | null;
  restricted_zone_id?: string | null;
  worker_qr_id?: string | null;
  worker_name: string | null;
  worker_phone: string | null;
  event_type: string;
  source?: string | null;
  notes?: string | null;
  ack_note?: string | null;
  acknowledged: boolean;
  acknowledged_by?: string | null;
  acknowledged_at: string | null;
  created_at: string;
  restricted_zone?: {
    name: string | null;
    zone_category?: string | null;
    zone_color?: string | null;
  } | null;
  zone?: {
    name: string | null;
    zone_type?: string | null;
    color?: string | null;
  } | null;
};

export type ZoneEventLivePosition = {
  worker_id: string;
  lat: number | null;
  lng: number | null;
  updated_at: string | null;
};

export type ZoneEventLivePresence = {
  status: "inside" | "left" | "stale";
  label: string;
  tone: "danger" | "safe" | "warn";
};

export const ZONE_ACK_QUICK_NOTES = [
  "이탈 확인",
  "전화 연락",
  "현장 출동",
  "작업중지 조치",
] as const;

export const LIVE_PRESENCE_FRESH_MS = 15 * 60 * 1000;

export type ZoneLogRangePreset = "today" | "7d" | "30d" | "all";
export type ZoneEventTypeFilter = "all" | "unauthorized_entry" | "entry" | "exit";

export const DASHBOARD_ZONE_CACHE_TTL_MS = 3 * 60 * 1000;

function digitsOnly(phone?: string | null): string {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * Resolve display name for a zone event.
 * Prefers `restricted_zones` (current SSOT), falls back to legacy `site_zones`.
 */
export function resolveZoneEventName(e: Pick<ZoneEventRecord, "restricted_zone" | "zone" | "restricted_zone_id" | "zone_id">): string {
  const rzName = e.restricted_zone?.name?.trim();
  if (rzName) return rzName;
  const legacyName = e.zone?.name?.trim();
  if (legacyName) return legacyName;
  if (e.restricted_zone_id || e.zone_id) return "(구역 삭제됨)";
  return "(구역 미지정)";
}

/** Stable worker key preferring resolved `worker_qr_id` (workers.id), then phone digits, then name. */
export function zoneEventWorkerKey(e: Pick<ZoneEventRecord, "worker_qr_id" | "worker_phone" | "worker_name">): string {
  if (e.worker_qr_id) return `id:${e.worker_qr_id}`;
  const digits = digitsOnly(e.worker_phone);
  if (digits) return `phone:${digits}`;
  const name = String(e.worker_name || "").trim();
  if (name) return `name:${name}`;
  return "unknown";
}

export function zoneEventZoneKey(e: Pick<ZoneEventRecord, "restricted_zone_id" | "zone_id">): string {
  return e.restricted_zone_id || e.zone_id || "any";
}

/**
 * Compute currently residual danger-zone entries for today (Phase 1 SSOT):
 * tracks each worker's LATEST zone event chronologically because `track-location`
 * emits only one event per transition (e.g. Danger A -> Danger B emits only
 * `unauthorized_entry(B)` without `exit(A)`, and Danger A -> Normal emits `entry`).
 * A worker is residual iff their latest today event is `unauthorized_entry`.
 */
export function computeActiveDangerResiduals<T extends ZoneEventRecord>(todayEvents: T[]): T[] {
  const chronological = [...todayEvents].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  );

  // workerKey -> latest active unauthorized_entry event (cleared on normal entry or exit)
  const latestDangerByWorker = new Map<string, T>();

  for (const e of chronological) {
    const wKey = zoneEventWorkerKey(e);
    if (wKey === "unknown") continue;
    const evType = String(e.event_type || "").toLowerCase();

    if (evType === "unauthorized_entry") {
      latestDangerByWorker.set(wKey, e);
    } else if (/^(exit|leave|depart)/i.test(evType)) {
      latestDangerByWorker.delete(wKey);
    } else if (evType === "entry" && !e.restricted_zone_id) {
      // Only clear danger residual when moving into a non-restricted zone;
      // an `entry` carrying `restricted_zone_id` means the worker is still inside that danger zone.
      latestDangerByWorker.delete(wKey);
    }
  }

  return [...latestDangerByWorker.values()].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
}

/**
 * Compute KST-aligned lower bound ISO timestamp for `ZoneEvents` log range filter.
 * Returns `null` when preset is `"all"`.
 */
export function computeLogRangeSinceIso(
  preset: ZoneLogRangePreset,
  todayKstYmd: string,
): string | null {
  if (preset === "all") return null;
  const baseMs = Date.parse(`${todayKstYmd}T00:00:00+09:00`);
  if (!Number.isFinite(baseMs)) return null;
  const daysBack = preset === "today" ? 0 : preset === "7d" ? 6 : 29;
  return new Date(baseMs - daysBack * 24 * 60 * 60 * 1000).toISOString();
}

export function resolveInitialZoneEventsTab(searchParams: URLSearchParams): "alerts" | "residual" | "all" {
  const explicit = searchParams.get("tab");
  if (explicit === "alerts" || explicit === "residual" || explicit === "all") {
    return explicit;
  }
  if (searchParams.get("ack") === "open") {
    return "alerts";
  }
  return "alerts";
}

/**
 * Cross-checks an alert/residual event against the worker's latest `worker_last_positions`
 * row and the active `restricted_zones` geometry to show whether they are still inside.
 * Returns `null` when required identifiers or zone geometry are unavailable.
 */
export function classifyZoneEventLivePresence(
  event: Pick<ZoneEventRecord, "event_type" | "restricted_zone_id" | "worker_qr_id" | "created_at">,
  position: ZoneEventLivePosition | null | undefined,
  zone: RestrictedZoneGeom | null | undefined,
  nowMs: number = Date.now(),
): ZoneEventLivePresence | null {
  if (event.event_type !== "unauthorized_entry") return null;
  if (!event.worker_qr_id || !event.restricted_zone_id || !zone || zone.is_active === false) {
    return null;
  }
  if (!position || position.lat == null || position.lng == null || !position.updated_at) {
    return null;
  }

  const posMs = Date.parse(position.updated_at);
  const eventMs = Date.parse(event.created_at);
  if (!Number.isFinite(posMs)) return null;

  const isTooOld = nowMs - posMs > LIVE_PRESENCE_FRESH_MS;
  // Strictly require a fix at or after the alert timestamp so pre-entry coordinates
  // can never produce a false-safe "구역 이탈 확인" badge.
  const predatesEvent = Number.isFinite(eventMs) && posMs < eventMs;
  if (isTooOld || predatesEvent) {
    return { status: "stale", label: "위치 오래됨", tone: "warn" };
  }

  const inside = pointInRestrictedZone(Number(position.lat), Number(position.lng), zone);
  if (inside) {
    return { status: "inside", label: "현재 구역 내 체류중", tone: "danger" };
  }
  return { status: "left", label: "구역 이탈 확인", tone: "safe" };
}
