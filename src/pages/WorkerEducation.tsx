import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { useSoftDelete } from "@/hooks/useSoftDelete";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GraduationCap, Plus, AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string; project_id: string; worker_id: string; company_id: string | null;
  education_type: string; course_name: string; hours: number;
  completed_at: string; next_due_at: string | null; instructor: string | null;
  notes: string | null; evidence_url: string | null; is_deleted: boolean;
};
type Worker = { id: string; name: string; company_id: string | null };

const TYPES = ['정기', '채용시', '작업변경시', '특별', '관리감독자', '기초안전보건'];

export default function WorkerEducation() {
  const { selectedProject: projectId, isMaster, isProjectAdmin, isSafetyManager, profile } = useGlobalProjectAccess() as any;
  const { softDelete } = useSoftDelete();
  const [rows, setRows] = useState<Row[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [form, setForm] = useState({
    worker_id: "", education_type: "정기", course_name: "", hours: 0,
    completed_at: new Date().toISOString().slice(0, 10), instructor: "", notes: "", evidence_url: "",
  });

  const canSeeAllCompanies = !!(isMaster || isProjectAdmin || isSafetyManager);
  const myCompanyId: string | null = profile?.company_id ?? null;

  async function load() {
    if (!projectId) return;
    setLoading(true);
    let rq = supabase.from("worker_education_records").select("*").eq("project_id", projectId).eq("is_deleted", false);
    let wq = supabase.from("workers").select("id, name, company_id").eq("project_id", projectId);
    if (!canSeeAllCompanies && myCompanyId) {
      rq = rq.eq("company_id", myCompanyId);
      wq = wq.eq("company_id", myCompanyId);
    }
    const [{ data: rs, error: e1 }, { data: ws }] = await Promise.all([
      rq.order("completed_at", { ascending: false }),
      wq,
    ]);
    if (e1) toast.error(e1.message);
    setRows((rs as Row[]) || []);
    setWorkers((ws as Worker[]) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [projectId, canSeeAllCompanies, myCompanyId]);

  const today = new Date().toISOString().slice(0, 10);
  const workerMap = useMemo(() => Object.fromEntries(workers.map(w => [w.id, w])), [workers]);

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    TYPES.forEach(t => { c[t] = rows.filter(r => r.education_type === t).length; });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (typeFilter !== "all" && r.education_type !== typeFilter) return false;
      if (!q) return true;
      const w = workerMap[r.worker_id];
      return (
        (w?.name || "").toLowerCase().includes(q) ||
        r.course_name.toLowerCase().includes(q) ||
        (r.instructor || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, typeFilter, workerMap]);

  const stats = useMemo(() => {
    const overdue = rows.filter(r => r.next_due_at && r.next_due_at < today).length;
    return { total: rows.length, overdue, ok: rows.length - overdue };
  }, [rows, today]);

  function openCreate() {
    setEditing(null);
    setForm({ worker_id: "", education_type: "정기", course_name: "", hours: 0, completed_at: today, instructor: "", notes: "", evidence_url: "" });
    setOpen(true);
  }
  function openEdit(r: Row) {
    setEditing(r);
    setForm({ worker_id: r.worker_id, education_type: r.education_type, course_name: r.course_name, hours: Number(r.hours), completed_at: r.completed_at, instructor: r.instructor || "", notes: r.notes || "", evidence_url: r.evidence_url || "" });
    setOpen(true);
  }
  async function save() {
    if (!projectId) return;
    if (!form.worker_id) { toast.error("근로자를 선택하세요"); return; }
    if (!form.course_name.trim()) { toast.error("과정명을 입력하세요"); return; }
    const w = workerMap[form.worker_id];
    const payload: any = {
      project_id: projectId, worker_id: form.worker_id, company_id: w?.company_id || null,
      education_type: form.education_type, course_name: form.course_name.trim(),
      hours: Number(form.hours) || 0, completed_at: form.completed_at,
      instructor: form.instructor || null, notes: form.notes || null,
      evidence_url: form.evidence_url || null,
    };
    const { error } = editing
      ? await supabase.from("worker_education_records").update(payload).eq("id", editing.id)
      : await supabase.from("worker_education_records").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "수정 완료" : "등록 완료");
    setOpen(false); load();
  }
  async function handleDelete(r: Row) {
    const res = await softDelete("worker_education_records", r.id, {
      projectId,
      label: `${workerMap[r.worker_id]?.name || "교육"} · ${r.course_name}`,
    });
    if (res.ok) load();
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><GraduationCap className="text-primary" /> 안전보건교육 이수관리</h1>
          <p className="text-sm text-muted-foreground">산안법 §29 — 정기/채용시/작업변경시/특별/관리감독자 교육</p>
        </div>
        <Button onClick={openCreate}><Plus className="size-4 mr-1" /> 이수 등록</Button>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">전체</div><div className="text-2xl font-bold">{stats.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="size-3 text-green-600" /> 유효</div><div className="text-2xl font-bold text-green-600">{stats.ok}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="size-3 text-destructive" /> 주기 경과</div><div className="text-2xl font-bold text-destructive">{stats.overdue}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">이수 이력</CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="근로자/과정/강사 검색" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <Tabs value={typeFilter} onValueChange={setTypeFilter}>
            <TabsList className="flex flex-wrap h-auto">
              <TabsTrigger value="all">전체 <Badge variant="secondary" className="ml-1">{typeCounts.all}</Badge></TabsTrigger>
              {TYPES.map(t => (
                <TabsTrigger key={t} value={t}>{t} <Badge variant="secondary" className="ml-1">{typeCounts[t] || 0}</Badge></TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <GraduationCap className="size-10 mx-auto text-muted-foreground" />
              <div className="text-sm text-muted-foreground">등록된 교육 이수 기록이 없습니다</div>
              <Button onClick={openCreate}><Plus className="size-4 mr-1" /> 첫 이수 기록 등록</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">검색 결과 없음</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr className="text-left">
                  <th className="p-2">근로자</th><th className="p-2">유형</th><th className="p-2">과정명</th>
                  <th className="p-2">시간</th><th className="p-2">이수일</th><th className="p-2">차기예정</th>
                  <th className="p-2"></th>
                </tr></thead>
                <tbody>
                  {filtered.map(r => {
                    const overdue = r.next_due_at && r.next_due_at < today;
                    return (
                      <tr key={r.id} className="border-t hover:bg-muted/30">
                        <td className="p-2">{workerMap[r.worker_id]?.name || "-"}</td>
                        <td className="p-2"><Badge variant="outline">{r.education_type}</Badge></td>
                        <td className="p-2 font-medium">{r.course_name}</td>
                        <td className="p-2 text-center">{r.hours}h</td>
                        <td className="p-2 whitespace-nowrap">{r.completed_at}</td>
                        <td className="p-2 whitespace-nowrap">
                          {r.next_due_at ? <Badge variant={overdue ? "destructive" : "secondary"}>{r.next_due_at}</Badge> : "-"}
                        </td>
                        <td className="p-2 space-x-1 whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>수정</Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(r)}>삭제</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "이수 수정" : "교육 이수 등록"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>근로자</Label>
                <Select value={form.worker_id} onValueChange={v => setForm({ ...form, worker_id: v })}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>{workers.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>교육 유형</Label>
                <Select value={form.education_type} onValueChange={v => setForm({ ...form, education_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>과정명</Label><Input value={form.course_name} onChange={e => setForm({ ...form, course_name: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>시간</Label><Input type="number" step="0.5" value={form.hours} onChange={e => setForm({ ...form, hours: Number(e.target.value) })} /></div>
              <div><Label>이수일</Label><Input type="date" value={form.completed_at} onChange={e => setForm({ ...form, completed_at: e.target.value })} /></div>
              <div><Label>강사</Label><Input value={form.instructor} onChange={e => setForm({ ...form, instructor: e.target.value })} /></div>
            </div>
            <div><Label>증빙 URL</Label><Input value={form.evidence_url} onChange={e => setForm({ ...form, evidence_url: e.target.value })} placeholder="https://..." /></div>
            <div><Label>비고</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <p className="text-xs text-muted-foreground">정기 3개월, 특별/관리감독자 12개월 주기로 차기 예정일이 자동 계산됩니다.</p>
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
