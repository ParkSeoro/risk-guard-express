import { isActiveAlarmingZone, type AlarmZoneProbe } from "@/lib/tracking/activeAlarmZones";
import { summarizeGpsHealth, type GpsAgeBucket } from "@/lib/tracking/gpsTrackingHealth";

export type LocationControlTab = "distribution" | "zone-events" | "tracking-health";

export type LocationControlKpis = {
  onSiteCount: number;
  trackingTotal: number;
  trackingLive: number;
  trackingDelayed: number;
  trackingDisconnected: number;
  trackingLivePct: number | null;
  unackDangerCount: number;
  activeDangerZoneCount: number;
};

export const LOCATION_CONTROL_TABS: ReadonlyArray<{
  key: LocationControlTab;
  label: string;
  to: string;
}> = [
  { key: "distribution", label: "실시간 분포", to: "/app/admin/worker-distribution" },
  { key: "zone-events", label: "위험구역 경보", to: "/app/admin/zone-events" },
  { key: "tracking-health", label: "출근자 GPS 상태", to: "/app/admin/admin/tracking-health" },
];

export function summarizeLocationControlKpis(input: {
  distributionRows?: ReadonlyArray<{ headcount?: number | string | null }> | null;
  trackingRows?: ReadonlyArray<{ bucket?: GpsAgeBucket | string | null }> | null;
  unackDangerCount?: number | null;
  restrictedZones?: ReadonlyArray<AlarmZoneProbe> | null;
}): LocationControlKpis {
  const onSiteCount = (input.distributionRows ?? []).reduce((sum, row) => {
    const n = Number(row?.headcount ?? 0);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);

  const normalizedTracking = (input.trackingRows ?? []).map((r) => ({
    bucket: (
      r?.bucket === "live" || r?.bucket === "delayed" || r?.bucket === "disconnected"
        ? r.bucket
        : "disconnected"
    ) as GpsAgeBucket,
  }));
  const health = summarizeGpsHealth(normalizedTracking);
  const trackingLivePct =
    health.total > 0 ? Math.round((health.live / health.total) * 100) : null;

  const rawUnack = Number(input.unackDangerCount ?? 0);
  const unackDangerCount = Number.isFinite(rawUnack) && rawUnack > 0 ? rawUnack : 0;

  const activeDangerZoneCount = (input.restrictedZones ?? []).filter((z) =>
    isActiveAlarmingZone(z),
  ).length;

  return {
    onSiteCount,
    trackingTotal: health.total,
    trackingLive: health.live,
    trackingDelayed: health.delayed,
    trackingDisconnected: health.disconnected,
    trackingLivePct,
    unackDangerCount,
    activeDangerZoneCount,
  };
}
