import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { isManagerMobileRole, roleLabelKo } from "@/lib/mobileShell";
import { usePreview } from "@/contexts/PreviewContext";
import MobileWeatherCard from "@/components/mobile/MobileWeatherCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ClipboardCheck,
  FileCheck2,
  HeartPulse,
  OctagonAlert,
  Users,
  AlertTriangle,
  Crosshair,
  Bell,
  Share,
} from "lucide-react";
import WorkerDailyHome from "@/pages/WorkerDailyHome";
import MobileProjectPicker from "@/components/mobile/MobileProjectPicker";
import AnnouncementNoticeBanner from "@/components/announcements/AnnouncementNoticeBanner";
import { usePendingAnnouncements } from "@/hooks/usePendingAnnouncements";
import { useSystemRealtimeOptional } from "@/providers/SystemRealtimeProvider";
import { isIosSafariTab } from "@/lib/pushSubscription";
import { isIosWebClient, isWebStandalone } from "@/lib/iosWebPath";
import { isNativeApp } from "@/lib/native/isNativeApp";
import { anyMapHasGeoref } from "@/lib/mapBounds";

export default function MobileToday() {
  const { role, isMaster, projectId, loading } = useMobileAccess();
  const preview = usePreview();
  const effectiveRole = preview.isPreview ? preview.syntheticRole : role;
  const manager = isManagerMobileRole(
    effectiveRole,
    preview.isPreview ? effectiveRole === "master" : isMaster,
  );

  if (loading && !preview.isPreview) {
    return <div className="p-6 text-sm text-muted-foreground">로딩 중…</div>;
  }

  if (!manager) {
    return (
      <div className="p-4 space-y-3 max-w-md mx-auto" data-testid="worker-today">
        <IosWebPathBanner />
        <TodayAnnouncementBanners projectId={projectId || preview.previewProjectId} />
        <MobileWeatherCard projectId={projectId || preview.previewProjectId} />
        <HealthDueCard projectId={projectId || preview.previewProjectId} />
        <div className="rounded-xl border bg-background overflow-hidden">
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">
            출퇴근 · TBM
          </div>
          <WorkerDailyHome embedded />
        </div>
      </div>
    );
  }

  return (
    <ManagerToday
      projectId={projectId || preview.previewProjectId}
      role={effectiveRole}
    />
  );
}

/** iPhone Safari tab: nudge PWA + honest native-only gaps. Hidden in Capacitor / standalone. */
function IosWebPathBanner() {
  const show = useMemo(
    () => !isNativeApp() && isIosWebClient() && !isWebStandalone(),
    [],
  );
  if (!show) return null;
  return (
    <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed space-y-1">
      <p className="font-medium text-foreground flex items-center gap-1.5">
        <Share className="h-3.5 w-3.5" /> iPhone · 홈 화면 추가 권장
      </p>
      <p>
        Safari 공유 → 「홈 화면에 추가」하면 앱처럼 쓰고 푸시도 받을 수 있습니다.
        {isIosSafariTab() ? " (지금 Safari 탭에서는 푸시가 제한됩니다)" : ""}
      </p>
      <p className="text-[10px]">
        Android 앱과 화면·기능은 동일합니다. 백그라운드 GPS·무음 사이렌만 앱 전용입니다.
      </p>
    </div>
  );
}

