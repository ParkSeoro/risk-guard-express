import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, FileCheck2 } from "lucide-react";
import { toast } from "sonner";

// 모바일 결재함: 내 차례 대기 결재 → 승인/반려
export default function MobileApprovals() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [runs, setRuns] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    // 내가 결재자인 모든 결재 단계
    const { data: ap } = await supabase.from("approvals").select("*")
      .eq("approver_id", user.id).order("created_at", { ascending: false }).limit(100);
    const list = (ap || []).filter((a: any) => a.status === "대기");
    setRows(list);

    const runIds = Array.from(new Set(list.map((a: any) => a.run_id).filter(Boolean)));
    if (runIds.length) {
      const { data: r } = await supabase.from("assessment_runs")
        .select("id, period_label, status, type").in("id", runIds);
      const map: Record<string, any> = {};
      (r || []).forEach((x: any) => { map[x.id] = x; });
      setRuns(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  const decide = async (ap: any, action: "승인" | "반려") => {
    if (action === "반려" && !comment.trim()) return toast.error("반려 사유를 입력하세요");
    setSubmitting(true);
    try {
      // 이전 단계 미승인 차단
      const { data: all } = await supabase.from("approvals").select("*")
        .eq("run_id", ap.run_id).eq("approval_version", ap.approval_version || 1);
      const sorted = (all || []).filter((a: any) => a.status !== "취소")
        .sort((a: any, b: any) => (a.step_order || 0) - (b.step_order || 0));
      const idx = sorted.findIndex((a: any) => a.id === ap.id);
      if (idx > 0 && sorted.slice(0, idx).some((a: any) => a.status !== "승인")) {
        toast.error("이전 결재가 완료되지 않았습니다");
        setSubmitting(false);
        return;
      }
      await supabase.from("approvals").update({
        status: action,
        approver_id: user!.id,
        approver_name: profile?.display_name || "",
        comment: comment || "",
        approved_at: new Date().toISOString(),
      }).eq("id", ap.id);

      if (action === "승인") {
        const allApproved = sorted.every((a: any) => a.status === "승인" || a.id === ap.id);
        if (allApproved) {
          await supabase.from("assessment_runs").update({ status: "승인완료" }).eq("id", ap.run_id);
        }
      } else {
        await supabase.from("assessment_runs").update({ status: "보완중" }).eq("id", ap.run_id);
      }

      toast.success(action === "승인" ? "승인 완료" : "반려 처리됨");
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
        <div className="font-bold text-lg flex-1">결재함</div>
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
        {rows.map(r => {
          const run = runs[r.run_id];
          return (
            <Card key={r.id}>
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{r.step || "결재"}</Badge>
                  {run?.type && <Badge variant="secondary" className="text-xs">{run.type}</Badge>}
                </div>
                <div className="font-medium text-sm">{run?.period_label || "(기간 미지정)"}</div>
                <div className="text-xs text-muted-foreground">
                  요청 {new Date(r.created_at).toLocaleString("ko-KR")}
                </div>

                {openId === r.id ? (
                  <div className="space-y-2 pt-2 border-t">
                    <Textarea rows={2} placeholder="의견/사유 (반려 시 필수)" value={comment} onChange={e => setComment(e.target.value)} />
                    <div className="grid grid-cols-3 gap-2">
                      <Button variant="outline" onClick={() => { setOpenId(null); setComment(""); }}>취소</Button>
                      <Button variant="destructive" onClick={() => decide(r, "반려")} disabled={submitting}>
                        <XCircle className="h-4 w-4 mr-1" /> 반려
                      </Button>
                      <Button onClick={() => decide(r, "승인")} disabled={submitting}>
                        {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />} 승인
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <Button variant="outline" onClick={() => navigate(r.run_id ? `/assessment-run/${r.run_id}` : "/approvals")}>
                      문서 보기
                    </Button>
                    <Button onClick={() => setOpenId(r.id)}>결재 처리</Button>
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
