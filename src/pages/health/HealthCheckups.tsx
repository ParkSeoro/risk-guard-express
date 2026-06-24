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
import { Plus, Stethoscope } from "lucide-react";
import { useProjectAccess } from "@/hooks/useProjectAccess";

const ACTIVE_PROJECT_KEY = "selectedProjectId";
const TYPES = ["일반", "특수", "배치전", "수시", "임시"];
const RESULTS = ["정상A", "정상B", "요관찰C", "유소견D1", "유소견D2", "판정불가", "미수검"];

export default function HealthCheckups() {
  const handle = useToastError();
  const { applyCompanyFilter, userCompanyId } = useProjectAccess();
  const [list, setList] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);
  const [form, setForm] = useState<any>({ type: "일반", result: "미수검" });
  const projectId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_PROJECT_KEY) : null;

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      let hcQ = supabase.from("health_checkups").select("*").eq("project_id", projectId).eq("is_deleted", false).order("scheduled_date", { ascending: false }).limit(200);
      hcQ = applyCompanyFilter(hcQ);
      let wsQ = supabase.from("workers").select("id,name,company_name,phone,company_id").eq("project_id", projectId).eq("is_active", true).order("name");
      wsQ = applyCompanyFilter(wsQ);
      const [{ data: hc }, { data: ws }] = await Promise.all([hcQ, wsQ]);
      setList(hc || []);
      setWorkers(ws || []);
    } catch (e) { handle(e, "건강진단 목록"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [projectId, userCompanyId]);

  const submit = async () => {
    if (!projectId || !form.worker_id || !form.type) {
      toast.error("근로자, 종류는 필수입니다");
      return;
    }
    try {
      const worker = workers.find(w => w.id === form.worker_id);
      const { error } = await supabase.from("health_checkups").insert({
        project_id: projectId,
        worker_id: form.worker_id,
        company_id: worker?.company_id,
        worker_name: worker?.name,
        worker_phone: worker?.phone,
        type: form.type,
        scheduled_date: form.scheduled_date || null,
        conducted_date: form.conducted_date || null,
        institution: form.institution || null,
        result: form.result || "미수검",
        restrictions: form.restrictions || null,
        next_due_date: form.next_due_date || null,
        notes: form.notes || null,
      });
      if (error) throw error;
      toast.success("등록되었습니다");
      setOpenNew(false);
      setForm({ type: "일반", result: "미수검" });
      await load();
    } catch (e) { handle(e, "건강진단 등록"); }
  };

  if (!projectId) return <div className="p-6 text-muted-foreground">프로젝트를 선택해주세요.</div>;

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Stethoscope className="h-6 w-6" />건강진단 관리</h1>
          <p className="text-sm text-muted-foreground mt-1">일반/특수/배치전/수시/임시 건강진단 기록 (산업안전보건법 제129~131조)</p>
        </div>
        <Button onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" />신규 등록</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">최근 진단 기록 ({list.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="text-sm text-muted-foreground">로딩 중…</div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>근로자</TableHead><TableHead>회사</TableHead><TableHead>종류</TableHead>
                    <TableHead>실시일</TableHead><TableHead>결과</TableHead><TableHead>차회 기한</TableHead><TableHead>비고</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{r.worker_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{(workers.find(w => w.id === r.worker_id)?.company_name) || "-"}</TableCell>
                      <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                      <TableCell>{r.conducted_date || r.scheduled_date || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={r.result?.startsWith("유소견") ? "destructive" : r.result === "미수검" ? "secondary" : "default"}>{r.result}</Badge>
                      </TableCell>
                      <TableCell>{r.next_due_date || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{r.restrictions || r.notes || ""}</TableCell>
                    </TableRow>
                  ))}
                  {list.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">등록된 건강진단 기록이 없습니다.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>건강진단 등록</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>근로자 *</Label>
              <Select value={form.worker_id || ""} onValueChange={v => setForm({ ...form, worker_id: v })}>
                <SelectTrigger><SelectValue placeholder="근로자 선택" /></SelectTrigger>
                <SelectContent>{workers.map(w => <SelectItem key={w.id} value={w.id}>{w.name} ({w.company_name})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>종류 *</Label>
                <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>결과</Label>
                <Select value={form.result} onValueChange={v => setForm({ ...form, result: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RESULTS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>실시일</Label><Input type="date" value={form.conducted_date || ""} onChange={e => setForm({ ...form, conducted_date: e.target.value })} /></div>
              <div><Label>차회 기한</Label><Input type="date" value={form.next_due_date || ""} onChange={e => setForm({ ...form, next_due_date: e.target.value })} /></div>
              <div className="col-span-2"><Label>검진기관</Label><Input value={form.institution || ""} onChange={e => setForm({ ...form, institution: e.target.value })} /></div>
              <div className="col-span-2"><Label>작업 제한 사항</Label><Input value={form.restrictions || ""} onChange={e => setForm({ ...form, restrictions: e.target.value })} /></div>
              <div className="col-span-2"><Label>비고</Label><Input value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenNew(false)}>취소</Button><Button onClick={submit}>등록</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
