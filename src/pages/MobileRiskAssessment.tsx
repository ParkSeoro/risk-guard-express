import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Search, Loader2, ExternalLink, FileText } from "lucide-react";

const STATUS_COLOR: Record<string, string> = {
  "승인완료": "bg-success/10 text-success",
  "결재진행": "bg-primary/10 text-primary",
  "보완중": "bg-warning/10 text-warning",
  "작성중": "bg-muted text-muted-foreground",
};

import { useMobileAccess } from "@/hooks/useMobileAccess";

export default function MobileRiskAssessment() {
  const navigate = useNavigate();
  const { projectId, applyCompanyFilter } = useMobileAccess();
  const [rows, setRows] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, { high: number; medium: number; low: number; total: number }>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    let query: any = supabase.from("assessment_runs").select("*")
      .eq("project_id", projectId).eq("is_deleted", false);
    query = applyCompanyFilter(query);
    const { data } = await query.order("updated_at", { ascending: false }).limit(50);
    setRows(data || []);

    if (data && data.length) {
      const ids = data.map((r: any) => r.id);
      const { data: items } = await supabase.from("risk_items").select("run_id, risk_grade")
        .in("run_id", ids);
      const c: Record<string, any> = {};
      ids.forEach(id => c[id] = { high: 0, medium: 0, low: 0, total: 0 });
      (items || []).forEach((it: any) => {
        if (!c[it.run_id]) return;
        c[it.run_id].total++;
        const g = (it.risk_grade || "").toLowerCase();
        if (g.includes("high") || g.includes("상")) c[it.run_id].high++;
        else if (g.includes("med") || g.includes("중")) c[it.run_id].medium++;
        else c[it.run_id].low++;
      });
      setCounts(c);
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  const filtered = rows.filter(r => !q || r.period_label?.includes(q) || r.notes?.includes(q));

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground" onClick={() => navigate("/m")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">위험성평가</div>
      </header>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="기간/메모 검색" className="pl-9 h-11" />
        </div>

        <Card className="bg-warning/5 border-warning/40">
          <CardContent className="pt-3 pb-3 text-xs text-muted-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0" />
            모바일에서는 요약만 보여요. 편집은 데스크톱에서 가능합니다.
          </CardContent>
        </Card>

        {loading && <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></div>}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-12 text-sm">평가 이력이 없습니다</div>
        )}

        {filtered.map(r => {
          const c = counts[r.id] || { high: 0, medium: 0, low: 0, total: 0 };
          return (
            <Card key={r.id} className="active:bg-muted/50" onClick={() => navigate(`/assessment-run/${r.id}`)}>
              <CardContent className="pt-3 pb-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{r.type}</Badge>
                  <Badge className={`text-xs ${STATUS_COLOR[r.status] || ""}`}>{r.status}</Badge>
                </div>
                <div className="font-medium text-sm">{r.period_label || "(기간 미지정)"}</div>
                <div className="flex gap-3 text-xs">
                  <span className="text-destructive">상 {c.high}</span>
                  <span className="text-warning">중 {c.medium}</span>
                  <span className="text-muted-foreground">하 {c.low}</span>
                  <span className="ml-auto text-muted-foreground">총 {c.total}</span>
                </div>
                <Button size="sm" variant="ghost" className="w-full mt-1">
                  <ExternalLink className="h-3.5 w-3.5 mr-1" /> 상세 보기
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
