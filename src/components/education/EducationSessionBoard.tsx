import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { EDUCATION_OUTLINES, EDUCATION_SESSION_TYPES, type EducationSessionType } from "@/lib/educationOutlines";
import { printEducationLog } from "@/lib/educationPrint";
import { uploadAttachmentFile } from "@/lib/compressUploadFile";
import { REQ_TYPE_LABELS } from "@/hooks/useWorker";
import { toast } from "sonner";

type WorkerOpt = { id: string; name: string; company_id: string | null; company_name: string | null; job_type: string | null };
type SessionRow = {
  id: string;
  education_type: string;
  course_name: string;
  hours: number;
  held_on: string;
  instructor: string | null;
  place: string | null;
  outline: string;
  status: string;
  photo_urls: string[] | null;
};
type AttendeeRow = {
  id: string;
  worker_id: string;
  signature_data: string | null;
  signed_at: string | null;
};

const db = supabase as any;

function todayInput(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function EducationSessionBoard({ focusCertificate }: { focusCertificate?: boolean }) {
  const { selectedProject: projectId, userCompanyId, seesAllCompanies, applyCompanyFilter, scopeStatus } = useGlobalProjectAccess();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [workers, setWorkers] = useState<WorkerOpt[]>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SessionRow | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [type, setType] = useState<EducationSessionType>("regular");
  const [courseName, setCourseName] = useState(EDUCATION_OUTLINES.regular.title);
  const [hours, setHours] = useState(String(EDUCATION_OUTLINES.regular.defaultHours));
  const [heldOn, setHeldOn] = useState(todayInput);
  const [instructor, setInstructor] = useState("");
  const [place, setPlace] = useState("");
  const [outline, setOutline] = useState(EDUCATION_OUTLINES.regular.outline);
  const [picked, setPicked] = useState<string[]>([]);
  const [onlyShort, setOnlyShort] = useState(true);
  const [shortIds, setShortIds] = useState<string[] | null>(null);
  const [workerQuery, setWorkerQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [certOpen, setCertOpen] = useState(false);

  const load = async () => {
    if (!projectId || scopeStatus !== "ready") return;
    let sq = db.from("education_sessions").select("*").eq("project_id", projectId).order("held_on", { ascending: false });
    let wq = supabase.from("workers").select("id, name, company_id, company_name, job_type").eq("project_id", projectId).eq("is_active", true);
    sq = applyCompanyFilter(sq);
    wq = applyCompanyFilter(wq);
    const [{ data: ss }, { data: ws }] = await Promise.all([sq, wq.order("name")]);
    setSessions((ss || []) as SessionRow[]);
    setWorkers((ws || []) as WorkerOpt[]);
  };

  useEffect(() => { load(); }, [projectId, scopeStatus, seesAllCompanies]);

  useEffect(() => {
    if (!projectId || !open) return;
    db.rpc("list_education_shortfall", { _project_id: projectId, _education_type: type }).then(({ data }: { data: { worker_id: string }[] | null }) => {
      setShortIds((data || []).map((r) => r.worker_id));
    });
  }, [projectId, type, open]);

  const applyType = (next: EducationSessionType) => {
    const spec = EDUCATION_OUTLINES[next];
    setType(next);
    setCourseName(spec.title);
    setHours(String(spec.defaultHours));
    setOutline(spec.outline);
  };

  const visibleWorkers = useMemo(() => {
    const q = workerQuery.trim();
    return workers.filter((w) => {
      if (onlyShort && shortIds && !shortIds.includes(w.id)) return false;
      if (!q) return true;
      return `${w.name} ${w.company_name || ""}`.includes(q);
    });
  }, [workers, onlyShort, shortIds, workerQuery]);

  const createSession = async () => {
    if (!projectId || !courseName.trim() || picked.length === 0) {
      toast.error("교육명과 참석 근로자를 지정하세요");
      return;
    }
    setSaving(true);
    const { data: created, error } = await db.from("education_sessions").insert({
      project_id: projectId,
      company_id: seesAllCompanies ? null : userCompanyId,
      education_type: type,
      course_name: courseName.trim(),
      hours: Number(hours) || EDUCATION_OUTLINES[type].defaultHours,
      held_on: heldOn,
      instructor: instructor.trim() || null,
      place: place.trim() || null,
      outline: outline.trim(),
      created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    }).select("id").single();
    if (error || !created) {
      setSaving(false);
      toast.error(error?.message || "회차를 만들지 못했습니다");
      return;
    }
    const { error: aErr } = await db.from("education_session_attendees").insert(
      picked.map((workerId) => ({ session_id: created.id, project_id: projectId, worker_id: workerId })),
    );
    setSaving(false);
    if (aErr) {
      toast.error(aErr.message);
      return;
    }
    toast.success("교육 회차를 열었습니다. 근로자가 휴대폰에서 서명합니다.");
    setOpen(false);
    setPicked([]);
    load();
  };

  const openDetail = async (row: SessionRow) => {
    setDetail(row);
    const { data } = await db.from("education_session_attendees").select("id, worker_id, signature_data, signed_at").eq("session_id", row.id);
    setAttendees((data || []) as AttendeeRow[]);
  };

  const signedCount = attendees.filter((a) => (a.signature_data || "").length >= 80).length;

  const addPhotos = async (files: FileList | null) => {
    if (!detail || !files?.length || !projectId) return;
    const urls = [...(detail.photo_urls || [])];
    for (const file of Array.from(files)) {
      const up = await uploadAttachmentFile(`education-sessions/${projectId}/${detail.id}/${Date.now()}-${file.name}`, file);
      urls.push(up.publicUrl);
    }
    const { error } = await db.from("education_sessions").update({ photo_urls: urls }).eq("id", detail.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    const next = { ...detail, photo_urls: urls };
    setDetail(next);
    setSessions((rows) => rows.map((r) => (r.id === detail.id ? next : r)));
  };

  const closeSession = async () => {
    if (!detail) return;
    if (signedCount === 0) {
      toast.error("서명한 근로자가 없습니다");
      return;
    }
    const { error } = await db.from("education_sessions").update({ status: "closed" }).eq("id", detail.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("서명한 사람의 이수 시간을 장부에 남겼습니다");
    setDetail({ ...detail, status: "closed" });
    load();
  };

  const printCurrent = () => {
    if (!detail) return;
    const byId = Object.fromEntries(workers.map((w) => [w.id, w]));
    printEducationLog({
      courseName: detail.course_name,
      educationLabel: REQ_TYPE_LABELS[detail.education_type] || detail.education_type,
      heldOn: detail.held_on,
      hours: Number(detail.hours),
      instructor: detail.instructor,
      place: detail.place,
      outline: detail.outline,
      photoUrls: detail.photo_urls || [],
      attendees: attendees.map((a) => ({
        name: byId[a.worker_id]?.name || a.worker_id,
        company: byId[a.worker_id]?.company_name || "",
        signature: (a.signature_data || "").length >= 80 ? a.signature_data : null,
      })),
    });
  };

  const workerName = (id: string) => workers.find((w) => w.id === id)?.name || id;

  return (
    <div className="space-y-4">
      <Card id="basic-safety-certificate" className={focusCertificate ? "ring-2 ring-primary" : ""}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">이수증으로 확인하는 교육</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>건설 일용근로자의 기초안전보건교육은 지정 교육기관 이수증으로 확인합니다. 현장 수업 회차로 열지 않습니다. 이수증이 있으면 그 사람의 채용 시 교육 의무는 끝납니다.</p>
          <p>안전관리자 직무교육도 교육기관 이수증입니다. 그 등록 화면은 다음에 둡니다.</p>
          <Button size="sm" variant="outline" onClick={() => setCertOpen(true)}>기초안전 이수증 등록</Button>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">교육 회차</h2>
          <p className="text-sm text-muted-foreground">한 번에 여러 사람을 지정합니다. 서명은 근로자 휴대폰에서, 사진은 여기서 올립니다.</p>
        </div>
        <Button onClick={() => setOpen(true)}>회차 만들기</Button>
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">열린 교육 회차가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <button key={s.id} type="button" onClick={() => openDetail(s)} className="w-full text-left border rounded-md p-3 hover:bg-muted/40">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{s.course_name}</div>
                <Badge variant={s.status === "open" ? "default" : "secondary"}>{s.status === "open" ? "진행" : "마감"}</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {REQ_TYPE_LABELS[s.education_type] || s.education_type} · {s.held_on} · {s.hours}시간 · {s.instructor || "강사 미기재"}
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>교육 회차</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>종류</Label>
              <Select value={type} onValueChange={(v) => applyType(v as EducationSessionType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EDUCATION_SESSION_TYPES.map((key) => (
                    <SelectItem key={key} value={key}>{REQ_TYPE_LABELS[key] || EDUCATION_OUTLINES[key].title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">{EDUCATION_OUTLINES[type].hoursHint}</p>
            </div>
            <div><Label>교육명</Label><Input value={courseName} onChange={(e) => setCourseName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>시간</Label><Input type="number" min={0.5} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} /></div>
              <div><Label>날짜</Label><Input type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>강사</Label><Input value={instructor} onChange={(e) => setInstructor(e.target.value)} /></div>
              <div><Label>장소</Label><Input value={place} onChange={(e) => setPlace(e.target.value)} /></div>
            </div>
            <div><Label>교육 내용</Label><Textarea rows={6} value={outline} onChange={(e) => setOutline(e.target.value)} /></div>
            <div className="flex items-center gap-2">
              <Checkbox id="only-short" checked={onlyShort} onCheckedChange={(v) => setOnlyShort(v === true)} />
              <Label htmlFor="only-short">필요 시간이 남은 사람만</Label>
            </div>
            <Input placeholder="이름·회사 검색" value={workerQuery} onChange={(e) => setWorkerQuery(e.target.value)} />
            <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-1">
              {visibleWorkers.map((w) => (
                <label key={w.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={picked.includes(w.id)}
                    onCheckedChange={(v) => setPicked((cur) => v === true ? [...cur, w.id] : cur.filter((id) => id !== w.id))}
                  />
                  <span>{w.name}</span>
                  <span className="text-xs text-muted-foreground">{w.company_name}</span>
                </label>
              ))}
              {visibleWorkers.length === 0 && <p className="text-xs text-muted-foreground">해당하는 근로자가 없습니다. 필터를 끄면 전체를 고를 수 있습니다.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={createSession} disabled={saving}>{saving ? "저장 중…" : `선택한 ${picked.length}명으로 열기`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader><DialogTitle>{detail.course_name}</DialogTitle></DialogHeader>
              <div className="space-y-3 text-sm">
                <p className="whitespace-pre-wrap text-muted-foreground">{detail.outline}</p>
                <p>서명 {signedCount} / {attendees.length}</p>
                <ul className="space-y-1">
                  {attendees.map((a) => (
                    <li key={a.id} className="flex justify-between gap-2 border-b py-1">
                      <span>{workerName(a.worker_id)}</span>
                      <span className="text-muted-foreground">{(a.signature_data || "").length >= 80 ? "서명" : "대기"}</span>
                    </li>
                  ))}
                </ul>
                <div>
                  <Label>교육 사진</Label>
                  <Input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} />
                  <div className="flex flex-wrap gap-2 mt-2">
                    {(detail.photo_urls || []).map((url) => (
                      <img key={url} src={url} alt="" className="h-16 w-16 object-cover rounded" />
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground break-all">
                  근로자 서명 주소: {`${window.location.origin}/app/worker/education-sign?session=${detail.id}`}
                </p>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={printCurrent}>교육일지</Button>
                {detail.status === "open" && <Button onClick={closeSession}>마감</Button>}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <CertificateDialog
        open={certOpen}
        onOpenChange={setCertOpen}
        workers={workers}
        projectId={projectId}
        onSaved={load}
      />
    </div>
  );
}

function CertificateDialog({
  open, onOpenChange, workers, projectId, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workers: WorkerOpt[];
  projectId: string | null;
  onSaved: () => void;
}) {
  const [workerId, setWorkerId] = useState("");
  const [completedAt, setCompletedAt] = useState(todayInput);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!projectId || !workerId || !file) {
      toast.error("근로자와 이수증 사진을 지정하세요");
      return;
    }
    setSaving(true);
    try {
      const up = await uploadAttachmentFile(`education-certificates/${projectId}/${workerId}/${Date.now()}-${file.name}`, file);
      const worker = workers.find((w) => w.id === workerId);
      const { error } = await supabase.from("worker_education_records").insert({
        project_id: projectId,
        worker_id: workerId,
        company_id: worker?.company_id || null,
        education_type: "new_hire_construction",
        course_name: "건설업 기초안전보건교육",
        hours: 4,
        completed_at: completedAt,
        evidence_url: up.publicUrl,
        notes: "certificate",
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("이수증을 확인했습니다");
      onOpenChange(false);
      setFile(null);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "업로드에 실패했습니다");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>기초안전 이수증</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>근로자</Label>
            <Select value={workerId} onValueChange={setWorkerId}>
              <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
              <SelectContent>
                {workers.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>이수일</Label><Input type="date" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} /></div>
          <div><Label>이수증 사진</Label><Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={save} disabled={saving}>{saving ? "저장 중…" : "확인"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
