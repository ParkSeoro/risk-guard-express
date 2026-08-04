import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import ContractorDashboard from "@/components/ContractorDashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getGradeClassName } from "@/lib/riskGrade";

import {
  AlertTriangle, CheckCircle2, ShieldAlert, BarChart3, FileCheck,
  ClipboardList, ShieldCheck, Clock, Plus, ArrowRight, RefreshCw,
  FileText, ListTodo, Scale, Cloud, CloudRain, Wind, Thermometer, Sun,
  FileSignature, Bot, Users, History
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie
} from "recharts";

interface FeedbackKPI {
  total: number;
  unresolved: number;
  inProgress: number;
  completed: number;
  completionRate: number;
  byContractor: { name: string; total: number; completed: number; rate: number }[];
}

interface DashboardData {
  totalRuns: number;
  runsByStatus: Record<string, number>;
  totalItems: number;
  preGradeDist: { high: number; med: number; low: number };
  postGradeDist: { high: number; med: number; low: number };
  residualHigh: number;
  itemsByStatus: Record<string, number>;
  validationIssues: number;
  validationConditional: number;
  inApprovalRuns: number;
  approvedRuns: number;
  processData: { name: string; high: number; med: number; low: number }[];
  topRisks: any[];
  feedback: FeedbackKPI;
  // New KPIs
  workPlanCount: number;
  workPlanByStatus: Record<string, number>;
  workPlanExpired: number;
  todoTotal: number;
  todoCompleted: number;
  todoCompletionRate: number;
  // Legal duty rates
  legalDutyDaily: { total: number; done: number; rate: number };
  legalDutyWeekly: { total: number; done: number; rate: number };
  legalDutyMonthly: { total: number; done: number; rate: number };
}

const EMPTY_FEEDBACK: FeedbackKPI = { total: 0, unresolved: 0, inProgress: 0, completed: 0, completionRate: 0, byContractor: [] };
const EMPTY_DUTY_RATE = { total: 0, done: 0, rate: 0 };

const EMPTY: DashboardData = {
  totalRuns: 0, runsByStatus: {}, totalItems: 0,
  preGradeDist: { high: 0, med: 0, low: 0 },
  postGradeDist: { high: 0, med: 0, low: 0 },
  residualHigh: 0, itemsByStatus: {},
  validationIssues: 0, validationConditional: 0,
  inApprovalRuns: 0, approvedRuns: 0,
  processData: [], topRisks: [],
  feedback: EMPTY_FEEDBACK,
  workPlanCount: 0, workPlanByStatus: {}, workPlanExpired: 0,
  todoTotal: 0, todoCompleted: 0, todoCompletionRate: 0,
  legalDutyDaily: EMPTY_DUTY_RATE,
  legalDutyWeekly: EMPTY_DUTY_RATE,
  legalDutyMonthly: EMPTY_DUTY_RATE,
};

