import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getGradeClassName } from "@/lib/riskGrade";
import { isActiveRiskItem } from "@/lib/riskItemVisibility";
import { isOpenInspectionAction } from "@/lib/inspectionActions";
import {
  buildAttentionItems,
  countOnSite,
  summarizePermits,
  summarizeWorkPlans,
  todayKstDate,
  type AttentionItem,
  type SitePulse,
  type StatusBucket,
} from "@/lib/dashboardOps";
import { seoulDayRange } from "@/lib/dailyWorkAck";
import { formatSiteLabel } from "@/lib/legalForms/patrolLog";
import {
  authorCompanyIdsForRuns,
  filterRunsByCompanyScope,
} from "@/lib/companyDocScope";
import {
  AlertTriangle, CheckCircle2, ShieldAlert,
  ClipboardList, ShieldCheck, ArrowRight, RefreshCw,
  FileText, Cloud, CloudRain, Wind, Thermometer, Sun,
  FileSignature, Bot, MapPin, HardHat, ClipboardCheck,
  Monitor, Download, X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { isWindowsDesktopApp } from "@/lib/desktopBridge";
import { PC_APP_VERSION } from "@/pages/Download";
import { SiteSafetyRiskControlHub } from "@/components/dashboard/SiteSafetyRiskControlHub";
import { geocodeKoreanAddress, fetchLiveWeatherData, syncProjectCoordinates } from "@/lib/koreanLocationService";

type TopRisk = {
  id: string;
  process?: string | null;
  sub_task?: string | null;
  hazard?: string | null;
  risk_grade?: string | null;
  improved_risk_grade?: string | null;
  status?: string | null;
  department?: string | null;
};

type PermitSum = ReturnType<typeof summarizePermits>;

export type InspectionSum = {
  total: number;
  inProgress: number;
  completed: number;
  openActions: number;
};

type DashboardData = {
  attention: AttentionItem[];
  pulse: SitePulse;
  residualHigh: number;
  topRisks: TopRisk[];
  raFeedbackUnresolved: number;
  totalRuns: number;
  approvedRuns: number;
  totalItems: number;
  planSum: StatusBucket;
  permitSum: PermitSum;
  inspectionSum: InspectionSum;
};

const EMPTY_PLAN: StatusBucket = { draft: 0, inApproval: 0, approved: 0, rejected: 0, total: 0 };
const EMPTY_PERMIT: PermitSum = { draft: 0, inApproval: 0, active: 0, closurePending: 0, rejected: 0, total: 0 };
const EMPTY_INSP: InspectionSum = { total: 0, inProgress: 0, completed: 0, openActions: 0 };
const EMPTY: DashboardData = {
  attention: [],
  pulse: {
    onSiteWorkers: 0,
    todayEntries: 0,
    todayTbm: 0,
    activePermits: 0,
    draftPermits: 0,
    approvalPendingPermits: 0,
    workPlans: 0,
    zoneAlerts: 0,
  },
  residualHigh: 0,
  topRisks: [],
  raFeedbackUnresolved: 0,
  totalRuns: 0,
  approvedRuns: 0,
  totalItems: 0,
  planSum: EMPTY_PLAN,
  permitSum: EMPTY_PERMIT,
  inspectionSum: EMPTY_INSP,
};

// 1시간 클라이언트 인메모리 캐시 (프로젝트별)
const DASHBOARD_CACHE_TTL_MS = 60 * 60 * 1000;
const dashboardCache = new Map<string, { data: DashboardData; timestamp: number }>();

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const {
    projects, selectedProject,
    applyCompanyFilter, loading: accessLoading, seesAllCompanies,
    accessibleCompanyIds, userCompanyType, userCompanyId, scopeStatus,
  } = useGlobalProjectAccess();
  // Ops-wide tiles = project-wide company visibility only (발주처 PA·SM / master)
  const showOpsWide = seesAllCompanies;
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<DashboardData>(() => {
    return (selectedProject && dashboardCache.get(selectedProject)?.data) || EMPTY;
  });
  const [loading, setLoading] = useState(() => {
    return !selectedProject || !dashboardCache.has(selectedProject);
  });

  const fetchDashboard = useCallback(async (force = false) => {
    if (!selectedProject || scopeStatus !== "ready") return;

    if (force) {
      setRefreshKey((k) => k + 1);
    }

    const cached = dashboardCache.get(selectedProject);
    const isCacheFresh = cached && (Date.now() - cached.timestamp < DASHBOARD_CACHE_TTL_MS);
    if (!force && isCacheFresh) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    // 이미 데이터가 있는 경우 화면 깜빡임/로딩 스피너 방지를 위해 백그라운드 갱신
    if (!cached) {
      setLoading(true);
    }
    const today = todayKstDate();
    const dayRange = seoulDayRange(today);

    try {
      let permitQ: any = supabase
        .from("work_permits" as any)
        .select("id, status")
        .eq("project_id", selectedProject)
        .eq("is_deleted", false);
      permitQ = applyCompanyFilter(permitQ);

      let wpQ: any = supabase
        .from("work_plans")
        .select("id, status, end_date")
        .eq("project_id", selectedProject)
        .eq("is_deleted", false);
      wpQ = applyCompanyFilter(wpQ);

      let todoQ: any = supabase
        .from("todo_items")
        .select("id, status, frequency")
        .eq("project_id", selectedProject);
      todoQ = applyCompanyFilter(todoQ);

      let tbmQ: any = supabase
        .from("tbm_sessions" as any)
        .select("id")
        .eq("project_id", selectedProject)
        .eq("tbm_date", today)
        .eq("is_deleted", false);
      tbmQ = applyCompanyFilter(tbmQ);

      let inspQ: any = supabase
        .from("safety_inspections" as any)
        .select("id, status")
        .eq("project_id", selectedProject)
        .eq("is_deleted", false);
      inspQ = applyCompanyFilter(inspQ);

      const actP = supabase
        .from("safety_inspection_actions" as any)
        .select("id, status")
        .eq("project_id", selectedProject);

      const runsP = supabase
        .from("assessment_runs")
        .select("id, status, created_by, author_user_id, target_company_ids")
        .eq("project_id", selectedProject)
        .eq("is_deleted", false)
        .neq("status", "폐기");

      const entryP = supabase
        .from("worker_entry_logs")
        .select("id, entry_at, exit_at, worker_id")
        .eq("project_id", selectedProject)
        .gte("entry_at", dayRange.start)
        .lte("entry_at", dayRange.end);

      const zoneP = showOpsWide
        ? supabase
            .from("worker_zone_events")
            .select("id", { count: "exact", head: true })
            .eq("project_id", selectedProject)
            .eq("acknowledged", false)
        : Promise.resolve({ count: 0 } as any);

      const scP = showOpsWide
        ? supabase
            .from("safety_cost_violations" as any)
            .select("id", { count: "exact", head: true })
            .eq("project_id", selectedProject)
            .eq("is_deleted", false)
            .is("resolved_at", null)
        : Promise.resolve({ count: 0 } as any);

      const pendingP = user?.id
        ? supabase.rpc("get_my_pending_entity_approvals")
        : Promise.resolve({ data: [] as any[] });

      const [
        permitRes, wpRes, todoRes, tbmRes, runsRes, entryRes, zoneRes, scRes, pendingRes, inspRes, actRes,
      ] = await Promise.all([
        permitQ, wpQ, todoQ, tbmQ, runsP, entryP, zoneP, scP, pendingP, inspQ, actP,
      ]);

      const permits = (permitRes.data || []) as Array<{ status?: string }>;
      const permitSum = summarizePermits(permits);
      const workPlans = (wpRes.data || []) as Array<{ status?: string }>;
      const planSum = summarizeWorkPlans(workPlans);
      const todos = (todoRes.data || []) as Array<{ status?: string; frequency?: string }>;
      const todoOpenDaily = todos.filter((t) => t.frequency === "daily" && t.status !== "완료").length;

      const rawLogs = (entryRes.data || []) as Array<{
        entry_at?: string | null;
        exit_at?: string | null;
        worker_id?: string | null;
      }>;
      let scopedLogs = rawLogs;
      if (!seesAllCompanies && rawLogs.length) {
        const workerIds = [...new Set(rawLogs.map((l) => l.worker_id).filter(Boolean))] as string[];
        if (workerIds.length) {
          let wq: any = supabase.from("workers").select("id").in("id", workerIds);
          wq = applyCompanyFilter(wq);
          const { data: ws } = await wq;
          const allowed = new Set((ws || []).map((w: { id: string }) => w.id));
          scopedLogs = rawLogs.filter((l) => l.worker_id && allowed.has(l.worker_id));
        } else {
          scopedLogs = [];
        }
      }
      const { todayEntries, onSiteWorkers } = countOnSite(scopedLogs);
      const todayTbm = ((tbmRes.data || []) as any[]).length;
      const zoneAlerts = zoneRes.count || 0;
      const safetyCostViolations = scRes.count || 0;
      const myPending = Array.isArray(pendingRes.data) ? pendingRes.data.length : 0;

      const rawRuns = (runsRes.data || []) as Array<{
        id: string;
        status?: string;
        created_by?: string | null;
        author_user_id?: string | null;
        target_company_ids?: string[] | null;
      }>;
      let authorCompanyIdByUser: Record<string, string> = {};
      try {
        authorCompanyIdByUser = await authorCompanyIdsForRuns(selectedProject, rawRuns);
      } catch {
        authorCompanyIdByUser = {};
      }
      const activeRuns = filterRunsByCompanyScope(rawRuns, {
        userId: user?.id,
        accessibleCompanyIds,
        authorCompanyIdByUser,
      });
      const runIds = activeRuns.map((r) => r.id);
      const approvedRuns = activeRuns.filter((r) => r.status === "승인완료").length;
      let residualHigh = 0;
      let topRisks: TopRisk[] = [];
      let raFeedbackUnresolved = 0;
      let totalItems = 0;

      if (runIds.length) {
        const { data: riskItems } = await supabase
          .from("risk_items")
          .select("id, process, sub_task, hazard, risk_grade, improved_risk_grade, status, department, is_deleted, is_excluded")
          .in("run_id", runIds)
          .eq("is_deleted", false);
        const items = (riskItems || []).filter((i) => isActiveRiskItem(i));
        totalItems = items.length;
        residualHigh = items.filter((i) => i.improved_risk_grade === "상").length;
        topRisks = [...items]
          .filter((i) => i.improved_risk_grade === "상")
          .slice(0, 5);

        const approvedRunIds = activeRuns.filter((r) => r.status === "승인완료").map((r) => r.id);
        if (approvedRunIds.length) {
          const { count } = await supabase
            .from("risk_item_feedback")
            .select("id", { count: "exact", head: true })
            .eq("project_id", selectedProject)
            .in("assessment_run_id", approvedRunIds)
            .eq("status", "미조치");
          raFeedbackUnresolved = count || 0;
        }
      }

      const rawInsps = (inspRes.data || []) as Array<{ status?: string }>;
      const rawActs = (actRes.data || []) as Array<{ status?: string }>;
      const openActions = rawActs.filter((a) => isOpenInspectionAction(a.status)).length;
      const completedInsps = rawInsps.filter((i) => i.status === 'completed' || i.status === '완료').length;
      const inProgressInsps = rawInsps.length - completedInsps;
      const inspectionSum: InspectionSum = {
        total: rawInsps.length,
        inProgress: inProgressInsps,
        completed: completedInsps,
        openActions,
      };

      const attention = buildAttentionItems({
        myPendingApprovals: myPending,
        permitDraft: permitSum.draft,
        permitInApproval: permitSum.inApproval,
        permitClosurePending: permitSum.closurePending,
        permitRejected: permitSum.rejected,
        todoOpenDaily,
        zoneAlerts,
        safetyCostViolations,
        raFeedbackUnresolved,
        residualHigh,
        showSafetyCost: showOpsWide,
        showZone: showOpsWide,
        inspectionOpenActions: openActions,
      });

      const nextData: DashboardData = {
        attention,
        pulse: {
          onSiteWorkers,
          todayEntries,
          todayTbm,
          activePermits: permitSum.active,
          draftPermits: permitSum.draft,
          approvalPendingPermits: permitSum.inApproval,
          workPlans: workPlans.length,
          zoneAlerts,
          openInspectionActions: openActions,
        },
        residualHigh,
        topRisks,
        raFeedbackUnresolved,
        totalRuns: activeRuns.length,
        approvedRuns,
        totalItems,
        planSum,
        permitSum,
        inspectionSum,
      };

      dashboardCache.set(selectedProject, { data: nextData, timestamp: Date.now() });
      setData(nextData);
    } finally {
      setLoading(false);
    }
  }, [selectedProject, applyCompanyFilter, showOpsWide, user?.id, accessibleCompanyIds, seesAllCompanies, scopeStatus]);

  useEffect(() => {
    if (accessLoading || scopeStatus !== "ready") return;
    fetchDashboard(false);
  }, [fetchDashboard, accessLoading, scopeStatus]);

  useEffect(() => {
    if (!selectedProject) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void fetchDashboard(true);
      }, 3000);
    };

    // 긴급작업·허가서·TBM 등 신규 변동이 생기면 백그라운드에서 실시간 동기화
    const channel = supabase
      .channel(`dashboard-ops-${selectedProject}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_permits" }, debouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "tbm_sessions" }, debouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "todo_items" }, debouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "assessment_runs" }, debouncedFetch)
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [selectedProject, fetchDashboard]);

  const currentProject = projects.find((p) => p.id === selectedProject);

  const pulseTiles = useMemo(() => {
    const tiles = [
      { label: "현장 체류", value: data.pulse.onSiteWorkers, hint: `금일 출역 ${data.pulse.todayEntries}`, path: "/workers?tab=attendance&status=inside", icon: HardHat, danger: false },
      { label: "금일 출역", value: data.pulse.todayEntries, hint: "오늘 입퇴장", path: "/workers?tab=attendance", icon: HardHat, danger: false },
      { label: "금일 TBM", value: data.pulse.todayTbm, hint: "오늘 작성된 TBM", path: "/tbm-logs?date=today", icon: ClipboardCheck, danger: false },
      { label: "작업허가(PTW)", value: data.permitSum.active, hint: `승인·가동 중 (${data.permitSum.total}건 등록)`, path: "/work-permits?status=issued&period=all", icon: FileSignature, danger: false },
      { label: "미조치 지적", value: data.inspectionSum.openActions, hint: data.inspectionSum.openActions > 0 ? "현장 시정 조치 필요" : "지적사항 없음", path: "/safety-inspections?tab=actions", icon: ShieldAlert, danger: data.inspectionSum.openActions > 0 },
    ];
    if (showOpsWide) {
      tiles.push({
        label: "구역 경보",
        value: data.pulse.zoneAlerts,
        hint: "미확인",
        path: "/zone-events?ack=open",
        icon: MapPin,
        danger: data.pulse.zoneAlerts > 0,
      });
    }
    return tiles;
  }, [data.pulse, data.permitSum, data.inspectionSum, showOpsWide]);

  if (loading || accessLoading || scopeStatus !== "ready") {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">데이터 로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between gap-3 pb-1 border-b border-border/60">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground">현장 운영 현황</h1>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {currentProject
              ? formatSiteLabel(currentProject.name, currentProject.site_name)
              : "프로젝트를 선택하세요"}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0" onClick={() => fetchDashboard(true)} title="새로고침">
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">새로고침</span>
        </Button>
      </div>

      {selectedProject && <WeatherSummaryCard projectId={selectedProject} />}

      {/* 오늘 확인할 일 (긴급도 좌측 레일 기반 액션 패널) */}
      <section className="space-y-2.5">
        <SectionLabel>오늘 확인할 일</SectionLabel>
        {data.attention.length === 0 ? (
          <div className="rounded-lg border bg-card px-4 py-3.5 flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-success/10 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-4 w-4 text-success" />
            </div>
            <p className="text-sm font-medium text-foreground">오늘 확인할 일이 없습니다</p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card divide-y divide-border overflow-hidden">
            {data.attention.map((item) => {
              const railClass =
                item.severity === "critical"
                  ? "border-l-4 border-l-destructive"
                  : item.severity === "warning"
                  ? "border-l-4 border-l-warning"
                  : "border-l-4 border-l-border";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className={`w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors flex items-center gap-3 ${railClass}`}
                >
                  <Badge variant={severityBadgeVariant(item.severity)} className="shrink-0 tabular-nums">
                    {item.count}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{item.label}</p>
                    {item.detail && <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.detail}</p>}
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 통합 현장 핵심 지표 바 (반응형 셀 경계: gap-px bg-border) */}
      <section className="space-y-2" aria-label="현장 숫자">
        <SectionLabel>현장 숫자</SectionLabel>
        <div
          className={`rounded-md border border-border bg-border grid grid-cols-2 sm:grid-cols-3 ${
            pulseTiles.length >= 6 ? "lg:grid-cols-6" : "lg:grid-cols-5"
          } gap-px overflow-hidden`}
        >
          {pulseTiles.map((tile, idx) => {
            const spanLastFive =
              pulseTiles.length === 5 && idx === 4 ? "col-span-2 sm:col-span-2 lg:col-span-1" : "";
            return (
              <button
                key={tile.label}
                type="button"
                onClick={() => navigate(tile.path)}
                className={`bg-card px-4 py-3 text-left hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${spanLastFive}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground font-semibold">{tile.label}</span>
                  <tile.icon className={`h-3.5 w-3.5 shrink-0 ${tile.danger ? "text-destructive" : "text-muted-foreground/80"}`} />
                </div>
                <p className={`text-2xl font-bold tabular-nums tracking-tight mt-1 ${tile.danger ? "text-destructive" : "text-foreground"}`}>
                  {tile.value}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{tile.hint}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* 오늘 진행 중인 고위험 작업허가(PTW) 목록 */}
      <SiteSafetyRiskControlHub
        projectId={selectedProject}
        onNavigate={navigate}
        companyId={userCompanyId || profile?.company_id}
        companyType={userCompanyType}
        seesAllCompanies={seesAllCompanies || userCompanyType === 'client'}
        refreshKey={refreshKey}
        section="permits"
      />

      {/* 인허가 · 서류 · 안전점검 통합 현황표 (13개 분산 타일을 1개 업무 매트릭스로 압축) */}
      <section className="space-y-2.5">
        <SectionLabel>인허가 · 서류 · 안전점검 현황</SectionLabel>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="text-left font-semibold px-4 py-2.5 w-44">업무 구분</th>
                  <th className="text-left font-semibold px-4 py-2.5">상태별 건수 (클릭 시 이동)</th>
                  <th className="text-right font-semibold px-4 py-2.5 w-24">등록 문서</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="hover:bg-muted/20" aria-label="작업계획서 현황">
                  <td className="px-4 py-3 font-semibold text-foreground">
                    <button type="button" onClick={() => navigate("/work-plans")} className="flex items-center gap-2 hover:text-primary">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      작업계획서
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip label="작성중" value={data.planSum.draft} onClick={() => navigate("/work-plans?status=작성중")} />
                      <StatusChip label="결재중" value={data.planSum.inApproval} onClick={() => navigate("/work-plans?status=결재중")} tone="warning" />
                      <StatusChip label="승인완료" value={data.planSum.approved} onClick={() => navigate("/work-plans?status=승인완료")} tone="success" />
                      <StatusChip label="반려" value={data.planSum.rejected} onClick={() => navigate("/work-plans?status=반려")} tone={data.planSum.rejected > 0 ? "danger" : "neutral"} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{data.planSum.total}</td>
                </tr>

                <tr className="hover:bg-muted/20" aria-label="허가서 발행 현황">
                  <td className="px-4 py-3 font-semibold text-foreground">
                    <button type="button" onClick={() => navigate("/work-permits")} className="flex items-center gap-2 hover:text-primary">
                      <FileSignature className="h-4 w-4 text-muted-foreground" />
                      작업허가서 (PTW)
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip label="작성중" value={data.permitSum.draft} onClick={() => navigate("/work-permits?status=draft&period=all")} />
                      <StatusChip label="결재중" value={data.permitSum.inApproval} onClick={() => navigate("/work-permits?status=in_approval&period=all")} tone="warning" />
                      <StatusChip label="발행" value={data.permitSum.active} onClick={() => navigate("/work-permits?status=issued&period=all")} tone="success" />
                      <StatusChip label="종료 대기" value={data.permitSum.closurePending} onClick={() => navigate("/work-permits?status=closure_pending&period=all")} tone={data.permitSum.closurePending > 0 ? "warning" : "neutral"} />
                      <StatusChip label="반려" value={data.permitSum.rejected} onClick={() => navigate("/work-permits?status=rejected&period=all")} tone={data.permitSum.rejected > 0 ? "danger" : "neutral"} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{data.permitSum.total}</td>
                </tr>

                <tr className="hover:bg-muted/20" aria-label="안전점검 및 조치 현황">
                  <td className="px-4 py-3 font-semibold text-foreground">
                    <button type="button" onClick={() => navigate("/safety-inspections")} className="flex items-center gap-2 hover:text-primary">
                      <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                      안전점검 · 시정조치
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip label="진행중" value={data.inspectionSum.inProgress} onClick={() => navigate("/safety-inspections?status=in_progress")} tone="warning" />
                      <StatusChip label="점검 완료" value={data.inspectionSum.completed} onClick={() => navigate("/safety-inspections?status=completed")} tone="success" />
                      <StatusChip
                        label="미조치 지적(시정조치)"
                        value={data.inspectionSum.openActions}
                        onClick={() => navigate("/safety-inspections?tab=actions")}
                        tone={data.inspectionSum.openActions > 0 ? "danger" : "neutral"}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{data.inspectionSum.total}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* 위험성평가 요약 및 개선 후 상 잔여 위험 */}
      <section className="space-y-2.5">
        <SectionLabel>위험성평가</SectionLabel>
        <Card className="overflow-hidden">
          <div className="px-4 py-3 bg-muted/30 border-b flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip label="전체 회차" value={data.totalRuns} onClick={() => navigate("/risk-assessment")} />
              <StatusChip label="승인 회차" value={data.approvedRuns} onClick={() => navigate("/risk-assessment?status=승인완료")} tone="success" />
              <StatusChip label="평가항목" value={data.totalItems} onClick={() => navigate("/risk-assessment")} />
              <StatusChip
                label="미조치 피드백"
                value={data.raFeedbackUnresolved}
                onClick={() => navigate("/risk-assessment?focus=feedback")}
                tone={data.raFeedbackUnresolved > 0 ? "danger" : "neutral"}
              />
              <StatusChip
                label="개선후 상"
                value={data.residualHigh}
                onClick={() => navigate("/risk-assessment?focus=residual")}
                tone={data.residualHigh > 0 ? "danger" : "neutral"}
              />
            </div>
            <Button variant="ghost" size="sm" className="text-xs gap-1 h-7" onClick={() => navigate("/risk-assessment?focus=residual")}>
              전체 보기 <ArrowRight className="h-3 w-3" />
            </Button>
          </div>

          {data.topRisks.length > 0 ? (
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full data-table text-sm">
                <thead>
                  <tr>
                    <th className="pl-4">공정</th>
                    <th>위험요인</th>
                    <th className="text-center">위험도</th>
                    <th className="text-center">개선후</th>
                    <th className="text-center pr-4">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topRisks.map((item) => (
                    <tr key={item.id}>
                      <td className="font-medium pl-4">{item.process}</td>
                      <td className="max-w-[260px] truncate">{item.hazard}</td>
                      <td className="text-center">
                        <span className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs font-bold ${getGradeClassName(item.risk_grade || "중")}`}>
                          {item.risk_grade || "중"}
                        </span>
                      </td>
                      <td className="text-center">
                        <span className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs font-bold ${getGradeClassName(item.improved_risk_grade || "하")}`}>
                          {item.improved_risk_grade || "하"}
                        </span>
                      </td>
                      <td className="text-center pr-4">
                        <Badge variant={item.status === "완료" ? "default" : "outline"} className="text-[10px]">
                          {item.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          ) : (
            <div className="px-4 py-4 text-xs text-muted-foreground">
              개선 후 &apos;상&apos; 등급으로 남아 있는 위험요인이 없습니다.
            </div>
          )}
        </Card>
      </section>

      {/* 위험성평가 4분면 매트릭스 */}
      <SiteSafetyRiskControlHub
        projectId={selectedProject}
        onNavigate={navigate}
        companyId={userCompanyId || profile?.company_id}
        companyType={userCompanyType}
        seesAllCompanies={seesAllCompanies || userCompanyType === 'client'}
        refreshKey={refreshKey}
        section="matrix"
      />
    </div>
  );
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-xs font-bold text-muted-foreground">{children}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function severityBadgeVariant(s: AttentionItem["severity"]): "destructive" | "secondary" | "outline" {
  if (s === "critical") return "destructive";
  if (s === "warning") return "secondary";
  return "outline";
}

