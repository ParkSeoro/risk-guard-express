import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectAccess } from "@/hooks/useProjectAccess";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  company_id: string; company_name: string; project_id: string;
  worker_count: number; incident_count: number; major_incident_count: number;
  overdue_actions: number; education_count: number; tbm_participations: number;
};

function scoreOf(r: Row): { score: number; grade: string; color: string } {
  let score = 100;
  score -= r.major_incident_count * 30;
  score -= r.incident_count * 5;
  score -= r.overdue_actions * 3;
  if (r.worker_count > 0 && r.education_count / r.worker_count < 0.5) score -= 10;
  score = Math.max(0, Math.min(100, score));
  if (score >= 90) return { score, grade: 'A', color: 'text-green-600' };
  if (score >= 75) return { score, grade: 'B', color: 'text-blue-600' };
  if (score >= 60) return { score, grade: 'C', color: 'text-amber-600' };
  if (score >= 40) return { score, grade: 'D', color: 'text-orange-600' };
  return { score, grade: 'F', color: 'text-destructive' };
}

export default function ContractorScorecard() {
  const { selectedProject: projectId } = useProjectAccess();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!projectId) return;
      setLoading(true);
      const { data, error } = await supabase
        .from("v_contractor_safety_scorecard" as any)
        .select("*")
        .eq("project_id", projectId);
      if (error) toast.error(error.message);
      setRows(((data as unknown) as Row[]) || []);
      setLoading(false);
    })();
  }, [projectId]);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="text-primary" /> 협력사 안전성적표</h1>
        <p className="text-sm text-muted-foreground">산안법 §63 — 도급인의 협력사 근로자 안전관리 책임. 협력사별 사고·시정조치·교육 이행률을 종합 평가합니다.</p>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">협력사별 안전성적</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="text-sm text-muted-foreground">로딩...</div> :
            rows.length === 0 ? <div className="text-sm text-muted-foreground py-8 text-center">집계 대상 협력사 없음</div> :
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr className="text-left">
                  <th className="p-2">협력사</th><th className="p-2 text-center">근로자수</th>
                  <th className="p-2 text-center">사고</th><th className="p-2 text-center">중대재해</th>
                  <th className="p-2 text-center">미이행 시정</th><th className="p-2 text-center">교육 이수</th>
                  <th className="p-2 text-center">TBM 참여</th><th className="p-2 text-center">점수</th>
                  <th className="p-2 text-center">등급</th>
                </tr></thead>
                <tbody>
                  {rows
                    .map(r => ({ r, s: scoreOf(r) }))
                    .sort((a, b) => b.s.score - a.s.score)
                    .map(({ r, s }) => (
                    <tr key={r.company_id} className="border-t hover:bg-muted/30">
                      <td className="p-2 font-medium">{r.company_name}</td>
                      <td className="p-2 text-center">{r.worker_count}</td>
                      <td className="p-2 text-center">{r.incident_count}</td>
                      <td className="p-2 text-center">{r.major_incident_count > 0 ? <span className="text-destructive font-bold">{r.major_incident_count}</span> : 0}</td>
                      <td className="p-2 text-center">{r.overdue_actions > 0 ? <span className="text-destructive">{r.overdue_actions}</span> : 0}</td>
                      <td className="p-2 text-center">{r.education_count}</td>
                      <td className="p-2 text-center">{r.tbm_participations}</td>
                      <td className={`p-2 text-center font-bold ${s.color}`}>{s.score}</td>
                      <td className="p-2 text-center">
                        <Badge variant="outline" className={s.color}>{s.grade}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        점수 계산: 기본 100점에서 중대재해 -30점/건, 일반사고 -5점/건, 미이행 시정조치 -3점/건, 교육 이수율 50% 미만 -10점. A(90+)·B(75+)·C(60+)·D(40+)·F(40 미만)
      </div>
    </div>
  );
}
