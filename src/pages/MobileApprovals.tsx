import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { mobileEntityPath } from "@/lib/mobileNav";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePreviewWriteBlock } from "@/contexts/PreviewContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import IMESafeTextarea from "@/components/IMESafeTextarea";
import { CheckCircle2, XCircle, Loader2, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import MobilePageHeader from "@/components/mobile/MobilePageHeader";
import MobileProjectPicker from "@/components/mobile/MobileProjectPicker";
import {
  approvalTimelineGroupKey,
  entityTypeLabel,
  isSubmitterApprovalStep,
} from "@/lib/approvalRules";
import {
  permitPostStepKind,
  permitPostStepBadge,
  permitPostStepApproveLabel,
} from "@/lib/permitPostApproval";

type TabKey = "mine" | "submitted" | "completed" | "rejected";

export default function MobileApprovals() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const blockWrite = usePreviewWriteBlock();
  const { projectId } = useMobileAccess();
  const [tab, setTab] = useState<TabKey>("mine");
  const [pendingRows, setPendingRows] = useState<any[]>([]);
  const [historyRows, setHistoryRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      try { await (supabase as any).rpc("promote_permits_to_closure_pending"); } catch { /* non-fatal */ }

      const pendingPromise = supabase.rpc("get_my_pending_entity_approvals");
      const historyPromise = projectId
        ? supabase
            .from("approvals")
            .select("*")
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .limit(400)
        : Promise.resolve({ data: [] as any[], error: null });

      const [{ data: pending, error: pendingErr }, { data: history, error: historyErr }] =
        await Promise.all([pendingPromise, historyPromise]);

      if (pendingErr) toast.error("결재 목록 로드 실패: " + pendingErr.message);
      if (historyErr) toast.error("결재 이력 로드 실패: " + historyErr.message);

      // Desktop parity: 상신(기안) 단계는 승인/반려 UI에 노출하지 않음
      setPendingRows(((pending as any[]) || []).filter((r) => !isSubmitterApprovalStep(r)));
      setHistoryRows((history as any[]) || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user, projectId]);

  const groupedHistory = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const row of historyRows) {
      const key = approvalTimelineGroupKey(row);
      (map[key] ||= []).push(row);
    }
    return map;
  }, [historyRows]);

  const tabGroups = useMemo(() => {
    const out: Record<string, any[]> = {};
    if (tab === "mine") return out;
    for (const [key, steps] of Object.entries(groupedHistory)) {
      const arr = steps as any[];
      if (tab === "submitted" && user) {
        if (arr.some((s) => s.approver_id === user.id && isSubmitterApprovalStep(s))) {
          out[key] = arr;
        }
      } else if (tab === "completed") {
        if (arr.every((s) => s.status === "승인" || s.status === "반려" || s.status === "취소")) {
          out[key] = arr;
        }
      } else if (tab === "rejected") {
        if (arr.some((s) => s.status === "반려")) out[key] = arr;
      }
    }
    return out;
  }, [tab, groupedHistory, user]);

  const counts = useMemo(() => {
    let submitted = 0;
    let completed = 0;
    let rejected = 0;
    for (const steps of Object.values(groupedHistory)) {
      const arr = steps as any[];
      if (user && arr.some((s) => s.approver_id === user.id && isSubmitterApprovalStep(s))) submitted += 1;
      if (arr.every((s) => s.status === "승인" || s.status === "반려" || s.status === "취소")) completed += 1;
      if (arr.some((s) => s.status === "반려")) rejected += 1;
    }
    return { mine: pendingRows.length, submitted, completed, rejected };
  }, [groupedHistory, pendingRows.length, user]);

  const openRow = async (r: any) => {
    if (r.entity_type === "work_permit") {
      navigate(`/app/worker/approvals/${r.approval_id}`);
      return;
    }
    setOpenId(r.approval_id);
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
      if (action === "approve" && kind === "normal" && r.entity_type === "work_permit") {
        try {
          const { ensureTbmAfterPermitIssued } = await import("@/lib/tbmLifecycle");
          await ensureTbmAfterPermitIssued({
            rpcResult: result,
            entityType: r.entity_type,
            entityId: r.entity_id,
            projectId: r.project_id,
          });
        } catch (e) {
          console.warn("ensureTbmAfterPermitIssued", e);
        }
      }
      setOpenId(null); setComment("");
      load();
    } catch (e: any) {
      toast.error(e.message || "처리 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const renderPendingCard = (r: any) => {
    const kind = permitPostStepKind(r.step_position);
    const badge = permitPostStepBadge(kind);
    return (
      <Card key={r.approval_id}>
        <CardContent className="pt-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-xs">{entityTypeLabel(r.entity_type)}</Badge>
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
              <Button
                variant="outline"
                onClick={() => navigate(
                  r.entity_type === "work_permit" && r.entity_id
                    ? `/app/worker/permits?id=${r.entity_id}`
                    : mobileEntityPath(r.entity_type, r.entity_id).path,
                )}
              >
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
  };

  const renderHistoryGroups = () => {
    const entries = Object.entries(tabGroups);
    if (!projectId) {
      return (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            프로젝트를 선택하면 상신·완료·반려 이력을 볼 수 있습니다.
          </CardContent>
        </Card>
      );
    }
    if (entries.length === 0) {
      return (
        <div className="text-center text-muted-foreground py-12">
          <FileCheck2 className="h-10 w-10 mx-auto opacity-30" />
          <div className="text-sm mt-2">
            {tab === "submitted" ? "상신한 결재가 없습니다" : tab === "rejected" ? "반려 내역이 없습니다" : "완료된 결재가 없습니다"}
          </div>
        </div>
      );
    }
    return entries.map(([key, steps]) => {
      const arr = [...steps].sort((a, b) => (a.step_order ?? 99) - (b.step_order ?? 99));
      const first = arr[0];
      const entityType = first?.entity_type || "";
      const entityId = first?.entity_id || "";
      const title = first?.step || entityTypeLabel(entityType);
      const rejected = arr.some((s) => s.status === "반려");
      const allApproved = arr.every((s) => s.status === "승인" || s.status === "취소");
      return (
        <Card key={key}>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-xs">{entityTypeLabel(entityType)}</Badge>
              <Badge
                variant="outline"
                className={`text-xs ${
                  rejected
                    ? "text-destructive border-destructive/40"
                    : allApproved
                      ? "text-emerald-700 border-emerald-500/40"
                      : ""
                }`}
              >
                {rejected ? "반려" : allApproved ? "완료" : "진행중"}
              </Badge>
            </div>
            <div className="font-medium text-sm">{title}</div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              {arr.map((s) => (
                <div key={s.id}>
                  {s.step_order != null ? `${s.step_order}. ` : ""}
                  {s.step || s.position || "단계"} · {s.status}
                  {s.approver_name ? ` · ${s.approver_name}` : ""}
                </div>
              ))}
            </div>
            {entityType && entityId && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => navigate(
                  entityType === "work_permit"
                    ? `/app/worker/permits?id=${entityId}`
                    : mobileEntityPath(entityType, entityId).path,
                )}
              >
                문서 보기
              </Button>
            )}
          </CardContent>
        </Card>
      );
    });
  };

  return (
    <div className="max-w-md mx-auto" data-testid="mobile-approvals">
      <MobilePageHeader
        title="결재"
        actions={<Badge variant="secondary">{counts[tab]}건</Badge>}
      />

      <main className="px-4 pb-4 space-y-3">
        {!projectId && (
          <MobileProjectPicker
            title="결재 이력을 보려면 프로젝트 선택"
            hint="대기 결재는 전체에 표시되고, 상신·완료·반려 이력은 선택한 프로젝트 기준입니다."
          />
        )}
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="grid w-full grid-cols-4 h-auto">
            <TabsTrigger value="mine" className="text-xs px-1 py-2">대기 {counts.mine}</TabsTrigger>
            <TabsTrigger value="submitted" className="text-xs px-1 py-2">상신 {counts.submitted}</TabsTrigger>
            <TabsTrigger value="completed" className="text-xs px-1 py-2">완료 {counts.completed}</TabsTrigger>
            <TabsTrigger value="rejected" className="text-xs px-1 py-2">반려 {counts.rejected}</TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="space-y-3 mt-3">
            {loading && <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></div>}
            {!loading && pendingRows.length === 0 && (
              <div className="text-center text-muted-foreground py-12">
                <FileCheck2 className="h-10 w-10 mx-auto opacity-30" />
                <div className="text-sm mt-2">대기 중인 결재가 없습니다</div>
              </div>
            )}
            {!loading && pendingRows.map(renderPendingCard)}
          </TabsContent>

          <TabsContent value="submitted" className="space-y-3 mt-3">
            {loading ? <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></div> : renderHistoryGroups()}
          </TabsContent>
          <TabsContent value="completed" className="space-y-3 mt-3">
            {loading ? <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></div> : renderHistoryGroups()}
          </TabsContent>
          <TabsContent value="rejected" className="space-y-3 mt-3">
            {loading ? <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></div> : renderHistoryGroups()}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
