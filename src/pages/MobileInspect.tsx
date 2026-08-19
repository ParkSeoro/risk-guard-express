import { useEffect, useMemo, useState } from "react";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import IMESafeTextarea from "@/components/IMESafeTextarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Camera, CheckCircle2, XCircle, MinusCircle, Loader2, AlertTriangle, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { buildChecklist, INSPECTION_TYPE_LABELS, PROCESS_CATEGORIES, type InspectionType } from "@/lib/inspectionTemplates";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useAuditLog } from "@/hooks/useAuditLog";
import { correctTerms } from "@/lib/termCorrection";
import { uploadAttachmentFile } from "@/lib/compressUploadFile";
import { fetchTodayPermitRoute } from "@/lib/legalForms/fetchTodayPermitRoute";
import {
  PATROL_INSPECTION_CATEGORY,
  PATROL_LOG_DISCLAIMER,
  PATROL_LOG_TITLE,
  PATROL_PROCESS_CATEGORY,
  formatInspectorLine,
  inspectorTitleFromMember,
  isPatrolInspection,
  formatInspectedAtKo,
} from "@/lib/legalForms/patrolLog";

const inspectionSetupSchema = z.object({
  inspection_type: z.string().min(1),
  process_category: z.string().min(1),
  location: z.string().trim().min(2, "순회 구간(위치)을 2자 이상 입력하세요").max(400),
  summary: z.string().trim().max(2000).optional(),
  inspector_name: z.string().trim().max(100).optional(),
});

type Step = "setup" | "checklist";
type Member = { user_id: string; display_name: string; role: string; position: string | null };

