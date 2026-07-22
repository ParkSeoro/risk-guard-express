import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import IMESafeTextarea from "@/components/IMESafeTextarea";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, FileCheck2 } from "lucide-react";
import { toast } from "sonner";

const ENTITY_LABEL: Record<string, string> = {
  work_plan: "작업계획서",
  work_permit: "작업허가서",
  assessment_run: "위험성평가",
  safety_cost: "산업안전보건관리비",
  incident: "사고보고",
  emergency_drill: "비상대피훈련",
  tbm: "TBM 일지",
};

const ENTITY_LINK = (t: string, id: string) => {
  switch (t) {
    case "assessment_run": return `/assessment-run/${id}`;
    case "work_plan": return "/work-plans";
    case "work_permit": return "/work-permits";
    case "safety_cost": return "/safety-cost";
    case "incident": return "/incidents";
    case "emergency_drill": return "/emergency-drills";
    case "tbm": return "/tbm";
    default: return "/approvals";
  }
};

// 모바일 통합 전자결재 (모든 문서 타입: 허가서/계획서/위평/사고/훈련/TBM/안관비)
export default function MobileApprovals() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("get_my_pending_entity_approvals");
    if (error) toast.error("결재 목록 로드 실패: " + error.message);
    setRows((data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  const decide = async (r: any, action: "approve" | "reject") => {
    if (action === "reject" && !comment.trim()) return toast.error("반려 사유를 입력하세요");
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("act_on_approval", {
        _approval_id: r.approval_id,
        _action: action,
        _comment: comment || "",
      });
      if (error) throw error;
      const result: any = data;
      if (result?.error) throw new Error(result.error);
      toast.success(action === "approve" ? "승인 완료" : "반려 처리됨");
      setOpenId(null); setComment("");
      load();
    } catch (e: any) {
      toast.error(e.message || "처리 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground" onClick={() => navigate("/m")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">전자결재</div>
        <Badge variant="secondary">{rows.length}건</Badge>
      </header>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        {loading && <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></div>}
        {!loading && rows.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            <FileCheck2 className="h-10 w-10 mx-auto opacity-30" />
            <div className="text-sm mt-2">대기 중인 결재가 없습니다</div>
          </div>
        )}
        {rows.map((r: any) => (
          <Card key={r.approval_id}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-xs">{ENTITY_LABEL[r.entity_type] || r.entity_type}</Badge>
                <Badge variant="outline" className="text-xs">{r.step || "결재"}</Badge>
                {r.step_order && <Badge variant="outline" className="text-xs">{r.step_order}단계</Badge>}
              </div>
              <div className="font-medium text-sm">{r.entity_title || "(제목 없음)"}</div>
              <div className="text-xs text-muted-foreground">
                {r.entity_date && <>일자 {r.entity_date} · </>}
                요청 {new Date(r.created_at).toLocaleString("ko-KR")}
              </div>

              {openId === r.approval_id ? (
                <div className="space-y-2 pt-2 border-t">
                  <IMESafeTextarea rows={2} placeholder="의견/사유 (반려 시 필수)" defaultValue={comment} onCommit={setComment} />
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant="outline" onClick={() => { setOpenId(null); setComment(""); }}>취소</Button>
                    <Button variant="destructive" onClick={() => decide(r, "reject")} disabled={submitting}>
                      <XCircle className="h-4 w-4 mr-1" /> 반려
                    </Button>
                    <Button onClick={() => decide(r, "approve")} disabled={submitting}>
                      {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />} 승인
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Button variant="outline" onClick={() => navigate(ENTITY_LINK(r.entity_type, r.entity_id))}>
                    문서 보기
                  </Button>
                  <Button onClick={() => setOpenId(r.approval_id)}>결재 처리</Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
