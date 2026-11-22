import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, ArrowUpRight, Radio, ShieldAlert, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LOCATION_CONTROL_TABS,
  summarizeLocationControlKpis,
  type LocationControlKpis,
  type LocationControlTab,
} from "@/lib/locationControlSummary";

type Props = {
  projectId: string | null | undefined;
  activeTab: LocationControlTab;
  /** Bump to refresh KPIs alongside parent reloads. */
  refreshKey?: string | number;
};

/**
 * Shared top control strip for the 3 GPS location operations screens:
 * - 실시간 분포 (/app/admin/worker-distribution)
 * - 위험구역 경보 (/app/admin/zone-events)
 * - 출근자 GPS 상태 (/app/admin/admin/tracking-health)
 *
 * Non-blocking read-only summary: failures silently hide individual metrics rather than toasting.
 */
export default function LocationControlBar({ projectId, activeTab, refreshKey = 0 }: Props) {
  const access = useGlobalProjectAccessOptional();
  const isContractorCo =
    !!access &&
    !access.isMaster &&
    (access.userCompanyType === "contractor" || access.userCompanyType === "vendor");

  const [kpis, setKpis] = useState<LocationControlKpis | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setKpis(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const distP = supabase.rpc("get_worker_distribution_counts" as any, {
      _project_id: projectId,
    });
    const healthP = supabase.rpc("get_gps_tracking_health" as any, {
      _project_id: projectId,
    });
    const unackP = supabase
      .from("worker_zone_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("event_type", "unauthorized_entry")
      .eq("acknowledged", false);
    const zonesP = supabase
      .from("restricted_zones")
      .select("zone_category, is_active, is_deleted")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .eq("is_active", true);

    void Promise.allSettled([distP, healthP, unackP, zonesP]).then(
      ([distRes, healthRes, unackRes, zonesRes]) => {
        if (cancelled) return;
        const distRows =
          distRes.status === "fulfilled" && !distRes.value.error && Array.isArray(distRes.value.data)
            ? distRes.value.data
            : [];
        const healthRows =
          healthRes.status === "fulfilled" &&
          !healthRes.value.error &&
          Array.isArray(healthRes.value.data)
            ? healthRes.value.data
            : [];
        const unackCount =
          unackRes.status === "fulfilled" && !unackRes.value.error ? unackRes.value.count ?? 0 : 0;
        const zoneRows =
          zonesRes.status === "fulfilled" &&
          !zonesRes.value.error &&
          Array.isArray(zonesRes.value.data)
            ? zonesRes.value.data
            : [];

        setKpis(
          summarizeLocationControlKpis({
            distributionRows: distRows,
            trackingRows: healthRows,
            unackDangerCount: unackCount,
            restrictedZones: zoneRows,
          }),
        );
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  const trackingIssues = (kpis?.trackingDelayed ?? 0) + (kpis?.trackingDisconnected ?? 0);

  return (
    <div
      data-testid="location-control-bar"
      className="rounded-lg border bg-card/80 p-3 space-y-2.5 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="위치 관제 화면 이동" className="flex flex-wrap items-center gap-1.5">
          {LOCATION_CONTROL_TABS.map((item) => {
            const active = item.key === activeTab;
            const badgeCount =
              item.key === "zone-events"
                ? kpis?.unackDangerCount ?? 0
                : item.key === "tracking-health"
                  ? trackingIssues
                  : 0;
            return (
              <Button
                key={item.key}
                asChild
                size="sm"
                variant={active ? "default" : "outline"}
                className="h-8 text-xs gap-1.5"
              >
                <Link to={item.to}>
                  {item.label}
                  {badgeCount > 0 && (
                    <Badge
                      variant={
                        item.key === "zone-events"
                          ? "destructive"
                          : active
                            ? "secondary"
                            : "outline"
                      }
                      className="h-4 px-1.5 text-[10px]"
                    >
                      {badgeCount}
                    </Badge>
                  )}
                </Link>
              </Button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 text-xs">
          <Link
            to="/app/admin/workers?tab=exceptions"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            예외·미완료
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          {!isContractorCo && (
            <Link
              to="/app/admin/site-control-map"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              관제맵 설정
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      {projectId && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="rounded-md border bg-background px-2.5 py-2 flex items-center justify-between gap-2">
            <span className="text-muted-foreground inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-primary" />
              현장 체류
            </span>
            <span className="font-semibold text-sm">
              {loading && !kpis ? "…" : `${kpis?.onSiteCount ?? 0}명`}
            </span>
          </div>

          <div className="rounded-md border bg-background px-2.5 py-2 flex items-center justify-between gap-2">
            <span className="text-muted-foreground inline-flex items-center gap-1.5">
              <Radio className="h-3.5 w-3.5 text-blue-600" />
              GPS 정상률
            </span>
            <span className="font-semibold text-sm">
              {loading && !kpis
                ? "…"
                : kpis?.trackingLivePct == null
                  ? "—"
                  : `${kpis.trackingLivePct}%`}
              {kpis && kpis.trackingTotal > 0 && (
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  ({kpis.trackingLive}/{kpis.trackingTotal})
                </span>
              )}
            </span>
          </div>

          <div
            className={`rounded-md border px-2.5 py-2 flex items-center justify-between gap-2 ${
              (kpis?.unackDangerCount ?? 0) > 0
                ? "border-destructive/40 bg-destructive/5"
                : "bg-background"
            }`}
          >
            <span className="text-muted-foreground inline-flex items-center gap-1.5">
              <ShieldAlert
                className={`h-3.5 w-3.5 ${(kpis?.unackDangerCount ?? 0) > 0 ? "text-destructive" : "text-muted-foreground"}`}
              />
              미확인 위험진입
            </span>
            <span
              className={`font-semibold text-sm ${(kpis?.unackDangerCount ?? 0) > 0 ? "text-destructive" : ""}`}
            >
              {loading && !kpis ? "…" : `${kpis?.unackDangerCount ?? 0}건`}
            </span>
          </div>

          <div
            className={`rounded-md border px-2.5 py-2 flex items-center justify-between gap-2 ${
              kpis && kpis.activeDangerZoneCount === 0
                ? "border-amber-300 bg-amber-50/70 dark:bg-amber-950/20"
                : "bg-background"
            }`}
          >
            <span className="text-muted-foreground inline-flex items-center gap-1.5">
              {kpis && kpis.activeDangerZoneCount === 0 ? (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              ) : (
                <Activity className="h-3.5 w-3.5 text-emerald-600" />
              )}
              활성 위험구역
            </span>
            <span className="font-semibold text-sm flex items-center gap-1.5">
              {loading && !kpis ? "…" : `${kpis?.activeDangerZoneCount ?? 0}개`}
              {kpis && kpis.activeDangerZoneCount === 0 && !isContractorCo && (
                <Link
                  to="/app/admin/site-control-map"
                  className="text-[11px] font-medium text-amber-800 dark:text-amber-200 underline underline-offset-2"
                >
                  등록
                </Link>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
