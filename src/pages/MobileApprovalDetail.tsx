import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import IMESafeTextarea from "@/components/IMESafeTextarea";
import { ArrowLeft, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import PermitAiBriefingCard from "@/components/permits/PermitAiBriefingCard";
import type { PermitAiBriefing } from "@/lib/permitBriefing";

/**
 * Mobile approval detail — AI briefing at top, then action buttons.
 * Route: /m/approvals/:approvalId
 */
export default function MobileApprovalDetail() {
  const { approvalId } = useParams<{ approvalId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [row, setRow] = useState<any | null>(null);
  const [briefing, setBriefing] = useState<PermitAiBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isClosure = (row?.step_position || "").toLowerCase() === "closure_sm";

  useEffect(() => {
    if (!user || !approvalId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_my_pending_entity_approvals");
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      const found = ((data as any[]) || []).find((r) => r.approval_id === approvalId) || null;
      setRow(found);
      if (found?.entity_type === "work_permit" && found.entity_id) {
        const { data: p } = await supabase
          .from("work_permits" as any)
          .select("ai_briefing, work_name, work_description, location, permit_date, status")
          .eq("id", found.entity_id)
          .maybeSingle();
        setBriefing(((p as any)?.ai_briefing as PermitAiBriefing) || null);
      }
      setLoading(false);
    })();
  }, [user, approvalId]);

  const decide = async (action: "approve" | "reject") => {
    if (!row) return;
    if (action === "reject" && !comment.trim()) return toast.error("반려 사유를 입력하세요");
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("act_on_approval", {
        _approval_id: row.approval_id,
        _action: action,
        _comment: comment || "",
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(
        isClosure
          ? action === "approve" ? "작업 완료 및 종료 처리됨" : "종료 확인이 반려되었습니다"
          : action === "approve" ? "승인 완료" : "반려 처리됨",
      );
      navigate("/m/approvals", { replace: true });
    } catch (e: any) {
      toast.error(e.message || "처리 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground" onClick={() => navigate("/m/approvals")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">결재 상세</div>
      </header>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        {loading && (
          <div className="text-center py-10">
            <Loader2 className="h-5 w-5 animate-spin inline" />
          </div>
        )}
        {!loading && !row && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              대기 중인 결재를 찾을 수 없습니다.
              <Button className="mt-3 w-full" variant="outline" onClick={() => navigate("/m/approvals")}>
                목록으로
              </Button>
            </CardContent>
          </Card>
        )}
        {row && (
          <>
            {/* AI briefing — top of mobile detail */}
            {row.entity_type === "work_permit" && (
              <PermitAiBriefingCard briefing={briefing} />
            )}

            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">작업허가서</Badge>
                  {isClosure && (
                    <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30" variant="outline">
                      작업 완료 확인 요망
                    </Badge>
                  )}
                  <Badge variant="outline">{row.step || "결재"}</Badge>
                </div>
                <div className="font-semibold text-base">{row.entity_title || "(제목 없음)"}</div>
                <div className="text-xs text-muted-foreground">
                  {row.entity_date && <>작업일 {row.entity_date} · </>}
                  요청 {new Date(row.created_at).toLocaleString("ko-KR")}
                </div>

                <IMESafeTextarea
                  rows={3}
                  placeholder={isClosure ? "완료 확인 의견 (선택) / 반려 시 필수" : "의견/사유 (반려 시 필수)"}
                  defaultValue={comment}
                  onCommit={setComment}
                />

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="destructive" onClick={() => decide("reject")} disabled={submitting}>
                    <XCircle className="h-4 w-4 mr-1" /> 반려
                  </Button>
                  <Button onClick={() => decide("approve")} disabled={submitting}>
                    {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                    {isClosure ? "작업 완료 및 종료" : "승인"}
                  </Button>
                </div>

                {row.entity_type === "work_permit" && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => navigate(`/work-permits/${row.entity_id}`)}
                  >
                    원본 문서 보기
                  </Button>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
