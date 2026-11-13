import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { FileCheck2, Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type Stage = "basic" | "design" | "construction";
type CheckItem = { id: string; label: string; checked: boolean };
type LedgerRow = {
  id: string;
  stage: Stage;
  title: string;
  checklist_json: CheckItem[];
  summary_notes: string | null;
  status: "draft" | "reviewed" | "confirmed";
  confirmed_by_name: string | null;
  confirmed_at: string | null;
};

const STAGE_DEFAULTS: Record<Stage, { title: string; items: string[] }> = {
  basic: {
    title: "기본안전보건대장 (계획단계 · 산안법 §67①)",
    items: [
      "공사규모·공사금액·공사기간 및 주요 위험요인 명시",
      "공사 설계 시 반드시 고려하여야 할 유해·위험요인 및 감소방안",
      "산업안전보건관리비 계상 및 설계 조건 반영",
    ],
  },
  design: {
    title: "설계안전보건대장 (설계단계 · 산안법 §67②)",
    items: [
      "설계자가 작성한 유해·위험요인 감소방안 적정성 확인",
      "안전보건조치 이행에 필요한 적정 공사기간·공사금액 산정",
      "가설구조물·특수공법 안전성 검토 결과 수록",
    ],
  },
  construction: {
    title: "공사안전보건대장 (시공단계 · 산안법 §67③)",
    items: [
      "수급인에게 설계안전보건대장 제공 및 이행계획 확인",
      "산업안전보건법 위반·중대재해 예방 이행 여부 분기/수시 확인",
      "설계변경·공법변경 시 공사안전보건대장 변경 반영",
    ],
  },
};

export function ClientSafetyLedgerPanel({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<Record<Stage, LedgerRow | null>>({
    basic: null,
    design: null,
    construction: null,
  });
  const [notes, setNotes] = useState<Record<Stage, string>>({ basic: "", design: "", construction: "" });
  const [checks, setChecks] = useState<Record<Stage, CheckItem[]>>({
    basic: STAGE_DEFAULTS.basic.items.map((l, i) => ({ id: `b${i}`, label: l, checked: false })),
    design: STAGE_DEFAULTS.design.items.map((l, i) => ({ id: `d${i}`, label: l, checked: false })),
    construction: STAGE_DEFAULTS.construction.items.map((l, i) => ({ id: `c${i}`, label: l, checked: false })),
  });
  const [savingStage, setSavingStage] = useState<Stage | null>(null);
  const [aiStage, setAiStage] = useState<Stage | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    const { data } = await (supabase as any)
      .from("client_safety_ledgers")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_deleted", false);
    const map: Record<Stage, LedgerRow | null> = { basic: null, design: null, construction: null };
    const nextNotes: Record<Stage, string> = { basic: "", design: "", construction: "" };
    const nextChecks: Record<Stage, CheckItem[]> = {
      basic: STAGE_DEFAULTS.basic.items.map((l, i) => ({ id: `b${i}`, label: l, checked: false })),
      design: STAGE_DEFAULTS.design.items.map((l, i) => ({ id: `d${i}`, label: l, checked: false })),
      construction: STAGE_DEFAULTS.construction.items.map((l, i) => ({ id: `c${i}`, label: l, checked: false })),
    };
    ((data as LedgerRow[]) || []).forEach((r) => {
      if (r.stage === "basic" || r.stage === "design" || r.stage === "construction") {
        map[r.stage] = r;
        nextNotes[r.stage] = r.summary_notes || "";
        if (Array.isArray(r.checklist_json) && r.checklist_json.length > 0) {
          nextChecks[r.stage] = r.checklist_json;
        }
      }
    });
    setRows(map);
    setNotes(nextNotes);
    setChecks(nextChecks);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAiSummary = async (stage: Stage) => {
    setAiStage(stage);
    try {
      const def = STAGE_DEFAULTS[stage];
      const prompt = `산안법 제67조 발주자 ${def.title} 확인 요약 초안을 3~4줄로 작성해 주세요.
확인 항목: ${checks[stage].map((c) => `${c.label}(${c.checked ? "완료" : "미확인"})`).join(", ")}.
발주자 입장에서 시공자 이행 확인 포인트를 간결히 적어주세요.`;
      const { data, error } = await supabase.functions.invoke("safety-assistant", {
        body: { message: prompt, projectId, compact: true },
      });
      if (error || !data?.reply) {
        toast.warning("AI 보완을 건너뛰었습니다. 직접 입력하세요.");
        return;
      }
      setNotes((prev) => ({ ...prev, [stage]: String(data.reply).slice(0, 1000) }));
      toast.success("AI 대장 요약 초안을 채웠습니다.");
    } catch {
      toast.warning("AI 보완을 건너뛰었습니다. 직접 입력하세요.");
    } finally {
      setAiStage(null);
    }
  };

  const handleSave = async (stage: Stage, confirm = false) => {
    setSavingStage(stage);
    const existing = rows[stage];
    const actorName = profile?.display_name || user?.email || "발주처 담당자";
    const payload = {
      project_id: projectId,
      stage,
      title: STAGE_DEFAULTS[stage].title,
      checklist_json: checks[stage],
      summary_notes: notes[stage].trim() || null,
      status: confirm ? "confirmed" : existing?.status === "confirmed" ? "confirmed" : "reviewed",
      confirmed_by_name: confirm ? actorName : existing?.confirmed_by_name || null,
      confirmed_at: confirm ? new Date().toISOString() : existing?.confirmed_at || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = existing
      ? await (supabase as any).from("client_safety_ledgers").update(payload).eq("id", existing.id)
      : await (supabase as any).from("client_safety_ledgers").insert([{ ...payload, created_by: user?.id || null }]);
    setSavingStage(null);
    if (error) {
      toast.error(error.message || "저장 실패");
      return;
    }
    toast.success(confirm ? "발주자 확인 완료로 기록되었습니다." : "안전보건대장이 저장되었습니다.");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <FileCheck2 className="h-4 w-4 text-primary" /> 발주자 안전보건대장 (산안법 §67 · 총공사금액 50억원 이상)
          </h2>
          <p className="text-xs text-muted-foreground">
            기본·설계·공사 3단계 안전보건대장 확인 및 이행 기록 {!canEdit && "· (발주처/관리자만 수정 가능)"}
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        {(["basic", "design", "construction"] as Stage[]).map((stage) => {
          const row = rows[stage];
          const confirmed = row?.status === "confirmed";
          return (
            <Card key={stage}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex flex-wrap items-center justify-between gap-2">
                  <span>{STAGE_DEFAULTS[stage].title}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={confirmed ? "default" : "outline"}>
                      {confirmed ? "발주자 확인완료" : row ? "검토중" : "미작성"}
                    </Badge>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={aiStage === stage}
                        onClick={() => handleAiSummary(stage)}
                      >
                        {aiStage === stage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        AI 요약 초안
                      </Button>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  {checks[stage].map((item, idx) => (
                    <label key={item.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox
                        disabled={!canEdit}
                        checked={item.checked}
                        onCheckedChange={(v) => {
                          setChecks((prev) => ({
                            ...prev,
                            [stage]: prev[stage].map((c, i) => (i === idx ? { ...c, checked: v === true } : c)),
                          }));
                        }}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
                <Textarea
                  rows={2}
                  disabled={!canEdit}
                  placeholder="단계별 확인 의견 및 비고..."
                  value={notes[stage]}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [stage]: e.target.value }))}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {row?.confirmed_at
                      ? `확인: ${row.confirmed_by_name || "발주처"} (${new Date(row.confirmed_at).toLocaleDateString("ko-KR")})`
                      : "아직 발주자 최종 확인 전입니다."}
                  </span>
                  {canEdit && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={savingStage === stage} onClick={() => handleSave(stage, false)}>
                        저장
                      </Button>
                      <Button size="sm" disabled={savingStage === stage} onClick={() => handleSave(stage, true)} className="gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> 확인 완료
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
