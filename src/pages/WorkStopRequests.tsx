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
import { OctagonAlert, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string; project_id: string; reporter_name: string; location: string | null;
  hazard_description: string; photo_url: string | null; status: string;
  resumed_at: string | null; resolution_note: string | null; created_at: string;
};

const STATUS_VARIANT: Record<string, any> = {
  '접수': 'destructive', '확인중': 'default', '조치완료': 'outline', '반려': 'secondary',
};

export default function WorkStopRequests() {
  const { selectedProject: projectId } = useProjectAccess();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ status: '확인중', resolution_note: '' });

  async function load() {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase.from("work_stop_requests").select("*")
      .eq("project_id", projectId).order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as Row[]) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [projectId]);

  function openHandle(r: Row) {
    setEditing(r);
    setForm({ status: r.status === '접수' ? '확인중' : r.status, resolution_note: r.resolution_note || "" });
    setOpen(true);
  }
  async function handle() {
    if (!editing) return;
    const payload: any = { status: form.status, resolution_note: form.resolution_note || null };
    if (form.status === '조치완료') payload.resumed_at = new Date().toISOString();
    const { error } = await supabase.from("work_stop_requests").update(payload).eq("id", editing.id);
    if (error) { toast.error(error.message); return; }
    toast.success("처리 완료");
    setOpen(false); load();
  }

  const pending = rows.filter(r => r.status === '접수' || r.status === '확인중').length;
  const done = rows.filter(r => r.status === '조치완료').length;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2"><OctagonAlert className="text-destructive" /> 작업중지권 관리</h1>
        <p className="text-sm text-muted-foreground">산안법 §54 — 근로자는 산업재해 발생 급박한 위험을 인지하면 즉시 작업중지권을 행사할 수 있으며, 사업주는 그를 이유로 불이익을 줄 수 없습니다.</p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="size-3 text-destructive"/> 미해결</div><div className="text-2xl font-bold text-destructive">{pending}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="size-3 text-green-600"/> 조치완료</div><div className="text-2xl font-bold text-green-600">{done}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">전체</div><div className="text-2xl font-bold">{rows.length}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">접수 이력</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="text-sm text-muted-foreground">로딩...</div> :
            rows.length === 0 ? <div className="text-sm text-muted-foreground py-8 text-center">접수된 작업중지 요청 없음</div> :
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr className="text-left">
                  <th className="p-2">접수일시</th><th className="p-2">보고자</th>
                  <th className="p-2">위치</th><th className="p-2">위험상황</th>
                  <th className="p-2">상태</th><th className="p-2">재개일시</th><th className="p-2"></th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="p-2 whitespace-nowrap text-xs">{new Date(r.created_at).toLocaleString('ko-KR')}</td>
                      <td className="p-2">{r.reporter_name}</td>
                      <td className="p-2">{r.location || '-'}</td>
                      <td className="p-2 max-w-md truncate">{r.hazard_description}</td>
                      <td className="p-2"><Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge></td>
                      <td className="p-2 whitespace-nowrap text-xs">{r.resumed_at ? new Date(r.resumed_at).toLocaleString('ko-KR') : <Clock className="size-3 inline text-muted-foreground"/>}</td>
                      <td className="p-2"><Button size="sm" variant="ghost" onClick={() => openHandle(r)}>처리</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>작업중지 처리</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="p-3 rounded bg-muted/50 text-sm">
                <div className="font-medium">{editing.reporter_name} · {editing.location || '위치 미상'}</div>
                <div className="text-muted-foreground mt-1">{editing.hazard_description}</div>
              </div>
              <div>
                <Label>처리 상태</Label>
                <select className="w-full border rounded px-3 py-2 text-sm" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                  <option value="확인중">확인중</option>
                  <option value="조치완료">조치완료 (작업재개)</option>
                  <option value="반려">반려</option>
                </select>
              </div>
              <div><Label>처리 내용</Label><Textarea rows={3} value={form.resolution_note} onChange={e => setForm({ ...form, resolution_note: e.target.value })} /></div>
              <p className="text-xs text-destructive">⚠️ 작업중지권 행사 근로자에 대한 어떠한 불이익 처우도 금지됩니다 (산안법 §54-2).</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={handle}>처리</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
