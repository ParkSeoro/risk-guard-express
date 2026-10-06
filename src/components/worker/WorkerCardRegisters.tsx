import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uploadAttachmentFile } from "@/lib/compressUploadFile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { REQ_TYPE_LABELS } from "@/hooks/useWorker";
import { toast } from "sonner";

const EDUCATION_TYPES = [
  "new_hire",
  "new_hire_construction",
  "regular",
  "special",
  "job_change",
  "manager",
  "msds",
] as const;

function todayInput(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function WorkerEducationRegisterButton({
  workerId,
  projectId,
  companyId,
  onSaved,
}: {
  workerId: string;
  projectId: string;
  companyId?: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [educationType, setEducationType] = useState<string>("regular");
  const [courseName, setCourseName] = useState("");
  const [hours, setHours] = useState("1");
  const [completedAt, setCompletedAt] = useState(todayInput);
  const [instructor, setInstructor] = useState("");

  const save = async () => {
    if (!courseName.trim()) {
      toast.error("과정명을 입력하세요");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("worker_education_records").insert({
      project_id: projectId,
      worker_id: workerId,
      company_id: companyId || null,
      education_type: educationType,
      course_name: courseName.trim(),
      hours: Number(hours) || 0,
      completed_at: completedAt,
      instructor: instructor.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("교육 이수를 등록했습니다");
    setOpen(false);
    setCourseName("");
    onSaved();
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>예외 수정</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이수 예외 수정</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>교육 종류</Label>
              <Select value={educationType} onValueChange={setEducationType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EDUCATION_TYPES.map((key) => (
                    <SelectItem key={key} value={key}>{REQ_TYPE_LABELS[key] || key}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>과정명</Label>
              <Input value={courseName} onChange={(e) => setCourseName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>시간</Label>
                <Input type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} />
              </div>
              <div>
                <Label>이수일</Label>
                <Input type="date" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>강사</Label>
              <Input value={instructor} onChange={(e) => setInstructor(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkerPrePlacementRegisterButton({
  workerId,
  projectId,
  companyId,
  workerName,
  workerPhone,
  onSaved,
}: {
  workerId: string;
  projectId: string;
  companyId?: string | null;
  workerName?: string | null;
  workerPhone?: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conductedDate, setConductedDate] = useState(todayInput);
  const [institution, setInstitution] = useState("");
  const [result, setResult] = useState<"정상A" | "유소견D1" | "미수검">("정상A");
  const [notes, setNotes] = useState("");

  const save = async () => {
    if (!conductedDate) {
      toast.error("시행일을 입력하세요");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("health_checkups").insert({
      project_id: projectId,
      worker_id: workerId,
      company_id: companyId || null,
      worker_name: workerName || null,
      worker_phone: workerPhone || null,
      type: "배치전",
      conducted_date: conductedDate,
      institution: institution.trim() || null,
      result,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("배치전검사를 등록했습니다");
    setOpen(false);
    onSaved();
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>배치전검사 등록</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>배치전 건강진단 등록</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>시행일</Label>
              <Input type="date" value={conductedDate} onChange={(e) => setConductedDate(e.target.value)} />
            </div>
            <div>
              <Label>기관</Label>
              <Input value={institution} onChange={(e) => setInstitution(e.target.value)} />
            </div>
            <div>
              <Label>판정</Label>
              <Select value={result} onValueChange={(v) => setResult(v as "정상A" | "유소견D1" | "미수검")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="정상A">정상</SelectItem>
                  <SelectItem value="유소견D1">유소견</SelectItem>
                  <SelectItem value="미수검">미수검</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>메모</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkerBasicSafetyCertificateButton({
  workerId,
  projectId,
  companyId,
  onSaved,
}: {
  workerId: string;
  projectId: string;
  companyId?: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completedAt, setCompletedAt] = useState(todayInput);
  const [file, setFile] = useState<File | null>(null);

  const save = async () => {
    if (!file) {
      toast.error("이수증 사진을 지정하세요");
      return;
    }
    setSaving(true);
    try {
      const up = await uploadAttachmentFile(
        `education-certificates/${projectId}/${workerId}/${Date.now()}-${file.name}`,
        file,
      );
      const { error } = await supabase.from("worker_education_records").insert({
        project_id: projectId,
        worker_id: workerId,
        company_id: companyId || null,
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
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "업로드에 실패했습니다");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>기초안전 이수증</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>기초안전보건 이수증</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">지정 교육기관 이수증입니다. 현장 수업으로 등록하지 않습니다.</p>
            <div>
              <Label>이수일</Label>
              <Input type="date" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} />
            </div>
            <div>
              <Label>이수증 사진</Label>
              <Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={save} disabled={saving}>{saving ? "저장 중…" : "확인"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
