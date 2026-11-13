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
import { Users, Plus, Sparkles, Loader2, Wrench, Trash2 } from "lucide-react";
import { toast } from "sonner";

type MeetingType = "safety_council" | "joint_inspection" | "labor_council";

type CouncilRecord = {
  id: string;
  project_id: string;
  meeting_type: MeetingType;
  held_at: string;
  title: string;
  attendees_text: string | null;
  agenda: string | null;
  decisions: string | null;
  follow_up_action: string | null;
  linked_action_id: string | null;
};

const TYPE_META: Record<MeetingType, { label: string; legal: string }> = {
  safety_council: { label: "안전보건협의체", legal: "산안법 §64① (매월 1회 이상)" },
  joint_inspection: { label: "합동 안전보건점검", legal: "산안법 §64①③ (2개월 1회 이상)" },
  labor_council: { label: "노사협의체", legal: "산안법 §75 (2개월 1회 이상)" },
};

export function SafetyCouncilPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<CouncilRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiDrafting, setAiDrafting] = useState(false);
  const [creatingActionId, setCreatingActionId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    meeting_type: MeetingType;
    held_at: string;
    title: string;
    attendees_text: string;
    agenda: string;
    decisions: string;
    follow_up_action: string;
  }>({
    meeting_type: "safety_council",
    held_at: new Date().toISOString().slice(0, 10),
    title: "",
    attendees_text: "",
    agenda: "",
    decisions: "",
    follow_up_action: "",
  });

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("safety_council_records")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .order("held_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);
    setRows((data as CouncilRecord[]) || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAiAgendaDraft = async () => {
    if (!projectId) return;
    setAiDrafting(true);
    try {
      const [{ count: raCount }, { count: inspCount }, { count: accCount }, { count: wsCount }] = await Promise.all([
        (supabase as any).from("risk_assessment_runs").select("id", { count: "exact", head: true }).eq("project_id", projectId),
        supabase.from("safety_inspections").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_deleted", false),
        (supabase as any).from("accident_reports").select("id", { count: "exact", head: true }).eq("project_id", projectId),
        supabase.from("work_stop_requests").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      ]);
      const meta = TYPE_META[form.meeting_type];
      const prompt = `${meta.label} (${meta.legal}) 회의 안건과 결정사항 초안을 4줄 이내로 작성해 주세요.
현장 현황 요약: 위험성평가 ${raCount || 0}건, 안전점검 ${inspCount || 0}건, 사고보고 ${accCount || 0}건, 작업중지 ${wsCount || 0}건.
구체적인 도급인·수급인 공동 점검/협의 안건과 후속조치 항목을 bullet으로 간결히 적어주세요.`;
      const { data, error } = await supabase.functions.invoke("safety-assistant", {
        body: { message: prompt, projectId, compact: true },
      });
      if (error || !data?.reply) {
        toast.warning("AI 보완을 건너뛰었습니다. 직접 입력하세요.");
        return;
      }
      setForm((prev) => ({
        ...prev,
        title: prev.title || `${prev.held_at} ${meta.label}`,
        agenda: String(data.reply).slice(0, 1200),
      }));
      toast.success("AI 안건 초안을 채웠습니다. 확인 후 저장하세요.");
    } catch {
      toast.warning("AI 보완을 건너뛰었습니다. 직접 입력하세요.");
    } finally {
      setAiDrafting(false);
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error("회의/점검 제목을 입력하세요.");
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("safety_council_records").insert([
      {
        project_id: projectId,
        meeting_type: form.meeting_type,
        held_at: form.held_at,
        title: form.title.trim(),
        attendees_text: form.attendees_text.trim() || null,
        agenda: form.agenda.trim() || null,
        decisions: form.decisions.trim() || null,
        follow_up_action: form.follow_up_action.trim() || null,
        created_by: user?.id || null,
      },
    ]);
    setSaving(false);
    if (error) {
      toast.error(error.message || "저장 실패");
      return;
    }
    toast.success("협의체/합동점검 기록이 저장되었습니다.");
    setOpen(false);
    setForm({
      meeting_type: "safety_council",
      held_at: new Date().toISOString().slice(0, 10),
      title: "",
      attendees_text: "",
      agenda: "",
      decisions: "",
      follow_up_action: "",
    });
    load();
  };

  const handleCreateAction = async (rec: CouncilRecord) => {
    const issue = (rec.follow_up_action || rec.decisions || rec.title || "").trim();
    if (!issue) {
      toast.warning("후속조치 내용이 없습니다.");
      return;
    }
    setCreatingActionId(rec.id);
    try {
      const actor = profile?.display_name || user?.email || "관리자";
      const { data: insp, error: inspErr } = await (supabase as any)
        .from("safety_inspections")
        .insert([
          {
            project_id: projectId,
            inspection_type: "합동점검",
            process_category: "협의체 후속조치",
            inspector_id: user?.id || null,
            inspector_name: actor,
            inspected_at: rec.held_at,
            location: "현장 전체",
            summary: `[${TYPE_META[rec.meeting_type].label}] ${rec.title}`,
            status: "in_progress",
            created_by: user?.id || null,
            weather: "",
            patrol_photos: [],
            director_items: [],
            form_payload: { source_council_id: rec.id },
          },
        ])
        .select("id")
        .single();
      if (inspErr || !insp?.id) {
        toast.error(inspErr?.message || "점검 헤더 생성 실패");
        return;
      }
      const { data: act, error: actErr } = await (supabase as any)
        .from("safety_inspection_actions")
        .insert([
          {
            inspection_id: insp.id,
            project_id: projectId,
            issue: `[${TYPE_META[rec.meeting_type].label}] ${issue}`,
            severity: "보통",
            assignee_name: actor,
            status: "pending",
            evidence_photos: [],
            completion_note: "",
          },
        ])
        .select("id")
        .single();
      if (actErr || !act?.id) {
        toast.error(actErr?.message || "시정조치 생성 실패");
        return;
      }
      await (supabase as any)
        .from("safety_council_records")
        .update({ linked_action_id: act.id })
        .eq("id", rec.id);
      toast.success("안전점검 시정조치로 등록되었습니다.");
      load();
    } finally {
      setCreatingActionId(null);
    }
  };

  const handleSoftDelete = async (id: string) => {
    const { error } = await (supabase as any)
      .from("safety_council_records")
      .update({ is_deleted: true })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("삭제되었습니다.");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <Users className="h-4 w-4 text-primary" /> 협의체 · 합동점검 · 노사협의체 (산안법 §64·§75)
          </h2>
          <p className="text-xs text-muted-foreground">도급인-수급인 안전보건협의체, 합동점검, 노사협의체 회의록 및 시정조치 연계</p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setOpen(true)} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> 회의/점검 등록
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground py-6 text-center">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-muted-foreground">
            등록된 협의체·합동점검 기록이 없습니다. 상단 버튼으로 회의록을 추가하세요.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{TYPE_META[r.meeting_type]?.label || r.meeting_type}</Badge>
                    <span>{r.title}</span>
                    <span className="text-xs font-normal text-muted-foreground">{r.held_at}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {r.linked_action_id ? (
                      <Badge variant="secondary">시정조치 연계됨</Badge>
                    ) : (
                      canEdit && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          disabled={creatingActionId === r.id}
                          onClick={() => handleCreateAction(r)}
                        >
                          <Wrench className="h-3 w-3" />
                          {creatingActionId === r.id ? "생성 중..." : "시정조치 생성"}
                        </Button>
                      )
                    )}
                    {canEdit && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleSoftDelete(r.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1 text-muted-foreground">
                {r.attendees_text && <p><strong>참석자:</strong> {r.attendees_text}</p>}
                {r.agenda && <p className="whitespace-pre-line"><strong>안건:</strong> {r.agenda}</p>}
                {r.decisions && <p className="whitespace-pre-line"><strong>결정사항:</strong> {r.decisions}</p>}
                {r.follow_up_action && <p className="text-foreground"><strong>후속조치:</strong> {r.follow_up_action}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2 pr-6">
              <DialogTitle>협의체 · 합동점검 기록 등록</DialogTitle>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={aiDrafting} onClick={handleAiAgendaDraft}>
                {aiDrafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                AI 안건 초안
              </Button>
            </div>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">구분</Label>
                <Select value={form.meeting_type} onValueChange={(v) => setForm({ ...form, meeting_type: v as MeetingType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="safety_council">안전보건협의체 (§64)</SelectItem>
                    <SelectItem value="joint_inspection">합동 안전보건점검 (§64)</SelectItem>
                    <SelectItem value="labor_council">노사협의체 (§75)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">개최/점검일</Label>
                <Input type="date" value={form.held_at} onChange={(e) => setForm({ ...form, held_at: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">제목 *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 11월 정기 안전보건협의체" />
            </div>
            <div>
              <Label className="text-xs">참석자 (원청·협력사 대표/근로자대표)</Label>
              <Input value={form.attendees_text} onChange={(e) => setForm({ ...form, attendees_text: e.target.value })} placeholder="예: 현장소장, 안전관리자, 협력사 소장 3명" />
            </div>
            <div>
              <Label className="text-xs">회의/점검 안건</Label>
              <Textarea rows={3} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">결정·합의 사항</Label>
              <Textarea rows={2} value={form.decisions} onChange={(e) => setForm({ ...form, decisions: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">후속조치 필요사항 (시정조치 생성 시 자동 반영)</Label>
              <Input value={form.follow_up_action} onChange={(e) => setForm({ ...form, follow_up_action: e.target.value })} placeholder="예: 2층 개구부 안전난간 보강" />
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