export default function MobileInspect() {
  const goMobileHome = useNavigateMobileHome();
  const { profile } = useAuth();
  const { projectId, companyId, role } = useMobileAccess();
  const { log: auditLog } = useAuditLog();

  const [step, setStep] = useState<Step>("setup");
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({
    inspection_type: "patrol" as InspectionType,
    process_category: PATROL_PROCESS_CATEGORY,
    location: "",
    summary: "",
    inspector_name: profile?.display_name || "",
    inspector_id: profile?.user_id || "",
  });
  const [creating, setCreating] = useState(false);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [projectName, setProjectName] = useState("");
  const [inspectorTitle, setInspectorTitle] = useState("");
  const [todayRoute, setTodayRoute] = useState("");
  const [findingText, setFindingText] = useState("");
  const [addingFinding, setAddingFinding] = useState(false);
  const patrol = isPatrolInspection(form.inspection_type);

  useEffect(() => {
    if (profile?.user_id && !form.inspector_id) {
      setForm(f => ({
        ...f,
        inspector_id: profile.user_id,
        inspector_name: profile.display_name || "",
      }));
    }
  }, [profile?.user_id]);

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      const [{ data: pm }, { data: proj }, route] = await Promise.all([
        supabase
          .from("project_members")
          .select("user_id, role_new, position_new")
          .eq("project_id", projectId),
        supabase.from("projects").select("name, site_name").eq("id", projectId).maybeSingle(),
        fetchTodayPermitRoute(projectId),
      ]);
      const ids = ((pm as any) || []).map((m: any) => m.user_id);
      let nameMap = new Map<string, string>();
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", ids);
        nameMap = new Map(((profs as any) || []).map((p: any) => [p.user_id, p.display_name]));
      }
      const list: Member[] = ((pm as any) || []).map((m: any) => ({
        user_id: m.user_id,
        display_name: nameMap.get(m.user_id) || "이름없음",
        role: m.role_new,
        position: m.position_new || null,
      }));
      setMembers(list);
      const site = [proj?.name, proj?.site_name].filter(Boolean).join(" / ");
      setProjectName(site || "");
      setTodayRoute(route);
      const self = list.find(m => m.user_id === profile?.user_id);
      const title = inspectorTitleFromMember({
        position: self?.position,
        role: self?.role || role,
      });
      setInspectorTitle(title);
      setForm(f => {
        if (!isPatrolInspection(f.inspection_type)) return f;
        const next = { ...f };
        if (!next.location.trim() && route) next.location = route;
        if (!next.process_category || next.process_category === "굴착") {
          next.process_category = PATROL_PROCESS_CATEGORY;
        }
        return next;
      });
    })();
  }, [projectId, profile?.user_id, role]);

  useEffect(() => {
    if (!patrol) return;
    setForm(f => ({
      ...f,
      process_category: PATROL_PROCESS_CATEGORY,
      location: f.location.trim() ? f.location : todayRoute,
    }));
  }, [patrol, todayRoute]);

  const checklistPreview = useMemo(
    () => buildChecklist(form.inspection_type, form.process_category),
    [form.inspection_type, form.process_category]
  );

  const startInspection = async () => {
    if (!projectId) return toast.error("프로젝트를 먼저 선택하세요");
    const payload = {
      ...form,
      process_category: patrol ? PATROL_PROCESS_CATEGORY : form.process_category,
    };
    const parsed = inspectionSetupSchema.safeParse(payload);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message || "입력값을 확인하세요");
    setCreating(true);
    try {
      const { data: ins, error } = await supabase.from("safety_inspections" as any).insert({
        project_id: projectId,
        company_id: companyId,
        inspection_type: payload.inspection_type,
        process_category: payload.process_category,
        inspection_category: patrol ? PATROL_INSPECTION_CATEGORY : null,
        location: correctTerms(payload.location),
        summary: correctTerms(payload.summary),
        inspector_name: payload.inspector_name || profile?.display_name || "",
        inspector_id: payload.inspector_id || profile?.user_id,
        created_by: profile?.user_id,
        status: "in_progress",
      }).select().single();
      if (error) throw error;
      await auditLog("create", "safety_inspection", (ins as any).id, projectId, {
        inspection_type: payload.inspection_type,
        process_category: payload.process_category,
        location: payload.location,
      });

      const checklist = buildChecklist(payload.inspection_type as InspectionType, payload.process_category);
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
    const uploaded = await uploadAttachmentFile(path, file);
    return uploaded.publicUrl;
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

  const addFinding = async () => {
    const label = findingText.trim();
    if (!inspectionId || !label) return toast.error("발견사항을 입력하세요");
    setAddingFinding(true);
    try {
      const sort = items.length;
      const { data, error } = await supabase.from("safety_inspection_items" as any).insert({
        inspection_id: inspectionId,
        checklist_code: `PT-FIND-${sort + 1}`,
        label: correctTerms(label),
        legal_basis: "산업안전보건법 시행령 제18조제1항제5호",
        sort_order: sort,
        result: "fail",
        note: "",
      }).select().single();
      if (error) throw error;
      const row = { ...(data as any), photos: [] };
      setItems(prev => [...prev, row]);
      setFindingText("");
      await setResult(row, "fail");
    } catch (e: any) {
      toast.error("추가 실패: " + e.message);
    } finally {
      setAddingFinding(false);
    }
  };

  const completeInspection = async () => {
    if (!inspectionId) return;
    if (patrol) {
      const hasFact = items.some(i => i.result || (i.note && i.note.trim()) || (i.photos || []).length);
      if (!hasFact && !confirm("관찰 결과·사진이 없습니다. 그래도 저장할까요?")) return;
    } else {
      const unset = items.filter(i => !i.result).length;
      if (unset > 0 && !confirm(`미체크 항목이 ${unset}건 있습니다. 그래도 완료할까요?`)) return;
    }
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
    goMobileHome();
  };

  const okCount = items.filter(i => i.result === "pass").length;
  const failCount = items.filter(i => i.result === "fail").length;
  const naCount = items.filter(i => i.result === "na").length;
  const total = items.length;
  const inspectorLine = formatInspectorLine(form.inspector_name || profile?.display_name || "", inspectorTitle);

  const applyInspector = (userId: string) => {
    const m = members.find(x => x.user_id === userId);
    const isSelf = userId === profile?.user_id;
    const title = inspectorTitleFromMember({
      position: m?.position,
      role: m?.role || (isSelf ? role : undefined),
    });
    setInspectorTitle(title);
    setForm({
      ...form,
      inspector_id: userId,
      inspector_name: isSelf ? (profile?.display_name || "") : (m?.display_name || ""),
    });
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground"
          onClick={() => step === "checklist" ? setStep("setup") : goMobileHome()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">{patrol ? PATROL_LOG_TITLE : "현장 안전점검"}</div>
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
                  onValueChange={(v) => {
                    const next = v as InspectionType;
                    setForm({
                      ...form,
                      inspection_type: next,
                      process_category: isPatrolInspection(next)
                        ? PATROL_PROCESS_CATEGORY
                        : (form.process_category === PATROL_PROCESS_CATEGORY ? "굴착" : form.process_category),
                      location: isPatrolInspection(next) && !form.location.trim() ? todayRoute : form.location,
                    });
                  }}>
                  <SelectTrigger className="h-12 text-base"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(INSPECTION_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {patrol && (
                <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
                  <div><span className="text-muted-foreground">현장명</span> · <strong>{projectName || "불러오는 중"}</strong></div>
                  <div><span className="text-muted-foreground">일시</span> · {formatInspectedAtKo(new Date().toISOString())}</div>
                  <div><span className="text-muted-foreground">점검자·직책</span> · {inspectorLine || "-"}</div>
                  <p className="text-[11px] text-muted-foreground pt-1">{PATROL_LOG_DISCLAIMER}</p>
                </div>
              )}

              {!patrol && (
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
              )}

              <div>
                <Label className="text-base">점검자 *</Label>
                <Select value={form.inspector_id || undefined} onValueChange={applyInspector}>
                  <SelectTrigger className="h-12 text-base">
                    <SelectValue placeholder="점검자 선택">
                      {inspectorLine || (profile?.user_id === form.inspector_id ? `본인 (${profile?.display_name || "나"})` : "")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {profile?.user_id && (
                      <SelectItem value={profile.user_id}>본인 ({profile.display_name || "나"})</SelectItem>
                    )}
                    {members.filter(m => m.user_id !== profile?.user_id).map(m => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {formatInspectorLine(m.display_name, inspectorTitleFromMember({ position: m.position, role: m.role }))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-base">{patrol ? "순회 구간 *" : "점검 위치 *"}</Label>
                <Input className="h-12 text-base" value={form.location}
                  onChange={e => setForm({ ...form, location: e.target.value })}
                  placeholder={patrol ? "당일 허가서 위치가 자동으로 채워집니다" : "예: 3층 동측 굴착부"} />
                {patrol && todayRoute && form.location !== todayRoute && (
                  <Button type="button" variant="ghost" size="sm" className="mt-1 h-8 text-xs"
                    onClick={() => setForm({ ...form, location: todayRoute })}>
                    당일 허가서 구간으로 채우기
                  </Button>
                )}
              </div>

              <div>
                <Label className="text-base">{patrol ? "특이사항(선택)" : "개요/메모"}</Label>
                <IMESafeTextarea defaultValue={form.summary}
                  onCommit={(val) => setForm({ ...form, summary: val })}
                  placeholder={patrol ? "구간 전체 메모. 항목별 사진은 다음 화면에서" : "필요 시 메모"} rows={2} />
              </div>

              {!patrol && (
                <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                  자동 생성 체크리스트 미리보기: <strong>{checklistPreview.length}개 항목</strong>
                </div>
              )}

              <Button className="w-full h-14 text-base" onClick={startInspection} disabled={creating}>
                {creating && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
                {patrol ? "순회점검 시작" : "체크리스트 시작"}
                <ChevronRight className="h-5 w-5 ml-1" />
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "checklist" && (
          <>
            <Card>
              <CardContent className="pt-4">
                <div className="text-sm font-bold">
                  {patrol ? PATROL_LOG_TITLE : `${INSPECTION_TYPE_LABELS[form.inspection_type]} · ${form.process_category}`}
                </div>
                <div className="text-xs text-muted-foreground">{form.location}</div>
                {patrol && (
                  <div className="text-xs text-muted-foreground mt-1">{inspectorLine} · {projectName}</div>
                )}
                <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                  <div className="rounded bg-success/10 text-success p-2 font-bold">이상없음 {okCount}</div>
                  <div className="rounded bg-destructive/10 text-destructive p-2 font-bold">조치필요 {failCount}</div>
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
                      <CheckCircle2 className="h-4 w-4 mr-1" />{patrol ? "이상없음" : "합격"}
                    </Button>
                    <Button size="sm" variant={it.result === "fail" ? "destructive" : "outline"}
                      className="h-12" onClick={() => setResult(it, "fail")}>
                      <XCircle className="h-4 w-4 mr-1" />{patrol ? "조치필요" : "불합격"}
                    </Button>
                    <Button size="sm" variant={it.result === "na" ? "secondary" : "outline"}
                      className="h-12" onClick={() => setResult(it, "na")}>
                      <MinusCircle className="h-4 w-4 mr-1" />해당없음
                    </Button>
                  </div>

                  {(patrol || it.result === "fail") && (
                    <div className={`space-y-2 rounded-lg p-2 ${it.result === "fail" ? "border border-destructive/30 bg-destructive/5" : "border bg-muted/30"}`}>
                      {it.result === "fail" && (
                        <div className="flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="h-3.5 w-3.5" /> 자동으로 조치 요청이 생성됩니다.
                        </div>
                      )}
                      <IMESafeTextarea placeholder={patrol ? "발견 사항 / 즉시조치" : "발견 사항/조치 의견"} rows={2} defaultValue={it.note || ""}
                        onCommit={async (val) => {
                          setNote(it, val);
                          await supabase.from("safety_inspection_items" as any).update({ note: val || "" }).eq("id", it.id);
                        }} />
                      <div>
                        <input
                          id={`photo-input-${it.id}`}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          multiple
                          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                          onChange={e => { onPickPhoto(it, e.target.files); e.target.value = ""; }}
                        />
                        <button
                          type="button"
                          className="w-full border-2 border-dashed rounded p-3 text-center text-sm active:bg-muted"
                          onClick={() => {
                            const el = document.getElementById(`photo-input-${it.id}`) as HTMLInputElement | null;
                            el?.click();
                          }}
                        >
                          <Camera className="h-5 w-5 inline mr-1" /> 사진 추가 / 촬영
                        </button>
                      </div>
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

            {patrol && (
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <Label>추가 발견사항</Label>
                  <Input value={findingText} onChange={e => setFindingText(e.target.value)}
                    placeholder="체크리스트에 없는 이상 내용을 적고 추가" />
                  <Button className="w-full" variant="outline" onClick={addFinding} disabled={addingFinding}>
                    {addingFinding ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                    발견사항 추가 (조치 요청)
                  </Button>
                </CardContent>
              </Card>
            )}

            <Button className="w-full h-14 text-base" onClick={completeInspection}>
              {patrol ? "일지 저장" : "점검 완료 저장"}
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
