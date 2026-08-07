import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Search, Loader2, Eye, FileText, Building2 } from "lucide-react";
import { toast } from "sonner";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { fetchCreatorCompanyLabelMap } from "@/lib/companyDocScope";

/**
 * Mobile list: approved risk assessments only → Read-Only Viewer.
 * Authoring UI is never opened on mobile.
 */
export default function MobileRiskAssessment() {
  const navigate = useNavigate();
  const goMobileHome = useNavigateMobileHome();
  const { projectId, role, companyId } = useMobileAccess();
  const [rows, setRows] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, { high: number; medium: number; low: number; total: number }>>({});
  const [creatorCompanyMap, setCreatorCompanyMap] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("assessment_runs")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .eq("status", "승인완료")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) toast.error("로드 실패: " + error.message);
    const scoped = (data || []).filter((r: any) => {
      if (role !== "worker" && role !== "viewer" && role !== "contractor") return true;
      if (!companyId) return false;
      const targets: string[] = r.target_company_ids || [];
      return targets.length === 0 || targets.includes(companyId);
    });
    setRows(scoped);

    if (scoped.length) {
      const ids = scoped.map((r: any) => r.id);
      const creatorIds = scoped.map((r: any) => r.created_by).filter(Boolean);
      const [{ data: items, error: iErr }, creatorMap] = await Promise.all([
        supabase.from("risk_items").select("run_id, risk_grade").in("run_id", ids),
        fetchCreatorCompanyLabelMap(projectId, creatorIds).catch(() => ({})),
      ]);
      if (iErr) toast.error("위험항목 로드 실패: " + iErr.message);
      setCreatorCompanyMap(creatorMap);
      const c: Record<string, any> = {};
      ids.forEach((id) => (c[id] = { high: 0, medium: 0, low: 0, total: 0 }));
      (items || []).forEach((it: any) => {
        if (!c[it.run_id]) return;
        c[it.run_id].total++;
        const g = (it.risk_grade || "").toLowerCase();
        if (g.includes("high") || g.includes("상")) c[it.run_id].high++;
        else if (g.includes("med") || g.includes("중")) c[it.run_id].medium++;
        else c[it.run_id].low++;
      });
      setCounts(c);
    } else {
      setCounts({});
      setCreatorCompanyMap({});
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
    /* eslint-disable-next-line */
  }, [projectId, role, companyId]);

  const filtered = rows.filter((r) => {
    if (!q) return true;
    const creatorCo = (r.created_by && creatorCompanyMap[r.created_by]) || "";
    return r.period_label?.includes(q) || r.notes?.includes(q) || creatorCo.includes(q);
  });

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button
          size="icon"
          variant="ghost"
          className="text-primary-foreground"
          onClick={() => goMobileHome()}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">위험성평가 조회</div>
      </header>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="기간/작성사/메모 검색"
            className="pl-9 h-11"
          />
        </div>

        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="pt-3 pb-3 text-xs text-muted-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0" />
            모바일은 승인 완료 평가의 핵심 위험요인·안전조치 조회만 가능합니다. 작성은 PC에서 하세요.
          </CardContent>
        </Card>

        {loading && (
          <div className="text-center py-8">
            <Loader2 className="h-5 w-5 animate-spin inline" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-12 text-sm">
            승인 완료된 평가가 없습니다
          </div>
        )}

        {filtered.map((r) => {
          const c = counts[r.id] || { high: 0, medium: 0, low: 0, total: 0 };
          const creatorCompany = r.created_by ? (creatorCompanyMap[r.created_by] || "") : "";
          return (
            <Card
              key={r.id}
              className="active:bg-muted/50 cursor-pointer"
              onClick={() => navigate(`/app/worker/risk-assessment/${r.id}`)}
            >
              <CardContent className="pt-3 pb-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {r.type}
                  </Badge>
                  <Badge className="text-xs bg-success/10 text-success">승인완료</Badge>
                </div>
                <div className="font-medium text-sm">{r.period_label || "(기간 미지정)"}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="truncate" title="작성자 소속 회사">
                    {creatorCompany || "작성사 미확인"}
                  </span>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="text-destructive">상 {c.high}</span>
                  <span className="text-warning">중 {c.medium}</span>
                  <span className="text-muted-foreground">하 {c.low}</span>
                  <span className="ml-auto text-muted-foreground">총 {c.total}</span>
                </div>
                <Button size="sm" variant="ghost" className="w-full mt-1">
                  <Eye className="h-3.5 w-3.5 mr-1" /> 위험요인 · 안전조치 보기
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
