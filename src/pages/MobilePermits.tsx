import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useAuditLog } from "@/hooks/useAuditLog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import IMESafeTextarea from "@/components/IMESafeTextarea";
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
  const { projectId, applyCompanyFilter } = useMobileAccess();
  const { log: logAudit } = useAuditLog();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<any | null>(null);
  const [comment, setComment] = useState("");
  const [acting, setActing] = useState(false);

  const load = async () => {
    if (!projectId) { setLoading(false); return; }
    setLoading(true);
    let q: any = supabase.from("work_permits" as any).select("*").eq("project_id", projectId);
    q = applyCompanyFilter(q);
    const { data, error } = await q
      .order("permit_date", { ascending: false }).limit(100);
    if (error) toast.error("로드 실패: " + error.message);
    setList((data as any) || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  const act = async (status: "승인" | "반려") => {
    if (!active) return;
    if (status === "반려" && !comment.trim()) return toast.error("반려 사유를 입력하세요");
    setActing(true);
    try {
      // 결재 라인이 있는 문서는 act_on_approval RPC로 처리 → 최종 승인 알림/자동 상태 반영
      const { data: myAp } = await supabase.from("approvals").select("id")
        .eq("entity_type", "work_permit").eq("entity_id", active.id)
        .eq("approver_id", profile?.user_id || "")
        .eq("status", "진행중").limit(1).maybeSingle();
      if (myAp?.id) {
        const { data, error } = await supabase.rpc("act_on_approval", {
          _approval_id: myAp.id,
          _action: status === "승인" ? "approve" : "reject",
          _comment: comment || "",
        });
        if (error) throw error;
        const r: any = data;
        if (r?.error) throw new Error(r.error);
      } else {
        const update: any = {
          status, approval_comment: comment,
          approved_by: profile?.user_id,
          approved_by_name: profile?.display_name || "",
          approved_at: new Date().toISOString(),
        };
        if (status === "반려") update.rejection_reason = comment;
        const { error } = await supabase.from("work_permits" as any).update(update).eq("id", active.id);
        if (error) throw error;
      }
      await logAudit(status === "승인" ? 'approve' : 'reject', 'work_permit', active.id, projectId, { comment });
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
        {!projectId && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="pt-3 pb-3 text-sm">프로젝트를 먼저 선택하세요.</CardContent>
          </Card>
        )}
        {loading && <div className="text-center text-muted-foreground py-8"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />로딩…</div>}

        {!active && !loading && projectId && list.length === 0 && (
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
                <IMESafeTextarea rows={3} defaultValue={comment} onCommit={setComment}
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
