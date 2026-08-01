import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNavigateMobileHome, mobileEntityPath } from "@/lib/mobileNav";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePreviewWriteBlock } from "@/contexts/PreviewContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import IMESafeTextarea from "@/components/IMESafeTextarea";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import PermitAiBriefingCard from "@/components/permits/PermitAiBriefingCard";
import type { PermitAiBriefing } from "@/lib/permitBriefing";
import { isSubmitterApprovalStep } from "@/lib/approvalRules";
import {
  permitPostStepKind,
  permitPostStepBadge,
  permitPostStepApproveLabel,
} from "@/lib/permitPostApproval";

const ENTITY_LABEL: Record<string, string> = {
  work_plan: "작업계획서",
  work_permit: "작업허가서",
  assessment_run: "위험성평가",
  safety_cost: "산업안전보건관리비",
  incident: "사고보고",
  emergency_drill: "비상대피훈련",
  tbm: "TBM 일지",
};

const ENTITY_LINK = (t: string, id: string) => mobileEntityPath(t, id).path;

export default function MobileApprovals() {
  const navigate = useNavigate();
  const goMobileHome = useNavigateMobileHome();
  const { user } = useAuth();
  const blockWrite = usePreviewWriteBlock();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [briefings, setBriefings] = useState<Record<string, PermitAiBriefing | null>>({});
  const [briefingLoading, setBriefingLoading] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try { await (supabase as any).rpc("promote_permits_to_closure_pending"); } catch { /* non-fatal */ }
    const { data, error } = await supabase.rpc("get_my_pending_entity_approvals");
    if (error) toast.error("결재 목록 로드 실패: " + error.message);
    // Desktop parity: 상신(기안) 단계는 승인/반려 UI에 노출하지 않음
    setRows(((data as any[]) || []).filter((r) => !isSubmitterApprovalStep(r)));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  const openRow = async (r: any) => {
    if (r.entity_type === "work_permit") {
      navigate(`/app/worker/approvals/${r.approval_id}`);
      return;
    }
    setOpenId(r.approval_id);
    if (briefings[r.entity_id] !== undefined) return;
  };

  const decide = async (r: any, action: "approve" | "reject") => {
    if (blockWrite()) {
      toast.message("프리뷰 모드에서는 데이터를 변경할 수 없습니다.");
      return;
    }
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
      const kind = permitPostStepKind(r.step_position);
      toast.success(
        kind === "closure_sm"
          ? (action === "approve" ? "작업 완료 및 종료 처리됨" : "종료 확인 반려")
          : kind === "closure_supervisor"
            ? (action === "approve" ? "관리감독자 완료 확인됨" : "완료 확인 반려")
            : kind === "extend_sm"
              ? (action === "approve" ? "연장 승인 완료" : "연장 요청 반려")
              : (action === "approve" ? "승인 완료" : "반려 처리됨"),
      );
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
        <Button size="icon" variant="ghost" className="text-primary-foreground" onClick={() => goMobileHome()}>
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
        {rows.map((r: any) => {
          const kind = permitPostStepKind(r.step_position);
          const badge = permitPostStepBadge(kind);
          return (
          <Card key={r.approval_id}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-xs">{ENTITY_LABEL[r.entity_type] || r.entity_type}</Badge>
                {badge && (
                  <Badge className="text-xs bg-amber-500/15 text-amber-700 border-amber-500/30" variant="outline">
                    {badge}
                  </Badge>
                )}
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
                  {r.entity_type === "work_permit" && (
                    briefingLoading === r.entity_id
                      ? <div className="text-xs text-muted-foreground py-2"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />AI 브리핑…</div>
                      : <PermitAiBriefingCard briefing={briefings[r.entity_id]} compact />
                  )}
                  <IMESafeTextarea rows={2} placeholder="의견/사유 (반려 시 필수)" defaultValue={comment} onCommit={setComment} />
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant="outline" onClick={() => { setOpenId(null); setComment(""); }}>취소</Button>
                    <Button variant="destructive" onClick={() => decide(r, "reject")} disabled={submitting}>
                      <XCircle className="h-4 w-4 mr-1" /> 반려
                    </Button>
                    <Button onClick={() => decide(r, "approve")} disabled={submitting}>
                      {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                      {permitPostStepApproveLabel(kind)}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Button variant="outline" onClick={() => navigate(ENTITY_LINK(r.entity_type, r.entity_id))}>
                    문서 보기
                  </Button>
                  <Button onClick={() => openRow(r)}>
                    {kind === "normal" ? "결재 처리" : permitPostStepApproveLabel(kind)}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          );
        })}
      </main>
    </div>
  );
}
