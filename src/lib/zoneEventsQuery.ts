/**
 * Pure helpers for PR 1-B (`Dashboard` zone alerts & `ZoneEvents` queries/residuals).
 */

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
    } else if (evType === "entry" || /^(exit|leave|depart)/i.test(evType)) {
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
