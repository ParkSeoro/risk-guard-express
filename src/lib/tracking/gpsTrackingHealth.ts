import type { GpsBlockReason } from "@/lib/tracking/gpsStatusUi";

export const GPS_LIVE_MS = 5 * 60_000;
export const GPS_DELAYED_MS = 30 * 60_000;

export type GpsAgeBucket = "live" | "delayed" | "disconnected";

export type GpsHealthRow = {
  worker_id: string;
  worker_name: string | null;
  company_id: string | null;
  company_name: string | null;
  last_fix_at: string | null;
  bucket: GpsAgeBucket;
  block_reason: GpsBlockReason;
};

export const GPS_BLOCK_REASON_ADMIN: Record<Exclude<GpsBlockReason, null>, string> = {
  no_consent: "위치 동의 없음",
  no_permission: "앱 위치 권한 없음",
  no_checkin: "미출근",
  fence_probe_failed: "현장 펜스 밖",
  identity_mismatch: "명부 신원 불일치",
};

export function gpsAgeBucket(updatedAt: string | Date | null | undefined, now = Date.now()): GpsAgeBucket {
  if (!updatedAt) return "disconnected";
  const t = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(String(updatedAt));
  if (!Number.isFinite(t)) return "disconnected";
  const age = now - t;
  if (age <= GPS_LIVE_MS) return "live";
  if (age <= GPS_DELAYED_MS) return "delayed";
  return "disconnected";
}

export function summarizeGpsHealth(rows: Array<{ bucket: string }>) {
  let live = 0;
  let delayed = 0;
  let disconnected = 0;
  for (const r of rows) {
    if (r.bucket === "live") live += 1;
    else if (r.bucket === "delayed") delayed += 1;
    else disconnected += 1;
  }
  return { live, delayed, disconnected, total: rows.length };
}

export function formatGpsFixAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "수신 없음";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "수신 없음";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}