const Dashboard = () => {
  const navigate = useNavigate();
  const {
    projects, selectedProject, setSelectedProject,
    userCompanyId, userCompanyType, isMaster, isProjectAdmin, isContractor, isWorker,
    applyCompanyFilter, loading: accessLoading
  } = useGlobalProjectAccess();
  const isContractorCo = !isMaster && (userCompanyType === 'contractor' || userCompanyType === 'vendor');
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);

    // Fetch runs (excluding soft-deleted AND archived).
    // Note: assessment_runs/risk_items are scoped via RLS + run_id chain; they
    // do not carry company_id, so applyCompanyFilter is not applicable here.
    const { data: runs } = await supabase
      .from("assessment_runs")
      .select("id, status, validation_verdict, validation_score")
      .eq("project_id", selectedProject)
      .eq("is_deleted", false)
      .neq("status", "폐기");

    const activeRuns = runs || [];
    const runIds = activeRuns.map((r) => r.id);

    // Fetch risk items ONLY from active runs
    let items: any[] = [];
    if (runIds.length > 0) {
      const { data: riskItems } = await supabase
        .from("risk_items")
        .select("id, process, sub_task, hazard, risk_grade, improved_risk_grade, status, department")
        .in("run_id", runIds);
      items = riskItems || [];
    }

    // Fetch validation results only for active runs
    let valIssues = 0;
    if (runIds.length > 0) {
      const { count } = await supabase
        .from("validation_results")
        .select("id", { count: "exact", head: true })
        .eq("project_id", selectedProject)
        .eq("status", "fail")
        .in("run_id", runIds);
      valIssues = count || 0;
    }

    // Work Plans - with company filter
    let wpQuery = supabase.from("work_plans").select("id, status, end_date").eq("project_id", selectedProject).eq("is_deleted", false);
    wpQuery = applyCompanyFilter(wpQuery);
    const { data: wpData } = await wpQuery;
    const workPlans = wpData || [];
    const workPlanByStatus: Record<string, number> = {};
    let workPlanExpired = 0;
    workPlans.forEach((wp: any) => {
      workPlanByStatus[wp.status] = (workPlanByStatus[wp.status] || 0) + 1;
      if (wp.status === '만료' || (wp.end_date && new Date(wp.end_date) < new Date())) workPlanExpired++;
    });

     // Todo Items - with company filter
    let todoQuery = supabase.from("todo_items").select("id, status, frequency").eq("project_id", selectedProject);
    todoQuery = applyCompanyFilter(todoQuery);
    const { data: todoData } = await todoQuery;
    const todos = todoData || [];
    const todoCompleted = todos.filter((t: any) => t.status === '완료').length;

    // Legal Duty performance rates (based on todo_items by frequency)
    const calcDutyRate = (freq: string) => {
      const items = todos.filter((t: any) => t.frequency === freq);
      const done = items.filter((t: any) => t.status === '완료').length;
      return { total: items.length, done, rate: items.length > 0 ? Math.round((done / items.length) * 100) : 0 };
    };
    const legalDutyDaily = calcDutyRate('daily');
    const legalDutyWeekly = calcDutyRate('weekly');
    const legalDutyMonthly = calcDutyRate('monthly');

    // KPI 1: Run status counts
    const runsByStatus: Record<string, number> = {};
    activeRuns.forEach((r) => { runsByStatus[r.status] = (runsByStatus[r.status] || 0) + 1; });

    // KPI 2: Grade distribution
    const preGradeDist = { high: 0, med: 0, low: 0 };
    const postGradeDist = { high: 0, med: 0, low: 0 };
    let residualHigh = 0;
    const itemsByStatus: Record<string, number> = {};
    const processMap: Record<string, { high: number; med: number; low: number }> = {};

    items.forEach((item) => {
      if (item.risk_grade === "상") preGradeDist.high++;
      else if (item.risk_grade === "중") preGradeDist.med++;
      else preGradeDist.low++;

      if (item.improved_risk_grade === "상") { postGradeDist.high++; residualHigh++; }
      else if (item.improved_risk_grade === "중") postGradeDist.med++;
      else postGradeDist.low++;

      itemsByStatus[item.status] = (itemsByStatus[item.status] || 0) + 1;

      if (!processMap[item.process]) processMap[item.process] = { high: 0, med: 0, low: 0 };
      if (item.risk_grade === "상") processMap[item.process].high++;
      else if (item.risk_grade === "중") processMap[item.process].med++;
      else processMap[item.process].low++;
    });

    const processData = Object.entries(processMap)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.high - a.high || b.med - a.med)
      .slice(0, 10);

    const topRisks = [...items]
      .filter((i) => i.risk_grade === "상" || i.risk_grade === "중")
      .sort((a, b) => {
        const order: Record<string, number> = { "상": 3, "중": 2, "하": 1 };
        return (order[b.risk_grade] || 0) - (order[a.risk_grade] || 0);
      })
      .slice(0, 5);

    const validationConditional = activeRuns.filter((r) => r.validation_verdict === "조건부 적정").length;
    const inApprovalRuns = runsByStatus["결재진행"] || 0;
    const approvedRuns = runsByStatus["승인완료"] || 0;

    // Feedback KPI
    let feedbackKpi: FeedbackKPI = EMPTY_FEEDBACK;
    const approvedRunIds = activeRuns.filter(r => r.status === '승인완료').map(r => r.id);
    if (approvedRunIds.length > 0) {
      const { data: fbData } = await supabase
        .from("risk_item_feedback")
        .select("id, status, risk_item_id, assessment_run_id")
        .eq("project_id", selectedProject)
        .in("assessment_run_id", approvedRunIds);
      const fbItems = fbData || [];
      const fbTotal = fbItems.length;
      const fbCompleted = fbItems.filter(f => f.status === '완료').length;
      const fbInProgress = fbItems.filter(f => f.status === '진행중').length;
      const fbUnresolved = fbItems.filter(f => f.status === '미조치').length;

      const fbRiskItemIds = [...new Set(fbItems.map(f => f.risk_item_id).filter(Boolean))];
      let byContractor: FeedbackKPI['byContractor'] = [];
      if (fbRiskItemIds.length > 0) {
        const { data: riData } = await supabase
          .from("risk_items")
          .select("id, department")
          .in("id", fbRiskItemIds.slice(0, 200));
        if (riData) {
          const deptMap: Record<string, { total: number; completed: number }> = {};
          fbItems.forEach(fb => {
            const ri = riData.find(r => r.id === fb.risk_item_id);
            const dept = ri?.department || '미지정';
            if (!deptMap[dept]) deptMap[dept] = { total: 0, completed: 0 };
            deptMap[dept].total++;
            if (fb.status === '완료') deptMap[dept].completed++;
          });
          byContractor = Object.entries(deptMap).map(([name, v]) => ({
            name, total: v.total, completed: v.completed,
            rate: v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0,
          })).sort((a, b) => a.rate - b.rate);
        }
      }

      feedbackKpi = {
        total: fbTotal, unresolved: fbUnresolved, inProgress: fbInProgress,
        completed: fbCompleted,
        completionRate: fbTotal > 0 ? Math.round((fbCompleted / fbTotal) * 100) : 0,
        byContractor,
      };
    }

    setData({
      totalRuns: activeRuns.length,
      runsByStatus,
      totalItems: items.length,
      preGradeDist,
      postGradeDist,
      residualHigh,
      itemsByStatus,
      validationIssues: valIssues,
      validationConditional,
      inApprovalRuns,
      approvedRuns,
      processData,
      topRisks,
      feedback: feedbackKpi,
      workPlanCount: workPlans.length,
      workPlanByStatus,
      workPlanExpired,
      todoTotal: todos.length,
      todoCompleted,
      todoCompletionRate: todos.length > 0 ? Math.round((todoCompleted / todos.length) * 100) : 0,
      legalDutyDaily,
      legalDutyWeekly,
      legalDutyMonthly,
    });
    setLoading(false);
  }, [selectedProject, userCompanyId, isMaster, isProjectAdmin, isContractor, applyCompanyFilter]);

  useEffect(() => {
    if (accessLoading) return;
    fetchDashboard();
  }, [fetchDashboard, accessLoading]);

  // Refetch on window focus
  useEffect(() => {
    const handleFocus = () => { fetchDashboard(); };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchDashboard]);

  // Realtime
  useEffect(() => {
    if (!selectedProject) return;
    const channel = supabase
      .channel(`dashboard-${selectedProject}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'risk_items' }, () => fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assessment_runs' }, () => fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_items' }, () => fetchDashboard())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedProject, fetchDashboard]);

  const currentProject = projects.find((p) => p.id === selectedProject);
  const completedCount = data.itemsByStatus["완료"] || 0;
  const completionRate = data.totalItems > 0 ? Math.round((completedCount / data.totalItems) * 100) : 0;

  const riskDistData = [
    { name: "상", value: data.preGradeDist.high, color: "hsl(var(--risk-high))" },
    { name: "중", value: data.preGradeDist.med, color: "hsl(var(--risk-medium))" },
    { name: "하", value: data.preGradeDist.low, color: "hsl(var(--risk-low))" },
  ];

  const statusData = [
    { name: "미착수", value: (data.itemsByStatus["미착수"] || 0) + (data.itemsByStatus["초안"] || 0), color: "hsl(var(--muted-foreground))" },
    { name: "진행", value: data.itemsByStatus["진행"] || 0, color: "hsl(var(--warning))" },
    { name: "완료", value: completedCount, color: "hsl(var(--success))" },
  ];

  const isEmpty = data.totalRuns === 0 && data.totalItems === 0;

  if (loading || accessLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">데이터 로딩 중...</p>
      </div>
    );
  }

  // 협력사 계정: 단순화된 CTA 대시보드
  if (isContractorCo) {
    return (
      <ContractorDashboard
        siteLabel={currentProject ? `${currentProject.site_name} · ${currentProject.name}` : undefined}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">대시보드</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {currentProject ? `${currentProject.site_name} · ${currentProject.name}` : "프로젝트를 선택하세요"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => fetchDashboard()} title="새로고침">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Quick Start — 역할별 다음 행동 */}
      <QuickStartCards
        navigate={navigate}
        isMaster={isMaster}
        isProjectAdmin={isProjectAdmin}
        isContractor={isContractor}
        isWorker={isWorker}
      />

      <div className="space-y-6">
        {/* Weather Summary Card */}
        <WeatherSummaryCard projectId={selectedProject} />
      {isEmpty ? (
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto">
              <ClipboardList className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">데이터가 없습니다</h3>
              <p className="text-sm text-muted-foreground mt-1">
                평가 회차를 생성하고 위험성평가를 시작하세요.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button size="sm" onClick={() => navigate("/risk-assessment")} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> 회차 생성
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/schedule-upload/" + selectedProject)} className="gap-1.5">
                공정표 업로드
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI Cards Row 1 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="총 회차"
              value={data.totalRuns}
              icon={<ClipboardList className="h-5 w-5 text-primary" />}
              iconBg="bg-primary/10"
              sub={
                <div className="flex gap-2 text-[10px] mt-1 flex-wrap">
                  {Object.entries(data.runsByStatus).slice(0, 3).map(([s, c]) => (
                    <span key={s} className="text-muted-foreground">{s} {c}</span>
                  ))}
                </div>
              }
            />
            <KpiCard
              label="총 평가항목"
              value={data.totalItems}
              icon={<ShieldAlert className="h-5 w-5 text-primary" />}
              iconBg="bg-primary/10"
              sub={
                <div className="flex gap-2 text-[10px] mt-1">
                  <span className="text-destructive font-medium">상 {data.preGradeDist.high}</span>
                  <span className="text-warning font-medium">중 {data.preGradeDist.med}</span>
                  <span className="text-success font-medium">하 {data.preGradeDist.low}</span>
                </div>
              }
            />
            <KpiCard
              label="작업계획서"
              value={data.workPlanCount}
              icon={<FileText className="h-5 w-5 text-primary" />}
              iconBg="bg-primary/10"
              sub={
                <div className="flex gap-2 text-[10px] mt-1 flex-wrap">
                  {Object.entries(data.workPlanByStatus).slice(0, 3).map(([s, c]) => (
                    <span key={s} className="text-muted-foreground">{s} {c}</span>
                  ))}
                  {data.workPlanExpired > 0 && (
                    <span className="text-destructive font-medium">만료 {data.workPlanExpired}</span>
                  )}
                </div>
              }
            />
            <KpiCard
              label="To-Do 완료율"
              value={`${data.todoCompletionRate}%`}
              icon={<ListTodo className="h-5 w-5 text-success" />}
              iconBg="bg-success/10"
              sub={<span className="text-[10px] text-muted-foreground mt-1">{data.todoCompleted}/{data.todoTotal} 완료</span>}
            />
          </div>

          {/* Legal Duty Performance */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Scale className="h-4 w-4 text-primary" /> 법적업무 수행률
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { label: 'Daily', ...data.legalDutyDaily },
                  { label: 'Weekly', ...data.legalDutyWeekly },
                  { label: 'Monthly', ...data.legalDutyMonthly },
                ].map(d => (
                  <div key={d.label} className="text-center space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">{d.label}</p>
                    <p className={`text-2xl font-bold ${d.rate >= 80 ? 'text-success' : d.rate >= 50 ? 'text-warning' : 'text-destructive'}`}>{d.rate}%</p>
                    <Progress value={d.rate} className="h-1.5" />
                    <p className="text-[10px] text-muted-foreground">{d.done}/{d.total}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* KPI Cards Row 2 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="개선 완료율"
              value={`${completionRate}%`}
              icon={<CheckCircle2 className="h-5 w-5 text-success" />}
              iconBg="bg-success/10"
              sub={<span className="text-[10px] text-muted-foreground mt-1">{completedCount}/{data.totalItems} 완료</span>}
            />
            <KpiCard
              label="개선후 '상' 잔존"
              value={data.residualHigh}
              valueColor={data.residualHigh > 0 ? "text-destructive" : "text-foreground"}
              icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
              iconBg="bg-destructive/10"
            />
            <KpiCard
              label="결재 진행"
              value={data.inApprovalRuns}
              icon={<FileCheck className="h-5 w-5 text-primary" />}
              iconBg="bg-primary/10"
            />
            <KpiCard
              label="부적정 건수"
              value={data.validationIssues}
              valueColor={data.validationIssues > 0 ? "text-destructive" : "text-foreground"}
              icon={<ShieldCheck className="h-5 w-5 text-warning" />}
              iconBg="bg-warning/10"
              sub={<span className="text-[10px] text-muted-foreground mt-1">조건부 {data.validationConditional}건</span>}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">공정별 위험도 분포</CardTitle>
              </CardHeader>
              <CardContent>
                {data.processData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.processData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                      <Bar dataKey="high" name="상" stackId="a" fill="hsl(var(--risk-high))" barSize={20} />
                      <Bar dataKey="med" name="중" stackId="a" fill="hsl(var(--risk-medium))" barSize={20} />
                      <Bar dataKey="low" name="하" stackId="a" fill="hsl(var(--risk-low))" barSize={20} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart message="공정 데이터가 없습니다" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">위험도 등급 분포</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center">
                {data.totalItems > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={riskDistData}
                          cx="50%" cy="50%"
                          innerRadius={45} outerRadius={70}
                          dataKey="value"
                          stroke="hsl(var(--card))"
                          strokeWidth={3}
                        >
                          {riskDistData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex gap-4 text-xs mt-2">
                      {riskDistData.map((s) => (
                        <div key={s.name} className="flex items-center gap-1.5">
                          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                          <span className="text-muted-foreground">{s.name}</span>
                          <span className="font-semibold">{s.value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyChart message="데이터가 없습니다" />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top Risk Items */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" /> 고위험 항목 Top 5
                </CardTitle>
                <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => navigate("/risk-assessment")}>
                  전체 보기 <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {data.topRisks.length > 0 ? (
                <table className="w-full data-table">
                  <thead>
                    <tr>
                      <th>공정</th>
                      <th>세부작업</th>
                      <th>위험요인</th>
                      <th className="text-center">위험도</th>
                      <th className="text-center">개선후</th>
                      <th className="text-center">이행상태</th>
                      <th>책임부서</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topRisks.map((item) => (
                      <tr key={item.id}>
                        <td className="font-medium">{item.process}</td>
                        <td>{item.sub_task}</td>
                        <td>{item.hazard}</td>
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
                          <Badge
                            variant={item.status === "완료" ? "default" : "outline"}
                            className={`text-[10px] ${item.status === "완료" ? "bg-success text-success-foreground" : ""}`}
                          >
                            {item.status}
                          </Badge>
                        </td>
                        <td>{item.department}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyChart message="고위험 항목이 없습니다" />
              )}
            </CardContent>
          </Card>

          {/* Feedback KPI Section */}
          {data.feedback.total > 0 && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard
                  label="총 피드백"
                  value={data.feedback.total}
                  icon={<ClipboardList className="h-5 w-5 text-primary" />}
                  iconBg="bg-primary/10"
                />
                <KpiCard
                  label="미조치"
                  value={data.feedback.unresolved}
                  valueColor={data.feedback.unresolved > 0 ? "text-destructive" : "text-foreground"}
                  icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
                  iconBg="bg-destructive/10"
                />
                <KpiCard
                  label="진행중"
                  value={data.feedback.inProgress}
                  valueColor="text-warning"
                  icon={<Clock className="h-5 w-5 text-warning" />}
                  iconBg="bg-warning/10"
                />
                <KpiCard
                  label="피드백 완료율"
                  value={`${data.feedback.completionRate}%`}
                  icon={<CheckCircle2 className="h-5 w-5 text-success" />}
                  iconBg="bg-success/10"
                  sub={<span className="text-[10px] text-muted-foreground mt-1">{data.feedback.completed}/{data.feedback.total} 완료</span>}
                />
              </div>

              {data.feedback.byContractor.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-primary" /> 부서별 피드백 이행률
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {data.feedback.byContractor.map((c) => (
                        <div key={c.name} className="flex items-center gap-3">
                          <span className="text-xs font-medium w-24 truncate">{c.name}</span>
                          <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden relative">
                            <div
                              className={`h-full rounded-full transition-all ${
                                c.rate >= 80 ? 'bg-success' : c.rate >= 50 ? 'bg-warning' : 'bg-destructive'
                              }`}
                              style={{ width: `${c.rate}%` }}
                            />
                          </div>
                          <span className={`text-xs font-bold w-12 text-right ${
                            c.rate >= 80 ? 'text-success' : c.rate >= 50 ? 'text-warning' : 'text-destructive'
                          }`}>
                            {c.rate}%
                          </span>
                          <span className="text-[10px] text-muted-foreground w-16">
                            {c.completed}/{c.total}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
      </div>
    </div>
  );
};

// Sub-components
function KpiCard({
  label, value, icon, iconBg, sub, valueColor,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  iconBg: string;
  sub?: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${valueColor || "text-foreground"}`}>{value}</p>
            {sub}
          </div>
          <div className={`h-10 w-10 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
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
    <Card className={`cursor-pointer transition-colors hover:bg-accent/30 ${hasWarning ? "border-warning/50" : ""}`} onClick={() => navigate("/site-weather")}>
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
          {/* Alert badges */}
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

// ===== Quick Start cards (role-aware) =====
interface QuickStartCardsProps {
  navigate: (path: string) => void;
  isMaster: boolean;
  isProjectAdmin: boolean;
  isContractor: boolean;
  isWorker: boolean;
}

function QuickStartCards({ navigate, isMaster, isProjectAdmin, isContractor, isWorker }: QuickStartCardsProps) {
  type QSItem = { title: string; desc: string; icon: any; path: string; tone: 'primary' | 'warning' | 'success' | 'destructive' };

  let items: QSItem[];
  if (isMaster) {
    items = [
      { title: "프로젝트 관리", desc: "전체 프로젝트 현황 보기", icon: FolderKanbanIcon, path: "/projects", tone: 'primary' },
      { title: "사용자/권한", desc: "사용자 초대 및 권한 부여", icon: Users, path: "/settings/permissions", tone: 'success' },
      { title: "감사 로그", desc: "전체 시스템 활동 점검", icon: History, path: "/audit-logs", tone: 'warning' },
      { title: "시스템 테스트", desc: "회귀·무결성 전수 검증", icon: ShieldCheck, path: "/admin/system-test", tone: 'destructive' },
    ];
  } else if (isProjectAdmin) {
    // project_admin / safety_manager
    items = [
      { title: "결재 대기 확인", desc: "내가 결재할 문서", icon: FileCheck, path: "/approvals", tone: 'warning' },
      { title: "위험성평가", desc: "회차 생성 및 검토", icon: ShieldAlert, path: "/risk-assessment", tone: 'destructive' },
      { title: "작업계획서", desc: "오늘의 작업 계획", icon: FileText, path: "/work-plans", tone: 'primary' },
      { title: "안전점검", desc: "정기 점검 수행", icon: ClipboardCheckIcon, path: "/safety-inspections", tone: 'success' },
    ];
  } else if (isContractor) {
    // 협력사 관리자: 작성/제출 권한 보유
    items = [
      { title: "위험성평가 작성", desc: "내 회사 평가 회차 만들기", icon: ShieldAlert, path: "/risk-assessment", tone: 'destructive' },
      { title: "작업허가서 신청", desc: "허가 필요 작업 신청", icon: FileSignature, path: "/work-permits", tone: 'warning' },
      { title: "TBM 일지 작성", desc: "오늘 TBM 기록", icon: ClipboardList, path: "/tbm-logs", tone: 'primary' },
      { title: "AI 어시스턴트", desc: "위험요소 빠르게 검색", icon: Bot, path: "/ai-assistant", tone: 'success' },
    ];
  } else if (isWorker) {
    // 일반 근로자: 조회·교육 이수·서명만
    items = [
      { title: "TBM 참여/서명", desc: "오늘 TBM 서명하기", icon: FileSignature, path: "/tbm-logs", tone: 'primary' },
      { title: "내 교육 이수", desc: "필수 교육 확인", icon: ClipboardList, path: "/worker-education", tone: 'success' },
      { title: "위험성평가 조회", desc: "승인된 평가 열람", icon: ShieldAlert, path: "/risk-assessment", tone: 'warning' },
      { title: "AI 어시스턴트", desc: "안전 정보 검색", icon: Bot, path: "/ai-assistant", tone: 'primary' },
    ];
  } else {
    // viewer (default)
    items = [
      { title: "위험성평가 조회", desc: "승인된 평가 열람", icon: ShieldAlert, path: "/risk-assessment", tone: 'warning' },
      { title: "작업계획서 조회", desc: "오늘의 작업 계획", icon: FileText, path: "/work-plans", tone: 'primary' },
      { title: "TBM 일지 조회", desc: "TBM 기록 보기", icon: ClipboardList, path: "/tbm-logs", tone: 'success' },
      { title: "AI 어시스턴트", desc: "안전 정보 검색", icon: Bot, path: "/ai-assistant", tone: 'primary' },
    ];
  }

  const toneClass: Record<QSItem['tone'], string> = {
    primary: "bg-primary/10 text-primary",
    warning: "bg-warning/10 text-warning",
    success: "bg-success/10 text-success",
    destructive: "bg-destructive/10 text-destructive",
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-muted-foreground">빠른 시작</h2>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map((it) => (
          <button
            key={it.title}
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
    </div>
  );
}

// re-import aliases to avoid duplicate name with imports
import { FolderKanban as FolderKanbanIcon, ClipboardCheck as ClipboardCheckIcon } from "lucide-react";

export default Dashboard;

