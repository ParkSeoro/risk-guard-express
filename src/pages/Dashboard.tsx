import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getGradeClassName } from "@/lib/riskGrade";
import {
  buildAttentionItems,
  countOnSite,
  summarizePermits,
  todayKstDate,
  type AttentionItem,
  type SitePulse,
} from "@/lib/dashboardOps";
import {
  AlertTriangle, CheckCircle2, ShieldAlert, FileCheck,
  ClipboardList, ShieldCheck, ArrowRight, RefreshCw,
  FileText, ListTodo, Scale, Cloud, CloudRain, Wind, Thermometer, Sun,
  FileSignature, Bot, Users, History, MapPin, HardHat, ClipboardCheck,
  FolderKanban,
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

type DutyRate = { total: number; done: number; rate: number };

type DashboardData = {
  attention: AttentionItem[];
  pulse: SitePulse;
  legalDutyDaily: DutyRate;
  legalDutyWeekly: DutyRate;
  legalDutyMonthly: DutyRate;
  todoCompletionRate: number;
  todoCompleted: number;
  todoTotal: number;
  residualHigh: number;
  topRisks: TopRisk[];
  raFeedbackUnresolved: number;
  totalRuns: number;
  totalItems: number;
};

const EMPTY_DUTY: DutyRate = { total: 0, done: 0, rate: 0 };
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
  legalDutyDaily: EMPTY_DUTY,
  legalDutyWeekly: EMPTY_DUTY,
  legalDutyMonthly: EMPTY_DUTY,
  todoCompletionRate: 0,
  todoCompleted: 0,
  todoTotal: 0,
  residualHigh: 0,
  topRisks: [],
  raFeedbackUnresolved: 0,
  totalRuns: 0,
  totalItems: 0,
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    projects, selectedProject,
    userCompanyType, isMaster, isProjectAdmin, isContractor, isWorker,
    applyCompanyFilter, loading: accessLoading,
  } = useGlobalProjectAccess();
  const isContractorCo = !isMaster && (userCompanyType === "contractor" || userCompanyType === "vendor");
  const showOpsWide = isMaster || isProjectAdmin;
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    const today = todayKstDate();

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
        .select("id, status")
        .eq("project_id", selectedProject)
        .eq("is_deleted", false)
        .neq("status", "폐기");

      const entryP = supabase
        .from("worker_entry_logs")
        .select("id, entry_at, exit_at")
        .eq("project_id", selectedProject)
        .gte("entry_at", `${today}T00:00:00`)
        .lte("entry_at", `${today}T23:59:59`);

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
      const workPlans = (wpRes.data || []) as any[];
      const todos = (todoRes.data || []) as Array<{ status?: string; frequency?: string }>;
      const todoCompleted = todos.filter((t) => t.status === "완료").length;
      const calcDuty = (freq: string): DutyRate => {
        const items = todos.filter((t) => t.frequency === freq);
        const done = items.filter((t) => t.status === "완료").length;
        return { total: items.length, done, rate: items.length ? Math.round((done / items.length) * 100) : 0 };
      };
      const todoOpenDaily = todos.filter((t) => t.frequency === "daily" && t.status !== "완료").length;

      const { todayEntries, onSiteWorkers } = countOnSite((entryRes.data || []) as any[]);
      const todayTbm = ((tbmRes.data || []) as any[]).length;
      const zoneAlerts = zoneRes.count || 0;
      const safetyCostViolations = scRes.count || 0;
      const myPending = Array.isArray(pendingRes.data) ? pendingRes.data.length : 0;

      const activeRuns = (runsRes.data || []) as Array<{ id: string; status?: string }>;
      const runIds = activeRuns.map((r) => r.id);
      let residualHigh = 0;
      let topRisks: TopRisk[] = [];
      let raFeedbackUnresolved = 0;
      let totalItems = 0;

      if (runIds.length) {
        const { data: riskItems } = await supabase
          .from("risk_items")
          .select("id, process, sub_task, hazard, risk_grade, improved_risk_grade, status, department")
          .in("run_id", runIds);
        const items = riskItems || [];
        totalItems = items.length;
        residualHigh = items.filter((i) => i.improved_risk_grade === "상").length;
        topRisks = [...items]
          .filter((i) => i.risk_grade === "상" || i.risk_grade === "중")
          .sort((a, b) => {
            const order: Record<string, number> = { 상: 3, 중: 2, 하: 1 };
            return (order[b.risk_grade || ""] || 0) - (order[a.risk_grade || ""] || 0);
          })
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
        legalDutyDaily: calcDuty("daily"),
        legalDutyWeekly: calcDuty("weekly"),
        legalDutyMonthly: calcDuty("monthly"),
        todoCompletionRate: todos.length ? Math.round((todoCompleted / todos.length) * 100) : 0,
        todoCompleted,
        todoTotal: todos.length,
        residualHigh,
        topRisks,
        raFeedbackUnresolved,
        totalRuns: activeRuns.length,
        totalItems,
      });
    } finally {
      setLoading(false);
    }
  }, [selectedProject, applyCompanyFilter, showOpsWide, user?.id]);

  useEffect(() => {
    if (accessLoading) return;
    fetchDashboard();
  }, [fetchDashboard, accessLoading]);

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
  const hasRaBlock = data.totalItems > 0 || data.totalRuns > 0;

  const pulseTiles = useMemo(() => {
    const tiles = [
      { label: "현장 체류", value: data.pulse.onSiteWorkers, hint: `금일 입퇴장 ${data.pulse.todayEntries}`, path: "/workers?tab=attendance", icon: HardHat },
      { label: "금일 TBM", value: data.pulse.todayTbm, hint: "오늘 작성된 TBM", path: "/tbm-logs", icon: ClipboardCheck },
      { label: "진행 허가서", value: data.pulse.activePermits, hint: `작성중 ${data.pulse.draftPermits} · 결재 ${data.pulse.approvalPendingPermits}`, path: "/work-permits", icon: FileSignature },
      { label: "작업계획서", value: data.pulse.workPlans, hint: "등록된 계획", path: "/work-plans", icon: FileText },
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

  if (loading || accessLoading) {
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
              ? `${currentProject.site_name} · ${currentProject.name}`
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
                <p className="text-sm font-medium">급한 조치 항목이 없습니다</p>
                <p className="text-xs text-muted-foreground">결재·허가서·법적업무 신호가 모두 안정적입니다.</p>
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
        <SectionLabel>현장 현황</SectionLabel>
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

      {/* Legal duties + todo */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Scale className="h-4 w-4 text-primary" /> 법적업무 수행률
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "일간", ...data.legalDutyDaily },
                { label: "주간", ...data.legalDutyWeekly },
                { label: "월간", ...data.legalDutyMonthly },
              ].map((d) => (
                <button
                  key={d.label}
                  type="button"
                  className="text-center space-y-1 rounded-md p-1 hover:bg-muted/50"
                  onClick={() => navigate("/todo")}
                >
                  <p className="text-xs text-muted-foreground font-medium">{d.label}</p>
                  <p className={`text-xl font-bold ${d.rate >= 80 ? "text-success" : d.rate >= 50 ? "text-warning" : d.total ? "text-destructive" : "text-muted-foreground"}`}>
                    {d.total ? `${d.rate}%` : "—"}
                  </p>
                  <Progress value={d.total ? d.rate : 0} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground">{d.done}/{d.total}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-primary" /> 할 일
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div>
              <p className="text-3xl font-bold tabular-nums">{data.todoCompletionRate}%</p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.todoCompleted}/{data.todoTotal} 완료
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/todo")} className="gap-1">
              할 일 열기 <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Risk assessment — compact, secondary */}
      {hasRaBlock && (
        <section className="space-y-3">
          <SectionLabel>위험성평가 요약</SectionLabel>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="회차" value={data.totalRuns} icon={<ClipboardList className="h-4 w-4 text-primary" />} />
            <KpiCard label="평가항목" value={data.totalItems} icon={<ShieldAlert className="h-4 w-4 text-primary" />} />
            <KpiCard
              label="미조치 피드백"
              value={data.raFeedbackUnresolved}
              valueColor={data.raFeedbackUnresolved > 0 ? "text-destructive" : undefined}
              icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
            />
            <KpiCard
              label="개선후 상 잔존"
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
                    <AlertTriangle className="h-4 w-4 text-destructive" /> 고위험 항목
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
      )}

      <QuickStartCards
        navigate={navigate}
        isMaster={isMaster}
        isProjectAdmin={isProjectAdmin}
        isContractor={isContractor || isContractorCo}
        isWorker={isWorker}
      />
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

interface QuickStartCardsProps {
  navigate: (path: string) => void;
  isMaster: boolean;
  isProjectAdmin: boolean;
  isContractor: boolean;
  isWorker: boolean;
}

function QuickStartCards({ navigate, isMaster, isProjectAdmin, isContractor, isWorker }: QuickStartCardsProps) {
  type QSItem = { title: string; desc: string; icon: any; path: string; tone: "primary" | "warning" | "success" | "destructive" };

  let items: QSItem[];
  if (isMaster) {
    items = [
      { title: "전자결재", desc: "대기 문서 처리", icon: FileCheck, path: "/approvals", tone: "warning" },
      { title: "프로젝트", desc: "현장·권한 관리", icon: FolderKanban, path: "/projects", tone: "primary" },
      { title: "사용자/권한", desc: "초대 및 권한", icon: Users, path: "/settings/permissions", tone: "success" },
      { title: "감사 로그", desc: "활동 점검", icon: History, path: "/audit-logs", tone: "destructive" },
    ];
  } else if (isProjectAdmin) {
    items = [
      { title: "전자결재", desc: "내가 결재할 문서", icon: FileCheck, path: "/approvals", tone: "warning" },
      { title: "작업허가서", desc: "허가·종료 확인", icon: FileSignature, path: "/work-permits", tone: "destructive" },
      { title: "TBM 일지", desc: "오늘 안전회의", icon: ClipboardCheck, path: "/tbm-logs", tone: "primary" },
      { title: "작업계획서", desc: "계획·첨부 확인", icon: FileText, path: "/work-plans", tone: "success" },
    ];
  } else if (isContractor) {
    items = [
      { title: "작업허가서", desc: "작성·상신", icon: FileSignature, path: "/work-permits", tone: "warning" },
      { title: "TBM 일지", desc: "오늘 TBM 기록", icon: ClipboardCheck, path: "/tbm-logs", tone: "primary" },
      { title: "작업계획서", desc: "계획 등록", icon: FileText, path: "/work-plans", tone: "success" },
      { title: "근로자 명부", desc: "출역 인원", icon: HardHat, path: "/workers", tone: "destructive" },
    ];
  } else if (isWorker) {
    items = [
      { title: "TBM 참여", desc: "서명하기", icon: FileSignature, path: "/tbm-logs", tone: "primary" },
      { title: "내 교육", desc: "이수 확인", icon: ClipboardList, path: "/worker-education", tone: "success" },
      { title: "작업허가서", desc: "배정 작업 확인", icon: FileCheck, path: "/work-permits", tone: "warning" },
      { title: "AI 어시스턴트", desc: "안전 정보", icon: Bot, path: "/ai-assistant", tone: "primary" },
    ];
  } else {
    items = [
      { title: "작업허가서", desc: "현황 조회", icon: FileSignature, path: "/work-permits", tone: "warning" },
      { title: "작업계획서", desc: "계획 조회", icon: FileText, path: "/work-plans", tone: "primary" },
      { title: "TBM 일지", desc: "기록 보기", icon: ClipboardCheck, path: "/tbm-logs", tone: "success" },
      { title: "AI 어시스턴트", desc: "안전 정보", icon: Bot, path: "/ai-assistant", tone: "primary" },
    ];
  }

  const toneClass: Record<QSItem["tone"], string> = {
    primary: "bg-primary/10 text-primary",
    warning: "bg-warning/10 text-warning",
    success: "bg-success/10 text-success",
    destructive: "bg-destructive/10 text-destructive",
  };

  return (
    <section>
      <SectionLabel>바로가기</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        {items.map((it) => (
          <button
            key={it.title}
            type="button"
            onClick={() => navigate(it.path)}
            className="group text-left rounded-lg border border-border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all"
          >
            <div className={`h-9 w-9 rounded-md flex items-center justify-center ${toneClass[it.tone]} mb-3`}>
              <it.icon className="h-4 w-4" />
            </div>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="text-sm font-semibold leading-tight">{it.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{it.desc}</div>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-0.5" />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

export default Dashboard;
