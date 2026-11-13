import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

type ActionStatus = "pending" | "rest" | "reassigned" | "sent_home" | "cleared";

type AbnormalLog = {
  id: string;
  worker_id: string;
  log_date: string;
  body_temp: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  symptoms: string[] | null;
  fit_to_work: boolean;
  note: string | null;
  action_status: ActionStatus;
  action_note: string | null;
  action_taken_at: string | null;
  action_taken_by_name: string | null;
  workers?: { name?: string | null; company_name?: string | null; trade?: string | null } | null;
};

const ACTION_LABELS: Record<ActionStatus, string> = {
  pending: "조치 대기",
  rest: "휴식 조치",
  reassigned: "경작업 전환",
  sent_home: "귀가 조치",
  cleared: "이상없음 확인",
};

export function DailyHealthAbnormalPanel({ projectId }: { projectId: string }) {
  const { user, profile } = useAuth();
  const [logs, setLogs] = useState<AbnormalLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftStatus, setDraftStatus] = useState<Record<string, ActionStatus>>({});
  const [draftNote, setDraftNote] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const { data, error } = await (supabase as any)
      .from("worker_daily_health_logs")
      .select("id, worker_id, log_date, body_temp, bp_systolic, bp_diastolic, symptoms, fit_to_work, note, action_status, action_note, action_taken_at, action_taken_by_name, workers(name, company_name, trade)")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .gte("log_date", since)
      .order("log_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data) {
      const abnormal = (data as AbnormalLog[]).filter(
        (r) =>
          !r.fit_to_work ||
          (Array.isArray(r.symptoms) && r.symptoms.length > 0) ||
          (r.body_temp != null && Number(r.body_temp) >= 37.5) ||
          (r.bp_systolic != null && Number(r.bp_systolic) >= 160),
      );
      setLogs(abnormal);
      const nextStatus: Record<string, ActionStatus> = {};
      const nextNote: Record<string, string> = {};
      abnormal.forEach((r) => {
        nextStatus[r.id] = r.action_status || "pending";
        nextNote[r.id] = r.action_note || "";
      });
      setDraftStatus(nextStatus);
      setDraftNote(nextNote);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAiGuide = async (row: AbnormalLog) => {
    setAiLoadingId(row.id);
    try {
      const prompt = `건설현장 근로자 일일 건강이상 조치 가이드(산안법·폭염/한파/뇌심혈관 예방 기준 2줄 요약):
공종: ${row.workers?.trade || "일반"} / 체온: ${row.body_temp ?? "-"}°C / 혈압: ${row.bp_systolic ?? "-"}/${row.bp_diastolic ?? "-"} / 증상: ${(row.symptoms || []).join(", ") || "없음"} / 작업가능여부: ${row.fit_to_work ? "가능" : "제한필요"} / 비고: ${row.note || "없음"}
권장 조치(휴식/경작업 전환/귀가)와 현장 확인사항을 한 문단으로 짧게 제안하세요.`;
      const { data, error } = await supabase.functions.invoke("safety-assistant", {
        body: { message: prompt, projectId, compact: true },
      });
      if (error || !data?.reply) {
        toast.warning("AI 조언을 불러오지 못했습니다. 현장 기준에 따라 직접 입력하세요.");
        return;
      }
      setDraftNote((prev) => ({ ...prev, [row.id]: String(data.reply).slice(0, 300) }));
      toast.success("AI 권장 조치 초안을 채웠습니다. 확인 후 저장하세요.");
    } catch {
      toast.warning("AI 조언을 불러오지 못했습니다. 직접 입력하세요.");
    } finally {
      setAiLoadingId(null);
    }
  };

  const handleSaveAction = async (row: AbnormalLog) => {
    const status = draftStatus[row.id] || "pending";
    const note = (draftNote[row.id] || "").trim();
    if (status === "pending") {
      toast.warning("조치 구분(휴식·경작업 전환·귀가·이상없음 확인)을 선택하세요.");
      return;
    }
    setSavingId(row.id);
    const actorName = profile?.display_name || user?.email || "관리자";
    const { error } = await (supabase as any)
      .from("worker_daily_health_logs")
      .update({
        action_status: status,
        action_note: note || null,
        action_taken_at: new Date().toISOString(),
        action_taken_by: user?.id || null,
        action_taken_by_name: actorName,
      })
      .eq("id", row.id);
    setSavingId(null);
    if (error) {
      toast.error(error.message || "조치 저장 실패");
      return;
    }
    toast.success("건강이상 후속 조치가 기록되었습니다.");
    load();
  };

  const pendingCount = logs.filter((r) => r.action_status === "pending").length;

  return (
    <Card className={pendingCount > 0 ? "border-amber-400" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <AlertTriangle className={`h-4 w-4 ${pendingCount > 0 ? "text-amber-600" : "text-muted-foreground"}`} />
            일일 건강이상 후속조치 (최근 7일)
          </span>
          <Badge variant={pendingCount > 0 ? "destructive" : "secondary"}>
            미조치 {pendingCount}건 / 전체 {logs.length}건
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">불러오는 중...</p>
        ) : logs.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            최근 7일 내 작업제한 또는 건강이상 보고가 없습니다.
          </div>
        ) : (
          logs.map((r) => (
            <div key={r.id} className="rounded-md border p-3 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">
                  {r.log_date} · {r.workers?.name || "근로자"} ({r.workers?.company_name || "-"} / {r.workers?.trade || "-"})
                </div>
                <Badge variant={r.action_status === "pending" ? "destructive" : "outline"}>
                  {ACTION_LABELS[r.action_status] || r.action_status}
                </Badge>
              </div>
              <div className="text-muted-foreground flex flex-wrap gap-3">
                <span>체온: {r.body_temp ?? "-"}°C</span>
                <span>혈압: {r.bp_systolic ?? "-"}/{r.bp_diastolic ?? "-"}</span>
                <span>증상: {r.symptoms?.length ? r.symptoms.join(", ") : "없음"}</span>
                {!r.fit_to_work && <span className="text-destructive font-semibold">작업 제한 필요</span>}
                {r.note && <span>비고: {r.note}</span>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr_auto_auto] gap-2 pt-1">
                <Select
                  value={draftStatus[r.id] || "pending"}
                  onValueChange={(v) => setDraftStatus((prev) => ({ ...prev, [r.id]: v as ActionStatus }))}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">조치 대기</SelectItem>
                    <SelectItem value="rest">휴식 조치</SelectItem>
                    <SelectItem value="reassigned">경작업 전환</SelectItem>
                    <SelectItem value="sent_home">귀가 조치</SelectItem>
                    <SelectItem value="cleared">이상없음 확인</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  className="h-8 text-xs"
                  placeholder="조치 내용 (예: 그늘 휴식 30분 후 재측정 정상)"
                  value={draftNote[r.id] ?? ""}
                  onChange={(e) => setDraftNote((prev) => ({ ...prev, [r.id]: e.target.value }))}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1"
                  disabled={aiLoadingId === r.id}
                  onClick={() => handleAiGuide(r)}
                >
                  {aiLoadingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  AI 조치 가이드
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={savingId === r.id}
                  onClick={() => handleSaveAction(r)}
                >
                  {savingId === r.id ? "저장 중..." : "조치 저장"}
                </Button>
              </div>
              {r.action_taken_at && (
                <p className="text-[11px] text-muted-foreground">
                  최근 조치: {r.action_taken_by_name || "관리자"} ({new Date(r.action_taken_at).toLocaleString("ko-KR")})
                </p>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