function StatusChip({
  label,
  value,
  onClick,
  tone = "neutral",
}: {
  label: string;
  value: number;
  onClick: () => void;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const isZero = value === 0;
  const valueTone = isZero
    ? "text-muted-foreground"
    : tone === "danger"
    ? "text-destructive"
    : tone === "warning"
    ? "text-amber-600 dark:text-amber-400"
    : tone === "success"
    ? "text-success"
    : "text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
        isZero
          ? "border-border/50 bg-transparent text-muted-foreground/80 hover:bg-muted/30"
          : "border-border bg-background hover:border-primary/50 hover:bg-muted/50"
      }`}
    >
      <span className="font-medium">{label}</span>
      <span className={`font-bold tabular-nums ${valueTone}`}>{value}</span>
    </button>
  );
}

function WeatherSummaryCard({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [weather, setWeather] = useState<any>(null);
  const [wLoading, setWLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    const fetchWeather = async () => {
      try {
        const { data: project } = await supabase
          .from("projects")
          .select("site_lat, site_lng, site_address, site_name")
          .eq("id", projectId)
          .single();
        let lat = (project as any)?.site_lat;
        let lng = (project as any)?.site_lng;
        const address = (project as any)?.site_address || "";
        const siteName = (project as any)?.site_name || "";

        if ((!lat || !lng) && (address || siteName)) {
          const geo = await geocodeKoreanAddress(address || siteName);
          if (geo) {
            lat = geo.lat;
            lng = geo.lng;
            syncProjectCoordinates(projectId, address || siteName).catch(() => {});
          }
        }

        lat = lat || 37.5665;
        lng = lng || 126.978;

        try {
          const { data, error } = await supabase.functions.invoke("fetch-weather", {
            body: { project_id: projectId, lat, lng, address: address || undefined },
          });
          if (!error && data?.current) {
            setWeather(data);
            return;
          }
        } catch {
          // edge function failover
        }

        const live = await fetchLiveWeatherData(lat, lng, { lat, lng, city: siteName || "현장", address });
        setWeather(live);
      } catch {
        // silent fail
      } finally {
        setWLoading(false);
      }
    };
    fetchWeather();
  }, [projectId]);

  if (wLoading) {
    return (
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-muted animate-pulse" />
            <div className="space-y-2 flex-1">
              <div className="h-4 w-32 bg-muted animate-pulse rounded" />
              <div className="h-3 w-48 bg-muted animate-pulse rounded" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!weather?.current) return null;

  const hasWarning = weather.alerts?.some((a: any) => a.level === "danger" || a.level === "warning");

  return (
    <Card
      className={`cursor-pointer transition-colors hover:bg-accent/30 ${hasWarning ? "border-warning/50" : ""}`}
      onClick={() => navigate("/site-weather")}
    >
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
            {weather.current.main === "Rain" ? <CloudRain className="h-6 w-6 text-blue-400" /> :
              weather.current.main === "Clear" ? <Sun className="h-6 w-6 text-amber-400" /> :
                <Cloud className="h-6 w-6 text-slate-400" />}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold">{weather.current.temp}°C</span>
              <span className="text-sm text-muted-foreground">{weather.current.description}</span>
              <span className="text-xs text-muted-foreground ml-auto">체감 {weather.current.feels_like}°C</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
              <span className="flex items-center gap-1"><Wind className="h-3 w-3" />{weather.current.wind_speed}m/s</span>
              <span className="flex items-center gap-1"><Thermometer className="h-3 w-3" />습도 {weather.current.humidity}%</span>
              {weather.current.rain_1h > 0 && (
                <span className="flex items-center gap-1 text-blue-500"><CloudRain className="h-3 w-3" />{weather.current.rain_1h}mm/h</span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {weather.alerts?.filter((a: any) => a.level !== "safe").slice(0, 2).map((a: any, i: number) => (
              <Badge key={i} variant={a.level === "danger" ? "destructive" : "outline"} className={`text-[10px] ${a.level === "warning" ? "bg-warning/20 text-warning border-warning" : ""}`}>
                {a.title}
              </Badge>
            ))}
            {!hasWarning && (
              <Badge className="bg-success/20 text-success border-success text-[10px]" variant="outline">안전</Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default Dashboard;
