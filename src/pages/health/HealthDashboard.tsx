import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NavLink } from "@/components/NavLink";
import { Activity, Stethoscope, FlaskConical, ClipboardList, GraduationCap } from "lucide-react";
import { useToastError } from "@/hooks/useToastError";

const ACTIVE_PROJECT_KEY = "selectedProjectId";

type Stats = {
  workers: number;
  notChecked: number;
  overdueCheckup: number;
  chemicals: number;
  carcinogens: number;
  exceeded: number;
  surveysActive: number;
};

export default function HealthDashboard() {
  const handle = useToastError();
  const [stats, setStats] = useState<Stats | null>(null);
  const projectId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_PROJECT_KEY) : null;

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const [{ count: w }, { count: notC }, { count: over }, { count: chem }, { count: carc }, { count: exc }, { count: surv }] =
          await Promise.all([
            supabase.from("workers").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_active", true),
            supabase.from("workers").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_active", true).eq("health_checkup_status", "미수검"),
            supabase.from("workers").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_active", true).lt("next_checkup_due", new Date().toISOString().slice(0, 10)),
            supabase.from("chemicals").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_deleted", false),
            supabase.from("chemicals").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_deleted", false).eq("is_carcinogen", true),
            supabase.from("work_env_measurements").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_exceeded", true).eq("is_deleted", false),
            supabase.from("hazard_surveys").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_active", true).eq("is_deleted", false),
          ]);
        setStats({
          workers: w || 0, notChecked: notC || 0, overdueCheckup: over || 0,
          chemicals: chem || 0, carcinogens: carc || 0, exceeded: exc || 0, surveysActive: surv || 0,
        });
      } catch (e) { handle(e, "보건 통계 조회"); }
    })();
  }, [projectId]);

  if (!projectId) return <div className="p-6 text-muted-foreground">프로젝트를 선택해주세요.</div>;

  const cards = [
    { to: "/health/checkups", icon: Stethoscope, title: "건강진단", value: stats?.notChecked ?? "-", sub: `미수검 / 전체 ${stats?.workers ?? "-"}명`, urgent: (stats?.notChecked || 0) > 0 },
    { to: "/health/checkups", icon: Activity, title: "기한 초과", value: stats?.overdueCheckup ?? "-", sub: "차회 진단 기한 경과", urgent: (stats?.overdueCheckup || 0) > 0 },
    { to: "/health/chemicals", icon: FlaskConical, title: "화학물질/MSDS", value: stats?.chemicals ?? "-", sub: `발암성 ${stats?.carcinogens ?? "-"}건` },
    { to: "/health/measurements", icon: ClipboardList, title: "측정 초과", value: stats?.exceeded ?? "-", sub: "노출기준 초과 건수", urgent: (stats?.exceeded || 0) > 0 },
    { to: "/health/education", icon: GraduationCap, title: "보건교육", value: "-", sub: "분기별 이수율" },
    { to: "/health/hazard-surveys", icon: ClipboardList, title: "유해요인조사", value: stats?.surveysActive ?? "-", sub: "진행 중 설문" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">보건관리 대시보드</h1>
        <p className="text-sm text-muted-foreground mt-1">산업안전보건법상 보건관리자 직무 통합</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <NavLink key={c.to + c.title} to={c.to}>
            <Card className={`hover:shadow-md transition ${c.urgent ? "border-destructive/60" : ""}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                  <c.icon className="h-4 w-4" /> {c.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${c.urgent ? "text-destructive" : ""}`}>{c.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{c.sub}</div>
              </CardContent>
            </Card>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
