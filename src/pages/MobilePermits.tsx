import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, FileCheck2, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

const STATUS_BADGE: Record<string, string> = {
  대기: "bg-warning/20 text-warning",
  검토중: "bg-primary/20 text-primary",
  승인: "bg-success/20 text-success",
  반려: "bg-destructive/20 text-destructive",
};

export default function MobilePermits() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const projectId = typeof window !== "undefined" ? localStorage.getItem("selectedProjectId") || "" : "";
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<any | null>(null);
  const [comment, setComment] = useState("");
  const [acting, setActing] = useState(false);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    const { data } = await supabase.from("work_permits" as any)
      .select("*").eq("project_id", projectId)
      .in("status", ["대기", "검토중"])
      .order("permit_date", { ascending: false }).limit(100);
    setList((data as any) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [projectId]);

  const act = async (status: "승인" | "반려") => {
    if (!active) return;
    if (status === "반려" && !comment.trim()) return toast.error("반려 사유를 입력하세요");
    setActing(true);
    try {
      const update: any = {
        status,
        approval_comment: comment,
        approved_by: profile?.user_id,
        approved_by_name: profile?.display_name || "",
        approved_at: new Date().toISOString(),
      };
      if (status === "반려") update.rejection_reason = comment;
      const { error } = await supabase.from("work_permits" as any).update(update).eq("id", active.id);
      if (error) throw error;
      toast.success(status === "승인" ? "승인 완료" : "반려 처리됨");
      setActive(null); setComment("");
      load();
    } catch (e: any) {
      toast.error("처리 실패: " + e.message);
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground"
          onClick={() => active ? setActive(null) : navigate("/m")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">작업허가서 결재</div>
        <Badge variant="secondary">{list.length}</Badge>
      </header>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        {loading && <div className="text-center text-muted-foreground py-8"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />로딩…</div>}

        {!active && !loading && list.length === 0 && (
          <Card><CardContent className="pt-6 text-center text-sm text-muted-foreground">
            대기중인 작업허가서가 없습니다.
          </CardContent></Card>
        )}

        {!active && list.map(p => (
          <Card key={p.id} className="active:scale-[0.99] transition cursor-pointer" onClick={() => { setActive(p); setComment(""); }}>
            <CardContent className="pt-4">
              <div className="flex items-start gap-2">
                <FileCheck2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{p.work_name || p.work_description || "(제목 없음)"}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {p.permit_type} · {p.location || "-"} · {p.contractor_company}
                  </div>
                  <div className="text-xs mt-1">{p.permit_date} · 인원 {p.personnel_count}명</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${STATUS_BADGE[p.status] || "bg-muted"}`}>{p.status}</span>
              </div>
            </CardContent>
          </Card>
        ))}

        {active && (
          <>
            <Card>
              <CardContent className="pt-4 space-y-2">
                <div className="font-bold text-base">{active.work_name || active.work_description}</div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div>유형: {active.permit_type}</div>
                  <div>일자: {active.permit_date}</div>
                  <div>장소: {active.location}</div>
                  <div>업체: {active.contractor_company}</div>
                  <div>인원: {active.personnel_count}명</div>
                  {active.work_start_at && <div>작업시간: {new Date(active.work_start_at).toLocaleString("ko-KR")} ~ {active.work_end_at ? new Date(active.work_end_at).toLocaleString("ko-KR") : "-"}</div>}
                </div>
                {active.work_description && (
                  <div className="text-sm bg-muted/40 rounded p-2 mt-2 whitespace-pre-wrap">{active.work_description}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4 space-y-3">
                <Textarea rows={3} value={comment} onChange={e => setComment(e.target.value)}
                  placeholder="결재 의견 (반려 시 필수)" />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="destructive" className="h-14" disabled={acting} onClick={() => act("반려")}>
                    <XCircle className="h-5 w-5 mr-1" /> 반려
                  </Button>
                  <Button className="h-14 bg-success hover:bg-success" disabled={acting} onClick={() => act("승인")}>
                    <CheckCircle2 className="h-5 w-5 mr-1" /> 승인
                  </Button>
                </div>
                <Button variant="outline" className="w-full" onClick={() => navigate(`/work-permits`)}>
                  데스크톱에서 상세 보기
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