function HealthDueCard({ projectId }: { projectId: string }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center">
          <HeartPulse className="h-4 w-4 text-rose-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">일일 건강로그</div>
          <div className="text-xs text-muted-foreground">출근 전 컨디션을 기록하세요</div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to={`/app/worker/daily-health-log${projectId ? `?project=${projectId}` : ""}`}>
            작성
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ManagerToday({
  projectId,
  role,
}: {
  projectId: string;
  role: string;
}) {
  const navigate = useNavigate();
  const unread = useSystemRealtimeOptional()?.unreadNotifications ?? 0;
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  const [openActions, setOpenActions] = useState<number | null>(null);
  const [workStops, setWorkStops] = useState<number | null>(null);
  const [onSite, setOnSite] = useState<number | null>(null);
  const [needsWalkCalibration, setNeedsWalkCalibration] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectId) return;
      try {
        const [appr, acts, stops, att, proj] = await Promise.all([
          supabase.rpc("get_my_pending_entity_approvals" as any).then((r) => r.data),
          supabase
            .from("safety_inspection_actions" as any)
            .select("id", { count: "exact", head: true })
            .eq("project_id", projectId)
            .in("status", ["open", "in_progress", "pending", "진행중", "미완료"])
            .then((r) => r.count),
          supabase
            .from("work_stop_requests" as any)
            .select("id", { count: "exact", head: true })
            .eq("project_id", projectId)
            .in("status", ["접수", "검토중", "pending", "reviewing"])
            .then((r) => r.count),
          supabase
            .from("v_worker_attendance_today" as any)
            .select("worker_id", { count: "exact", head: true })
            .eq("project_id", projectId)
            .eq("attended", true)
            .eq("exited", false)
            .then((r) => r.count),
          supabase
            .from("site_maps")
            .select(
              "geo_anchor_nw_lat,geo_anchor_nw_lng,geo_anchor_se_lat,geo_anchor_se_lng,geo_transform",
            )
            .eq("project_id", projectId)
            .eq("is_deleted", false)
            .limit(8),
        ]);
        if (cancelled) return;
        const list = Array.isArray(appr) ? appr : appr ? [appr] : [];
        setPendingApprovals(list.length);
        setOpenActions(acts ?? 0);
        setWorkStops(stops ?? 0);
        setOnSite(att ?? 0);
        const maps = Array.isArray(proj.data) ? proj.data : [];
        // Walk A/B/C writes site_maps.geo_transform and CLEARS projects.gps_calibration.
        // Nag only when a drawing exists but has no georef — not when 1-point bias is empty.
        setNeedsWalkCalibration(maps.length > 0 && !anyMapHasGeoref(maps as any));
      } catch {
        /* ignore partial failures */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const tiles = [
    {
      title: "내 결재 대기",
      value: pendingApprovals,
      icon: FileCheck2,
      to: "/app/worker/approvals",
      tone: "text-blue-600",
    },
    {
      title: "안 읽은 알림",
      value: unread,
      icon: Bell,
      to: "/app/worker/alerts",
      tone: "text-violet-600",
    },
    {
      title: "미완료 조치",
      value: openActions,
      icon: ClipboardCheck,
      to: "/app/worker/actions",
      tone: "text-amber-600",
    },
    {
      title: "작업중지 처리중",
      value: workStops,
      icon: OctagonAlert,
      to: "/app/worker/work-stop",
      tone: "text-destructive",
    },
    {
      title: "현재 현장 인원",
      value: onSite,
      icon: Users,
      to: "/app/worker/workers?tab=attendance",
      tone: "text-emerald-600",
    },
  ];

  return (
    <div className="p-4 space-y-3 max-w-md mx-auto" data-testid="manager-today">
      <IosWebPathBanner />
      <TodayAnnouncementBanners projectId={projectId} />
      <div className="flex items-center justify-between">
        <div>
          <div className="text-base font-bold">오늘</div>
          <div className="text-xs text-muted-foreground">{roleLabelKo(role)}</div>
        </div>
      </div>

      {!projectId && <MobileProjectPicker />}

      {(workStops ?? 0) > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3 flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            처리 중인 작업중지가 {workStops}건 있습니다.
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => navigate("/app/worker/work-stop")}>
              확인
            </Button>
          </CardContent>
        </Card>
      )}

      <MobileWeatherCard projectId={projectId} />

      <div className="grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <button
            key={t.title}
            type="button"
            onClick={() => navigate(t.to)}
            className="text-left rounded-xl border bg-background p-3 hover:border-primary/40 transition-colors"
          >
            <t.icon className={`h-4 w-4 mb-2 ${t.tone}`} />
            <div className="text-xs text-muted-foreground">{t.title}</div>
            <div className="text-xl font-bold mt-0.5">{t.value == null ? "—" : t.value}</div>
          </button>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        점검·TBM·출입 등은 하단 <span className="font-medium text-foreground">현장</span> 탭
      </p>

      {needsWalkCalibration && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-medium flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              다음 단계: 맵·GPS 워킹 보정
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              도면만 올리면 위험구역 알람이 어긋날 수 있습니다. 현장에서 A·B·C 지점을 걸어 보정해 주세요.
            </p>
            <Button
              size="sm"
              className="w-full h-9"
              disabled={!projectId}
              onClick={() => navigate("/app/worker/map-calibration")}
            >
              <Crosshair className="h-3.5 w-3.5 mr-1.5" /> 지금 보정하기
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TodayAnnouncementBanners({ projectId }: { projectId?: string | null }) {
  const { notices, reload } = usePendingAnnouncements(projectId);
  const first = notices[0];
  if (!first) return null;
  return <AnnouncementNoticeBanner item={first} onAcked={() => void reload()} />;
}
