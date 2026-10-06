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
} from "lucide-react";

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
};

const EMPTY_PLAN: StatusBucket = { draft: 0, inApproval: 0, approved: 0, rejected: 0, total: 0 };
const EMPTY_PERMIT: PermitSum = { draft: 0, inApproval: 0, active: 0, closurePending: 0, rejected: 0, total: 0 };
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
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    projects, selectedProject,
    applyCompanyFilter, loading: accessLoading, seesAllCompanies,
    accessibleCompanyIds, scopeStatus,
  } = useGlobalProjectAccess();
  // Ops-wide tiles = project-wide company visibility only (발주처 PA·SM / master)
  const showOpsWide = seesAllCompanies;
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    if (!selectedProject || scopeStatus !== "ready") return;
    setLoading(true);
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
        permitRes, wpRes, todoRes, tbmRes, runsRes, entryRes, zoneRes, scRes, pendingRes,
      ] = await Promise.all([
        permitQ, wpQ, todoQ, tbmQ, runsP, entryP, zoneP, scP, pendingP,
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
      });

      setData({
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
        },
        residualHigh,
        topRisks,
        raFeedbackUnresolved,
        totalRuns: activeRuns.length,
        approvedRuns,
        totalItems,
        planSum,
        permitSum,
      });
    } finally {
      setLoading(false);
    }
  }, [selectedProject, applyCompanyFilter, showOpsWide, user?.id, accessibleCompanyIds, seesAllCompanies, scopeStatus]);

  useEffect(() => {
    if (accessLoading || scopeStatus !== "ready") return;
    fetchDashboard();
  }, [fetchDashboard, accessLoading, scopeStatus]);

  useEffect(() => {
    const onFocus = () => { fetchDashboard(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchDashboard]);

  useEffect(() => {
    if (!selectedProject) return;
    const channel = supabase
      .channel(`dashboard-ops-${selectedProject}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_permits" }, () => fetchDashboard())
      .on("postgres_changes", { event: "*", schema: "public", table: "tbm_sessions" }, () => fetchDashboard())
      .on("postgres_changes", { event: "*", schema: "public", table: "todo_items" }, () => fetchDashboard())
      .on("postgres_changes", { event: "*", schema: "public", table: "assessment_runs" }, () => fetchDashboard())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedProject, fetchDashboard]);

  const currentProject = projects.find((p) => p.id === selectedProject);

  const pulseTiles = useMemo(() => {
    const tiles = [
      { label: "현장 체류", value: data.pulse.onSiteWorkers, hint: `금일 출역 ${data.pulse.todayEntries}`, path: "/workers?tab=attendance", icon: HardHat },
      { label: "금일 출역", value: data.pulse.todayEntries, hint: "오늘 입퇴장", path: "/workers?tab=attendance", icon: HardHat },
      { label: "금일 TBM", value: data.pulse.todayTbm, hint: "오늘 작성된 TBM", path: "/tbm-logs", icon: ClipboardCheck },
    ];
    if (showOpsWide) {
      tiles.push({
        label: "구역 경보",
        value: data.pulse.zoneAlerts,
        hint: "미확인",
        path: "/zone-events",
        icon: MapPin,
      });
    }
    return tiles;
  }, [data.pulse, showOpsWide]);

  if (loading || accessLoading || scopeStatus !== "ready") {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">데이터 로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">현장 운영 현황</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {currentProject
              ? formatSiteLabel(currentProject.name, currentProject.site_name)
              : "프로젝트를 선택하세요"}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => fetchDashboard()} title="새로고침">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {selectedProject && <WeatherSummaryCard projectId={selectedProject} />}

      {/* Attention / action needed */}
      <section className="space-y-3">
        <SectionLabel>오늘 확인할 일</SectionLabel>
        {data.attention.length === 0 ? (
          <Card>
            <CardContent className="py-6 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-sm font-medium">오늘 확인할 일이 없습니다</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {data.attention.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.path)}
                className="text-left rounded-lg border bg-card p-3 hover:border-primary/40 transition-colors flex items-start gap-3"
              >
                <Badge variant={severityBadgeVariant(item.severity)} className="mt-0.5 shrink-0">
                  {item.count}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{item.label}</p>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </div>
                  {item.detail && <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Site pulse */}
      <section className="space-y-3">
        <SectionLabel>현장 숫자</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {pulseTiles.map((tile) => (
            <button
              key={tile.label}
              type="button"
              onClick={() => navigate(tile.path)}
              className="rounded-lg border bg-card p-3 text-left hover:border-primary/40 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium">{tile.label}</span>
                <tile.icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <p className="text-2xl font-bold tabular-nums">{tile.value}</p>
              <p className="text-[11px] text-muted-foreground mt-1 truncate">{tile.hint}</p>
            </button>
          ))}
        </div>
      </section>

      <section>
        <button
          type="button"
          onClick={() => navigate("/ai-assistant")}
          className="w-full text-left rounded-lg border bg-card p-4 hover:border-primary/40 transition-colors flex items-center gap-3"
        >
          <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">AI 어시스턴트</p>
            <p className="text-xs text-muted-foreground mt-0.5">공정·위험·대책을 이 화면에서 이어서 확인합니다.</p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </section>

      <section className="space-y-3">
        <SectionLabel>위험성평가</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 cursor-pointer" onClick={() => navigate("/risk-assessment")}>
          <KpiCard label="회차" value={data.totalRuns} icon={<ClipboardList className="h-4 w-4 text-primary" />} />
          <KpiCard label="승인 회차" value={data.approvedRuns} icon={<ShieldCheck className="h-4 w-4 text-primary" />} />
          <KpiCard label="평가항목" value={data.totalItems} icon={<ShieldAlert className="h-4 w-4 text-primary" />} />
          <KpiCard
            label="미조치 피드백"
            value={data.raFeedbackUnresolved}
            valueColor={data.raFeedbackUnresolved > 0 ? "text-destructive" : undefined}
            icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          />
          <KpiCard
            label="개선후 상"
            value={data.residualHigh}
            valueColor={data.residualHigh > 0 ? "text-destructive" : undefined}
            icon={<ShieldCheck className="h-4 w-4 text-warning" />}
          />
        </div>
        {data.topRisks.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" /> 개선 후 상
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => navigate("/risk-assessment")}>
                    전체 보기 <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full data-table text-sm">
                  <thead>
                    <tr>
                      <th>공정</th>
                      <th>위험요인</th>
                      <th className="text-center">위험도</th>
                      <th className="text-center">개선후</th>
                      <th className="text-center">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topRisks.map((item) => (
                      <tr key={item.id}>
                        <td className="font-medium">{item.process}</td>
                        <td className="max-w-[220px] truncate">{item.hazard}</td>
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
                        <td className="text-center">
                          <Badge variant={item.status === "완료" ? "default" : "outline"} className="text-[10px]">
                            {item.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
        )}
      </section>

      <section className="space-y-3">
        <SectionLabel>작업계획서</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatusTile label="작성중" value={data.planSum.draft} path="/work-plans" icon={FileText} />
          <StatusTile label="결재중" value={data.planSum.inApproval} path="/work-plans" icon={FileText} />
          <StatusTile label="승인완료" value={data.planSum.approved} path="/work-plans" icon={FileText} />
          <StatusTile label="반려" value={data.planSum.rejected} path="/work-plans" icon={FileText} />
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>허가서 발행 현황</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatusTile label="작성중" value={data.permitSum.draft} path="/work-permits" icon={FileSignature} />
          <StatusTile label="결재중" value={data.permitSum.inApproval} path="/work-permits" icon={FileSignature} />
          <StatusTile label="발행" value={data.permitSum.active} path="/work-permits" icon={FileSignature} />
          <StatusTile label="종료 대기" value={data.permitSum.closurePending} path="/work-permits" icon={FileSignature} />
          <StatusTile label="반려" value={data.permitSum.rejected} path="/work-permits" icon={FileSignature} />
        </div>
      </section>
    </div>
  );
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{children}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function severityBadgeVariant(s: AttentionItem["severity"]): "destructive" | "secondary" | "outline" {
  if (s === "critical") return "destructive";
  if (s === "warning") return "secondary";
  return "outline";
}

function KpiCard({
  label, value, icon, valueColor,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className={`text-xl font-bold mt-1 tabular-nums ${valueColor || "text-foreground"}`}>{value}</p>
          </div>
          <div className="h-8 w-8 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusTile({
  label, value, path, icon: Icon,
}: {
  label: string;
  value: number;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(path)}
      className="rounded-lg border bg-card p-3 text-left hover:border-primary/40 transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
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
          .select("site_lat, site_lng, site_address")
          .eq("id", projectId)
          .single();
        const lat = (project as any)?.site_lat || 37.5665;
        const lng = (project as any)?.site_lng || 126.978;
        const address = (project as any)?.site_address || undefined;
        const { data } = await supabase.functions.invoke("fetch-weather", {
          body: { project_id: projectId, lat, lng, address },
        });
        setWeather(data);
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
