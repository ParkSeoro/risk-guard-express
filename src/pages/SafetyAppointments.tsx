import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectAccess } from "@/hooks/useProjectAccess";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserCheck, Plus } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string; project_id: string; full_name: string; role_type: string;
  company_id: string | null; appointed_at: string; ended_at: string | null;
  reason: string | null; reported_to_authority_at: string | null;
  authority_doc_no: string | null; evidence_url: string | null; is_deleted: boolean;
};
const ROLES = ['안전보건관리책임자','관리감독자','안전관리자','보건관리자','산업보건의','명예산업안전감독관'];

export default function SafetyAppointments() {
  const { selectedProject: projectId } = useProjectAccess();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({
    full_name: "", role_type: "안전관리자", appointed_at: new Date().toISOString().slice(0,10),
    ended_at: "", reason: "", reported_to_authority_at: "", authority_doc_no: "", evidence_url: "",
  });

  async function load() {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase.from("safety_appointments").select("*")
      .eq("project_id", projectId).eq("is_deleted", false).order("appointed_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as Row[]) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [projectId]);

  function openCreate() {
    setEditing(null);
    setForm({ full_name: "", role_type: "안전관리자", appointed_at: new Date().toISOString().slice(0,10), ended_at: "", reason: "", reported_to_authority_at: "", authority_doc_no: "", evidence_url: "" });
    setOpen(true);
  }
  function openEdit(r: Row) {
    setEditing(r);
    setForm({
      full_name: r.full_name, role_type: r.role_type, appointed_at: r.appointed_at,
      ended_at: r.ended_at || "", reason: r.reason || "",
      reported_to_authority_at: r.reported_to_authority_at ? r.reported_to_authority_at.slice(0,10) : "",
      authority_doc_no: r.authority_doc_no || "", evidence_url: r.evidence_url || "",
    });
    setOpen(true);
  }
  async function save() {
    if (!projectId) return;
    if (!form.full_name.trim()) { toast.error("성명을 입력하세요"); return; }
    const payload: any = {
      project_id: projectId, full_name: form.full_name.trim(), role_type: form.role_type,
      appointed_at: form.appointed_at, ended_at: form.ended_at || null,
      reason: form.reason || null,
      reported_to_authority_at: form.reported_to_authority_at || null,
      authority_doc_no: form.authority_doc_no || null,
      evidence_url: form.evidence_url || null,
    };
    const { error } = editing
      ? await supabase.from("safety_appointments").update(payload).eq("id", editing.id)
      : await supabase.from("safety_appointments").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "수정" : "등록");
    setOpen(false); load();
  }

  const active = rows.filter(r => !r.ended_at || r.ended_at > new Date().toISOString().slice(0,10));
  const hasManager = active.some(r => r.role_type === '안전관리자');

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><UserCheck className="text-primary" /> 안전관리자 선임이력</h1>
          <p className="text-sm text-muted-foreground">산안법 §15~17 — 안전보건관리책임자/관리감독자/안전·보건관리자 선임 및 노동청 신고 이력</p>
        </div>
        <Button onClick={openCreate}><Plus className="size-4 mr-1" /> 선임 등록</Button>
      </header>

      {!hasManager && (
        <Card className="border-destructive">
          <CardContent className="p-3 text-sm text-destructive">⚠️ 현재 활성 안전관리자가 등록되어 있지 않습니다. 산안법 §17에 따라 선임 의무가 있을 수 있습니다.</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">선임 이력 ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="text-sm text-muted-foreground">로딩...</div> :
            rows.length === 0 ? <div className="text-sm text-muted-foreground py-8 text-center">등록된 선임 기록 없음</div> :
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr className="text-left">
                  <th className="p-2">성명</th><th className="p-2">직위</th>
                  <th className="p-2">선임일</th><th className="p-2">해임일</th>
                  <th className="p-2">노동청 신고일</th><th className="p-2">신고번호</th>
                  <th className="p-2">상태</th><th className="p-2"></th>
                </tr></thead>
                <tbody>
                  {rows.map(r => {
                    const isActive = !r.ended_at || r.ended_at > new Date().toISOString().slice(0,10);
                    return (
                      <tr key={r.id} className="border-t hover:bg-muted/30">
                        <td className="p-2 font-medium">{r.full_name}</td>
                        <td className="p-2"><Badge variant="outline">{r.role_type}</Badge></td>
                        <td className="p-2 whitespace-nowrap">{r.appointed_at}</td>
                        <td className="p-2 whitespace-nowrap">{r.ended_at || "-"}</td>
                        <td className="p-2 whitespace-nowrap">{r.reported_to_authority_at ? r.reported_to_authority_at.slice(0,10) : <span className="text-destructive text-xs">미신고</span>}</td>
                        <td className="p-2">{r.authority_doc_no || "-"}</td>
                        <td className="p-2"><Badge variant={isActive ? "default" : "secondary"}>{isActive ? "활성" : "종료"}</Badge></td>
                        <td className="p-2"><Button size="sm" variant="ghost" onClick={() => openEdit(r)}>수정</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          }
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "선임 이력 수정" : "선임 등록"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>성명</Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><Label>직위</Label>
                <Select value={form.role_type} onValueChange={v => setForm({ ...form, role_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>선임일</Label><Input type="date" value={form.appointed_at} onChange={e => setForm({ ...form, appointed_at: e.target.value })} /></div>
              <div><Label>해임일 (있을 시)</Label><Input type="date" value={form.ended_at} onChange={e => setForm({ ...form, ended_at: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>노동청 신고일</Label><Input type="date" value={form.reported_to_authority_at} onChange={e => setForm({ ...form, reported_to_authority_at: e.target.value })} /></div>
              <div><Label>신고 문서번호</Label><Input value={form.authority_doc_no} onChange={e => setForm({ ...form, authority_doc_no: e.target.value })} /></div>
            </div>
            <div><Label>증빙 URL</Label><Input value={form.evidence_url} onChange={e => setForm({ ...form, evidence_url: e.target.value })} /></div>
            <div><Label>비고/사유</Label><Textarea rows={2} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={save}>{editing ? "수정" : "등록"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
