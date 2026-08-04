import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { isManagerMobileRole, roleLabelKo } from "@/lib/mobileShell";
import { usePreview } from "@/contexts/PreviewContext";
import MobileWeatherCard from "@/components/mobile/MobileWeatherCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  HeartPulse,
  OctagonAlert,
  Users,
  AlertTriangle,
  Crosshair,
  Bell,
} from "lucide-react";
import WorkerDailyHome from "@/pages/WorkerDailyHome";
import { useSystemRealtimeOptional } from "@/providers/SystemRealtimeProvider";

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
      isMaster={preview.isPreview ? effectiveRole === "master" : isMaster}
    />
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
  isMaster,
}: {
  projectId: string;
  role: string;
  isMaster: boolean;
}) {
  const navigate = useNavigate();
  const unread = useSystemRealtimeOptional()?.unreadNotifications ?? 0;
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  const [openActions, setOpenActions] = useState<number | null>(null);
  const [workStops, setWorkStops] = useState<number | null>(null);
  const [onSite, setOnSite] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectId) return;
      try {
        const [appr, acts, stops, att] = await Promise.all([
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
        ]);
        if (cancelled) return;
        const list = Array.isArray(appr) ? appr : appr ? [appr] : [];
        setPendingApprovals(list.length);
        setOpenActions(acts ?? 0);
        setWorkStops(stops ?? 0);
        setOnSite(att ?? 0);
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
      to: "/app/worker/tasks",
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
      <div className="flex items-center justify-between">
        <div>
          <div className="text-base font-bold">오늘</div>
          <div className="text-xs text-muted-foreground">{roleLabelKo(role)} 뷰</div>
        </div>
        {!projectId && (
          <Badge variant="destructive" className="text-[10px]">
            프로젝트 선택 필요
          </Badge>
        )}
      </div>

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

      <Card>
        <CardContent className="p-0 divide-y">
          {[
            { label: "안전점검", to: "/app/worker/inspect" },
            { label: "사고 신고", to: "/app/worker/incident" },
            { label: "TBM 진행", to: "/app/worker/tbm" },
            { label: "근로자 · 출입 관리", to: "/app/worker/workers?tab=roster" },
            { label: "승인 자료 보기", to: "/app/worker/docs" },
          ].map((row) => (
            <Link
              key={row.to}
              to={row.to}
              className="flex items-center gap-2 px-3 py-3 text-sm hover:bg-muted/50"
            >
              <span className="flex-1">{row.label}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </CardContent>
      </Card>

      {isMaster && (
        <Button
          className="w-full h-11"
          disabled={!projectId}
          onClick={() => navigate("/app/worker/map-calibration")}
        >
          <Crosshair className="h-4 w-4 mr-2" /> 맵·GPS 맞추기
        </Button>
      )}
    </div>
  );
}
