import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import IMESafeTextarea from "@/components/IMESafeTextarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Camera, CheckCircle2, XCircle, MinusCircle, Loader2, AlertTriangle, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { buildChecklist, INSPECTION_TYPE_LABELS, PROCESS_CATEGORIES, type InspectionType } from "@/lib/inspectionTemplates";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useAuditLog } from "@/hooks/useAuditLog";
import { correctTerms } from "@/lib/termCorrection";

// 모바일 안전점검 — 데스크톱과 동일한 구조(점검 유형/공종/담당자 선택 → 체크리스트 → 항목별 합/불/해당없음 + 사진)
type Step = "setup" | "checklist";
type Member = { user_id: string; display_name: string; role: string };

export default function MobileInspect() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { projectId, companyId } = useMobileAccess();
  const { log: auditLog } = useAuditLog();

  const [step, setStep] = useState<Step>("setup");
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({
    inspection_type: "pre_work" as InspectionType,
    process_category: "굴착",
    location: "",
    summary: "",
    inspector_name: profile?.display_name || "",
    inspector_id: profile?.user_id || "",
  });
  const [creating, setCreating] = useState(false);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      const { data: pm } = await supabase
        .from("project_members")
        .select("user_id, role_new")
        .eq("project_id", projectId);
      const ids = ((pm as any) || []).map((m: any) => m.user_id);
      if (ids.length === 0) { setMembers([]); return; }
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids);
      const map = new Map(((profs as any) || []).map((p: any) => [p.user_id, p.display_name]));
      setMembers(((pm as any) || []).map((m: any) => ({
        user_id: m.user_id,
        display_name: map.get(m.user_id) || "이름없음",
        role: m.role_new,
      })));
    })();
  }, [projectId]);

  const checklistPreview = useMemo(
    () => buildChecklist(form.inspection_type, form.process_category),
    [form.inspection_type, form.process_category]
  );

  const startInspection = async () => {
    if (!projectId) return toast.error("프로젝트를 먼저 선택하세요");
    if (!form.location.trim()) return toast.error("점검 위치를 입력하세요");
    setCreating(true);
    try {
      const { data: ins, error } = await supabase.from("safety_inspections" as any).insert({
        project_id: projectId,
        company_id: companyId,
        inspection_type: form.inspection_type,
        process_category: form.process_category,
        location: correctTerms(form.location),
        summary: correctTerms(form.summary),
        inspector_name: form.inspector_name || profile?.display_name || "",
        inspector_id: form.inspector_id || profile?.user_id,
        created_by: profile?.user_id,
        status: "in_progress",
      }).select().single();
      if (error) throw error;
      await auditLog("create", "safety_inspection", (ins as any).id, projectId, {
        inspection_type: form.inspection_type,
        process_category: form.process_category,
        location: form.location,
      });

      const checklist = buildChecklist(form.inspection_type, form.process_category);
      const rows = checklist.map((c, i) => ({
        inspection_id: (ins as any).id,
        checklist_code: c.code,
        label: c.label,
        legal_basis: c.legal_basis,
        sort_order: i,
      }));
      if (rows.length) {
        await supabase.from("safety_inspection_items" as any).insert(rows);
      }
      const { data: created } = await supabase.from("safety_inspection_items" as any)
        .select("*").eq("inspection_id", (ins as any).id).order("sort_order");
      setItems(((created as any) || []).map((x: any) => ({ ...x, photos: x.photos || [] })));
      setInspectionId((ins as any).id);
      setStep("checklist");
    } catch (e: any) {
      toast.error("생성 실패: " + e.message);
    } finally {
      setCreating(false);
    }
  };

  const uploadPhoto = async (file: File): Promise<string> => {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${projectId}/mobile-inspect/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("attachments").upload(path, file);
    if (error) throw error;
    return supabase.storage.from("attachments").getPublicUrl(path).data.publicUrl;
  };

  const setResult = async (item: any, result: "pass" | "fail" | "na") => {
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, result } : x));
    await supabase.from("safety_inspection_items" as any).update({ result }).eq("id", item.id);
    if (result === "fail") {
      const { data: existing } = await supabase.from("safety_inspection_actions" as any)
        .select("id").eq("item_id", item.id).maybeSingle();
      if (!existing) {
        await supabase.from("safety_inspection_actions" as any).insert({
          inspection_id: inspectionId,
          item_id: item.id,
          project_id: projectId,
          issue: item.label,
          severity: "medium",
          status: "pending",
        });
        try {
          const { data: m } = await supabase.from("project_members")
            .select("user_id, role_new").eq("project_id", projectId)
            .in("role_new", ["project_admin", "safety_manager"]);
          const { sendNotification } = await import("@/lib/notificationService");
          await Promise.all(((m as any) || []).map((x: any) =>
            sendNotification({
              user_id: x.user_id,
              title: "안전점검 불합격",
              message: `${form.location} · ${item.label}`,
              type: "inspection_fail",
              related_id: inspectionId!,
              related_type: "safety_inspection",
              project_id: projectId,
            })
          ));
        } catch {}
      }
    }
  };

  const onPickPhoto = async (item: any, files: FileList | null) => {
    if (!files || !files.length) return;
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, 3)) urls.push(await uploadPhoto(f));
      const next = [...(item.photos || []), ...urls];
      await supabase.from("safety_inspection_items" as any).update({ photos: next }).eq("id", item.id);
      setItems(prev => prev.map(x => x.id === item.id ? { ...x, photos: next } : x));
    } catch (e: any) {
      toast.error("사진 업로드 실패: " + e.message);
    }
  };

  const setNote = async (item: any, note: string) => {
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, note } : x));
  };
  const flushNote = async (item: any) => {
    await supabase.from("safety_inspection_items" as any).update({ note: item.note || "" }).eq("id", item.id);
  };

  const completeInspection = async () => {
    if (!inspectionId) return;
    const unset = items.filter(i => !i.result).length;
    if (unset > 0 && !confirm(`미체크 항목이 ${unset}건 있습니다. 그래도 완료할까요?`)) return;
    const hasFail = items.some(i => i.result === "fail");
    const nextStatus = hasFail ? "in_progress" : "completed";
    const { error } = await supabase.from("safety_inspections" as any)
      .update({ status: nextStatus }).eq("id", inspectionId);
    if (error) { toast.error("저장 실패: " + error.message); return; }
    await auditLog("update", "safety_inspection", inspectionId, projectId, {
      status: nextStatus, pass: items.filter(i=>i.result==='pass').length,
      fail: items.filter(i=>i.result==='fail').length,
    });
    toast.success(hasFail ? "조치 필요 항목과 함께 저장됨" : "점검 완료");
    navigate("/m");
  };

  const okCount = items.filter(i => i.result === "pass").length;
  const failCount = items.filter(i => i.result === "fail").length;
  const naCount = items.filter(i => i.result === "na").length;
  const total = items.length;

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground"
          onClick={() => step === "checklist" ? setStep("setup") : navigate("/m")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">현장 안전점검</div>
        {step === "checklist" && (
          <Badge variant="secondary">{okCount + failCount + naCount}/{total}</Badge>
        )}
      </header>

      <main className="p-4 space-y-4 max-w-md mx-auto">
        {step === "setup" && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div>
                <Label className="text-base">점검 유형 *</Label>
                <Select value={form.inspection_type}
                  onValueChange={(v) => setForm({ ...form, inspection_type: v as InspectionType })}>
                  <SelectTrigger className="h-12 text-base"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(INSPECTION_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-base">공종(작업종류) *</Label>
                <Select value={form.process_category}
                  onValueChange={(v) => setForm({ ...form, process_category: v })}>
                  <SelectTrigger className="h-12 text-base"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROCESS_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    <SelectItem value="기타">기타</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-base">점검자 *</Label>
                <Select value={form.inspector_id || "_self"}
                  onValueChange={(v) => {
                    if (v === "_self") {
                      setForm({ ...form, inspector_id: profile?.user_id || "", inspector_name: profile?.display_name || "" });
                    } else {
                      const m = members.find(x => x.user_id === v);
                      setForm({ ...form, inspector_id: v, inspector_name: m?.display_name || "" });
                    }
                  }}>
                  <SelectTrigger className="h-12 text-base"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_self">본인 ({profile?.display_name || "나"})</SelectItem>
                    {members.filter(m => m.user_id !== profile?.user_id).map(m => (
                      <SelectItem key={m.user_id} value={m.user_id}>{m.display_name} · {m.role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-base">점검 위치 *</Label>
                <Input className="h-12 text-base" value={form.location}
                  onChange={e => setForm({ ...form, location: e.target.value })}
                  placeholder="예: 3층 동측 굴착부" />
              </div>

              <div>
                <Label className="text-base">개요/메모</Label>
                <IMESafeTextarea defaultValue={form.summary}
                  onCommit={(val) => setForm({ ...form, summary: val })}
                  placeholder="필요 시 메모" rows={2} />
              </div>

              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                자동 생성 체크리스트 미리보기: <strong>{checklistPreview.length}개 항목</strong>
              </div>

              <Button className="w-full h-14 text-base" onClick={startInspection} disabled={creating}>
                {creating && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
                체크리스트 시작
                <ChevronRight className="h-5 w-5 ml-1" />
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "checklist" && (
          <>
            <Card>
              <CardContent className="pt-4">
                <div className="text-sm font-bold">{INSPECTION_TYPE_LABELS[form.inspection_type]} · {form.process_category}</div>
                <div className="text-xs text-muted-foreground">{form.location}</div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                  <div className="rounded bg-success/10 text-success p-2 font-bold">합격 {okCount}</div>
                  <div className="rounded bg-destructive/10 text-destructive p-2 font-bold">불합격 {failCount}</div>
                  <div className="rounded bg-muted p-2 font-bold">해당없음 {naCount}</div>
                </div>
              </CardContent>
            </Card>

            {items.map((it, idx) => (
              <Card key={it.id} className={
                it.result === "fail" ? "border-destructive/50" :
                it.result === "pass" ? "border-success/50" : ""
              }>
                <CardContent className="pt-4 space-y-3">
                  <div>
                    <div className="text-xs text-muted-foreground">{idx + 1} / {items.length} · {it.checklist_code}</div>
                    <div className="font-semibold text-base mt-0.5">{it.label}</div>
                    {it.legal_basis && (
                      <div className="text-[11px] text-muted-foreground mt-1">근거: {it.legal_basis}</div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <Button size="sm" variant={it.result === "pass" ? "default" : "outline"}
                      className={`h-12 ${it.result === "pass" ? "bg-success hover:bg-success" : ""}`}
                      onClick={() => setResult(it, "pass")}>
                      <CheckCircle2 className="h-4 w-4 mr-1" />합격
                    </Button>
                    <Button size="sm" variant={it.result === "fail" ? "destructive" : "outline"}
                      className="h-12" onClick={() => setResult(it, "fail")}>
                      <XCircle className="h-4 w-4 mr-1" />불합격
                    </Button>
                    <Button size="sm" variant={it.result === "na" ? "secondary" : "outline"}
                      className="h-12" onClick={() => setResult(it, "na")}>
                      <MinusCircle className="h-4 w-4 mr-1" />해당없음
                    </Button>
                  </div>

                  {it.result === "fail" && (
                    <div className="space-y-2 border border-destructive/30 rounded-lg p-2 bg-destructive/5">
                      <div className="flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" /> 자동으로 조치 요청이 생성됩니다.
                      </div>
                      <IMESafeTextarea placeholder="발견 사항/조치 의견" rows={2} defaultValue={it.note || ""}
                        onCommit={async (val) => {
                          setNote(it, val);
                          await supabase.from("safety_inspection_items" as any).update({ note: val || "" }).eq("id", it.id);
                        }} />
                      <label className="block">
                        <div className="border-2 border-dashed rounded p-3 text-center text-sm active:bg-muted">
                          <Camera className="h-5 w-5 inline mr-1" /> 사진 추가
                        </div>
                        <input type="file" accept="image/*" capture="environment" multiple className="hidden"
                          onChange={e => onPickPhoto(it, e.target.files)} />
                      </label>
                      {it.photos?.length > 0 && (
                        <div className="grid grid-cols-3 gap-1">
                          {it.photos.map((u: string, i: number) => (
                            <img key={i} src={u} className="aspect-square object-cover rounded" />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            <Button className="w-full h-14 text-base" onClick={completeInspection}>
              점검 완료 저장
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
