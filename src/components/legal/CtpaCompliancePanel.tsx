import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { HardHat, Plus, Sparkles, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { differenceInCalendarDays, startOfDay } from "date-fns";
import { toast } from "sonner";

type CtpaType =
  | "safety_mgmt_plan"
  | "small_safety_plan"
  | "periodic_inspection"
  | "dfs_temp_structure"
  | "csi_accident_draft";

type CtpaRecord = {
  id: string;
  record_type: CtpaType;
  title: string;
  target_date: string | null;
  status: "draft" | "in_review" | "approved" | "submitted";
  notes: string | null;
};

const CTPA_TYPES: Record<CtpaType, { label: string; legal: string }> = {
  safety_mgmt_plan: { label: "안전관리계획서", legal: "건진법 §62 (1·2종 시설물/10층 이상 등)" },
  small_safety_plan: { label: "소규모 안전관리계획서", legal: "건진법 §62의2 (2~9층·연면적 1천㎡ 이상 등)" },
  periodic_inspection: { label: "정기안전점검 일정", legal: "건진법 §62③ (착공 후 단계별 정기점검)" },
  dfs_temp_structure: { label: "DfS · 가설구조물 검토", legal: "건진법 §62·시행령 §101의2" },
  csi_accident_draft: { label: "건설사고 2시간/CSI 통보 초안", legal: "건진법 §67 (발생 2시간 이내 초기보고)" },
};

const STATUS_LABEL: Record<CtpaRecord["status"], string> = {
  draft: "작성중 (초안)",
  in_review: "감리/발주 검토중",
  approved: "승인/완료",
  submitted: "제출/신고 완료",
};

export function CtpaCompliancePanel({
  projectId,
  canEditCtpa,
  isHseManager,
}: {
  projectId: string;
  canEditCtpa: boolean;
  isHseManager: boolean;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<CtpaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiDrafting, setAiDrafting] = useState(false);
  const [form, setForm] = useState<{
    record_type: CtpaType;
    title: string;
    target_date: string;
    status: CtpaRecord["status"];
    notes: string;
  }>({
    record_type: "safety_mgmt_plan",
    title: "",
    target_date: "",
    status: "draft",
    notes: "",
  });

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("ctpa_compliance_records")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(50);
    setRows((data as CtpaRecord[]) || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAiDraft = async () => {
    setAiDrafting(true);
    try {
      const meta = CTPA_TYPES[form.record_type];
      const prompt = `건설기술진흥법(${meta.legal}) "${meta.label}" 실무 작성 초안을 4줄 이내로 정리해 주세요.
공사관리(현장대리인·공무·시공팀) 작성 기준과 발주자/감리 제출·승인 전 필수 확인 항목을 bullet으로 요약하세요.`;
      const { data, error } = await supabase.functions.invoke("safety-assistant", {
        body: { message: prompt, projectId, compact: true },
      });
      if (error || !data?.reply) {
        toast.warning("AI 보완을 건너뛰었습니다. 직접 입력하세요.");
        return;
      }
      setForm((prev) => ({
        ...prev,
        title: prev.title || meta.label,
        notes: String(data.reply).slice(0, 1200),
      }));
      toast.success("AI 건진법 초안을 채웠습니다.");
    } catch {
      toast.warning("AI 보완을 건너뛰었습니다. 직접 입력하세요.");
    } finally {
      setAiDrafting(false);
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error("문서/항목 제목을 입력하세요.");
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("ctpa_compliance_records").insert([
      {
        project_id: projectId,
        record_type: form.record_type,
        title: form.title.trim(),
        target_date: form.target_date || null,
        status: form.record_type === "csi_accident_draft" && form.status === "submitted" ? "submitted" : form.status,
        notes: form.notes.trim() || null,
        created_by: user?.id || null,
      },
    ]);
    setSaving(false);
    if (error) {
      toast.error(error.message || "저장 실패");
      return;
    }
    toast.success("건진법 서류/일정이 등록되었습니다.");
    setOpen(false);
    setForm({ record_type: "safety_mgmt_plan", title: "", target_date: "", status: "draft", notes: "" });
    load();
  };

  const handleStatusChange = async (id: string, status: CtpaRecord["status"]) => {
    const { error } = await (supabase as any)
      .from("ctpa_compliance_records")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await (supabase as any)
      .from("ctpa_compliance_records")
      .update({ is_deleted: true })
      .eq("id", id);
    if (!error) load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <HardHat className="h-4 w-4 text-primary" /> 건설기술진흥법 (건진법 §62·§62의2·§67) 공사관리 트랙
          </h2>
          <p className="text-xs text-muted-foreground">
            안전관리계획서·정기안전점검·가설구조물·건설사고 CSI 초안 (현장소장·공무·공사팀 작성 / 감리 검토 / 발주처 승인)
          </p>
        </div>
        {canEditCtpa && (
          <Button size="sm" onClick={() => setOpen(true)} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> 건진법 항목 등록
          </Button>
        )}
      </div>

      {isHseManager && !canEditCtpa && (
        <div className="rounded-md border border-blue-200 bg-blue-50/70 dark:bg-blue-950/30 p-3 text-xs text-blue-900 dark:text-blue-200 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            건진법 안전관리계획서·정기안전점검은 산안법 안전관리자 직무가 아닌 <strong>현장대리인·공무·시공팀</strong> 소관입니다. (현재 열람 전용)
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground py-6 text-center">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-muted-foreground">
            등록된 건진법 안전관리계획/정기점검 기록이 없습니다.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const dDay = r.target_date
              ? differenceInCalendarDays(startOfDay(new Date(r.target_date)), startOfDay(new Date()))
              : null;
            return (
              <Card key={r.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline">{CTPA_TYPES[r.record_type]?.label || r.record_type}</Badge>
                      <span>{r.title}</span>
                      {dDay !== null && (
                        <Badge variant={dDay < 0 ? "destructive" : dDay <= 14 ? "secondary" : "outline"}>
                          {dDay < 0 ? `D+${Math.abs(dDay)} 경과` : dDay === 0 ? "D-Day" : `D-${dDay}`} ({r.target_date})
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {canEditCtpa ? (
                        <Select value={r.status} onValueChange={(v) => handleStatusChange(r.id, v as CtpaRecord["status"])}>
                          <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">작성중 (초안)</SelectItem>
                            <SelectItem value="in_review">감리/발주 검토중</SelectItem>
                            <SelectItem value="approved">승인/완료</SelectItem>
                            <SelectItem value="submitted">제출/신고 완료</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary">{STATUS_LABEL[r.status]}</Badge>
                      )}
                      {canEditCtpa && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(r.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardTitle>
                </CardHeader>
                {r.notes && (
                  <CardContent className="text-xs text-muted-foreground whitespace-pre-line">{r.notes}</CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2 pr-6">
              <DialogTitle>건진법 서류 · 일정 등록</DialogTitle>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={aiDrafting} onClick={handleAiDraft}>
                {aiDrafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                AI 초안
              </Button>
            </div>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">구분</Label>
              <Select value={form.record_type} onValueChange={(v) => setForm({ ...form, record_type: v as CtpaType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CTPA_TYPES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label} ({v.legal})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">제목 *</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 1차 정기안전점검" />
              </div>
              <div>
                <Label className="text-xs">목표일 / 점검예정일</Label>
                <Input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">내용 / CSI 보고 초안 / 확인사항</Label>
              <Textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              {form.record_type === "csi_accident_draft" && (
                <p className="text-[11px] text-amber-700 mt-1">
                  중대건설현장사고는 발생 2시간 이내 국토부 CSI 초기통보 대상입니다. 본 시스템은 작성중 초안을 보관하며 실제 CSI 포털 제출 여부를 확인하세요.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "저장 중..." : "저장"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
