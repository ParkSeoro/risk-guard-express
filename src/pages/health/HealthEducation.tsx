import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToastError } from "@/hooks/useToastError";
import { toast } from "sonner";
import { Plus, GraduationCap } from "lucide-react";

const ACTIVE_PROJECT_KEY = "active_project_id";
const TYPES = ["정기", "특별", "관리감독자", "MSDS", "신규채용", "작업변경"];

export default function HealthEducation() {
  const handle = useToastError();
  const [list, setList] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ type: "정기" });
  const [loading, setLoading] = useState(true);
  const projectId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_PROJECT_KEY) : null;

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [{ data: l }, { data: ws }] = await Promise.all([
        supabase.from("health_education_logs").select("*").eq("project_id", projectId).eq("is_deleted", false).order("conducted_at", { ascending: false }).limit(300),
        supabase.from("workers").select("id,name,company_name,company_id").eq("project_id", projectId).eq("is_active", true).order("name"),
      ]);
      setList(l || []); setWorkers(ws || []);
    } catch (e) { handle(e, "보건교육 조회"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [projectId]);

  const submit = async () => {
    if (!projectId || !form.worker_id || !form.title) { toast.error("근로자·제목 필수"); return; }
    try {
      const w = workers.find(x => x.id === form.worker_id);
      const { error } = await supabase.from("health_education_logs").insert({
        project_id: projectId,
        worker_id: form.worker_id,
        worker_name: w?.name,
        company_id: w?.company_id,
        type: form.type,
        title: form.title,
        hours: form.hours ? Number(form.hours) : 0,
        conducted_at: form.conducted_at || new Date().toISOString(),
        instructor: form.instructor || null,
        notes: form.notes || null,
      });
      if (error) throw error;

      // 특별교육이면 근로자 만료일 갱신(1년)
      if (form.type === "특별" && form.worker_id) {
        const next = new Date(); next.setFullYear(next.getFullYear() + 1);
        await supabase.from("workers").update({ special_education_required_until: next.toISOString().slice(0, 10) }).eq("id", form.worker_id);
      }

      toast.success("등록되었습니다");
      setOpen(false); setForm({ type: "정기" }); await load();
    } catch (e) { handle(e, "보건교육 등록"); }
  };

  if (!projectId) return <div className="p-6 text-muted-foreground">프로젝트를 선택해주세요.</div>;

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><GraduationCap className="h-6 w-6" />보건교육 이력</h1>
          <p className="text-sm text-muted-foreground mt-1">정기·특별·관리감독자·MSDS 교육 (산안법 제29~32조)</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />교육 등록</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">교육 이력 ({list.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="text-sm text-muted-foreground">로딩 중…</div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>실시일</TableHead><TableHead>근로자</TableHead><TableHead>유형</TableHead>
                  <TableHead>제목</TableHead><TableHead>시간</TableHead><TableHead>강사</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {list.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{r.conducted_at ? new Date(r.conducted_at).toLocaleDateString() : "-"}</TableCell>
                      <TableCell>{r.worker_name}</TableCell>
                      <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                      <TableCell>{r.title}</TableCell>
                      <TableCell>{r.hours}h</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.instructor || "-"}</TableCell>
                    </TableRow>
                  ))}
                  {list.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">교육 이력이 없습니다.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>보건교육 등록</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>근로자 *</Label>
              <Select value={form.worker_id || ""} onValueChange={v => setForm({ ...form, worker_id: v })}>
                <SelectTrigger><SelectValue placeholder="근로자 선택" /></SelectTrigger>
                <SelectContent>{workers.map(w => <SelectItem key={w.id} value={w.id}>{w.name} ({w.company_name})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>유형</Label>
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>시간(h)</Label><Input type="number" step="0.5" value={form.hours || ""} onChange={e => setForm({ ...form, hours: e.target.value })} /></div>
            <div className="col-span-2"><Label>제목 *</Label><Input value={form.title || ""} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>실시일시</Label><Input type="datetime-local" value={form.conducted_at || ""} onChange={e => setForm({ ...form, conducted_at: e.target.value })} /></div>
            <div><Label>강사</Label><Input value={form.instructor || ""} onChange={e => setForm({ ...form, instructor: e.target.value })} /></div>
            <div className="col-span-2"><Label>비고</Label><Input value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>취소</Button><Button onClick={submit}>등록</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
