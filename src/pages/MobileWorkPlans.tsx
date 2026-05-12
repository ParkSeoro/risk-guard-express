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
  "완료": "bg-success/10 text-success",
  "만료": "bg-destructive/10 text-destructive",
};

import { useMobileAccess } from "@/hooks/useMobileAccess";

export default function MobileWorkPlans() {
  const navigate = useNavigate();
  const { projectId, applyCompanyFilter } = useMobileAccess();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"active" | "all">("active");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    let query: any = supabase.from("work_plans").select("*")
      .eq("project_id", projectId).eq("is_deleted", false);
    query = applyCompanyFilter(query);
    const { data } = await query.order("updated_at", { ascending: false }).limit(100);
    setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  const filtered = rows.filter(r => {
    if (tab === "active" && (r.status === "만료" || r.status === "완료")) return false;
    if (q && !(r.title?.includes(q) || r.work_type?.includes(q))) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground" onClick={() => navigate("/m")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">작업계획</div>
      </header>

      <div className="grid grid-cols-2 sticky top-16 bg-background border-b z-10">
        {(["active","all"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`py-3 text-sm font-medium ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>
            {t === "active" ? "진행중" : "전체"}
          </button>
        ))}
      </div>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="제목/작업종류 검색" className="pl-9 h-11" />
        </div>

        <Card className="bg-warning/5 border-warning/40">
          <CardContent className="pt-3 pb-3 text-xs text-muted-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0" />
            모바일에서는 요약만 보여요. 작성·편집은 데스크톱에서 가능합니다.
          </CardContent>
        </Card>

        {loading && <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></div>}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-12 text-sm">작업계획이 없습니다</div>
        )}

        {filtered.map(r => (
          <Card key={r.id} className="active:bg-muted/50" onClick={() => navigate(`/work-plan/${r.id}`)}>
            <CardContent className="pt-3 pb-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {r.work_type && <Badge variant="outline" className="text-xs">{r.work_type}</Badge>}
                <Badge className={`text-xs ${STATUS_COLOR[r.status] || ""}`}>{r.status}</Badge>
                {r.version > 1 && <Badge variant="secondary" className="text-xs">v{r.version}</Badge>}
              </div>
              <div className="font-medium text-sm leading-snug">{r.title || "(제목 없음)"}</div>
              <div className="text-xs text-muted-foreground">
                {r.start_date || "—"} ~ {r.end_date || "—"}
              </div>
              <Button size="sm" variant="ghost" className="w-full mt-1">
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> 상세 보기
              </Button>
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
