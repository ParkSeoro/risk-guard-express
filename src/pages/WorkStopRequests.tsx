import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { OctagonAlert, AlertTriangle, CheckCircle2, Clock, Search, Smartphone, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { WorkStopPhotos } from "@/components/work-stop/WorkStopPhotos";
import { parseWorkStopPhotoUrls, WORK_STOP_LEGAL_CITE, workStopDisplayName } from "@/lib/workStop";

type Row = {
  id: string; project_id: string; reporter_name: string; is_anonymous?: boolean;
  location: string | null;
  hazard_description: string; photo_url: string | null; status: string;
  resumed_at: string | null; resolution_note: string | null; created_at: string;
};

const STATUS_VARIANT: Record<string, any> = {
  '접수': 'destructive', '확인중': 'default', '조치완료': 'outline', '반려': 'secondary',
};

type Tab = 'pending' | 'done' | 'rejected' | 'all';

export default function WorkStopRequests() {
  const { selectedProject: projectId, isMaster, isProjectAdmin, isSafetyManager, isSiteManager } = useGlobalProjectAccess();
  const canHandle = isMaster || isProjectAdmin || isSafetyManager || isSiteManager;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [tab, setTab] = useState<Tab>('pending');
  const [q, setQ] = useState('');
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

  const counts = useMemo(() => ({
    pending: rows.filter(r => r.status === '접수' || r.status === '확인중').length,
    done: rows.filter(r => r.status === '조치완료').length,
    rejected: rows.filter(r => r.status === '반려').length,
    all: rows.length,
  }), [rows]);

  const filtered = useMemo(() => {
    const base = rows.filter(r => {
      if (tab === 'pending') return r.status === '접수' || r.status === '확인중';
      if (tab === 'done') return r.status === '조치완료';
      if (tab === 'rejected') return r.status === '반려';
      return true;
    });
    if (!q.trim()) return base;
    const key = q.trim().toLowerCase();
    return base.filter(r =>
      workStopDisplayName(r).toLowerCase().includes(key) ||
      (r.location || '').toLowerCase().includes(key) ||
      r.hazard_description?.toLowerCase().includes(key)
    );
  }, [rows, tab, q]);

  function openHandle(r: Row) {
    if (!canHandle) { toast.error('처리 권한이 없습니다.'); return; }
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
    try {
      await supabase.from('audit_logs').insert({
        project_id: editing.project_id, entity_type: 'work_stop_requests', entity_id: editing.id,
        action: 'update', changes: { status: form.status, resolution_note: form.resolution_note } as any,
      });
    } catch {}
    toast.success("처리 완료");
    setOpen(false); load();
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><OctagonAlert className="text-destructive" /> 작업중지권 관리</h1>
          <p className="text-sm text-muted-foreground">{WORK_STOP_LEGAL_CITE} — 근로자는 산업재해 발생 급박한 위험을 인지하면 즉시 작업중지권을 행사할 수 있으며, 사업주는 그를 이유로 불이익을 줄 수 없습니다. 익명 신고는 이름이 표시되지 않습니다.</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href="/app/worker/work-stop" target="_blank" rel="noreferrer"><Smartphone className="size-4 mr-1"/> 모바일 신고 페이지</a>
        </Button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="size-3 text-destructive"/> 미해결</div><div className="text-2xl font-bold text-destructive">{counts.pending}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="size-3 text-green-600"/> 조치완료</div><div className="text-2xl font-bold text-green-600">{counts.done}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><ShieldAlert className="size-3"/> 반려</div><div className="text-2xl font-bold">{counts.rejected}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">전체</div><div className="text-2xl font-bold">{counts.all}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">접수 이력</CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"/>
              <Input className="pl-8 h-9" placeholder="보고자/위치/내용 검색" value={q} onChange={e => setQ(e.target.value)} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={v => setTab(v as Tab)}>
            <TabsList>
              <TabsTrigger value="pending">미해결 <Badge variant="destructive" className="ml-1.5">{counts.pending}</Badge></TabsTrigger>
              <TabsTrigger value="done">조치완료 <Badge variant="outline" className="ml-1.5">{counts.done}</Badge></TabsTrigger>
              <TabsTrigger value="rejected">반려 <Badge variant="secondary" className="ml-1.5">{counts.rejected}</Badge></TabsTrigger>
              <TabsTrigger value="all">전체 <Badge variant="secondary" className="ml-1.5">{counts.all}</Badge></TabsTrigger>
            </TabsList>
            <TabsContent value={tab} className="mt-3">
              {loading ? (
                <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : filtered.length === 0 ? (
                <div className="text-sm text-muted-foreground py-10 text-center border rounded">
                  {q ? '검색 결과가 없습니다.' : tab === 'pending' ? '미해결 작업중지 요청이 없습니다. ✅' : '데이터가 없습니다.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0"><tr className="text-left">
                      <th className="p-2">접수일시</th><th className="p-2">보고자</th>
                      <th className="p-2">위치</th><th className="p-2">위험상황</th>
                      <th className="p-2">사진</th>
                      <th className="p-2">상태</th><th className="p-2">재개일시</th><th className="p-2"></th>
                    </tr></thead>
                    <tbody>
                      {filtered.map(r => (
                        <tr key={r.id} className="border-t hover:bg-muted/30">
                          <td className="p-2 whitespace-nowrap text-xs">{new Date(r.created_at).toLocaleString('ko-KR')}</td>
                          <td className="p-2">{workStopDisplayName(r)}</td>
                          <td className="p-2">{r.location || '-'}</td>
                          <td className="p-2 max-w-md truncate" title={r.hazard_description}>{r.hazard_description}</td>
                          <td className="p-2">
                            {(() => {
                              const urls = parseWorkStopPhotoUrls(r.photo_url);
                              return urls.length
                                ? <WorkStopPhotos urls={urls.slice(0, 1)} size="sm" />
                                : <span className="text-xs text-muted-foreground">없음</span>;
                            })()}
                          </td>
                          <td className="p-2"><Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge></td>
                          <td className="p-2 whitespace-nowrap text-xs">{r.resumed_at ? new Date(r.resumed_at).toLocaleString('ko-KR') : <Clock className="size-3 inline text-muted-foreground"/>}</td>
                          <td className="p-2">
                            <Button size="sm" variant="ghost" disabled={!canHandle} onClick={() => openHandle(r)}>처리</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>작업중지 처리</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="p-3 rounded bg-muted/50 text-sm space-y-2">
                <div className="font-medium">{workStopDisplayName(editing)} · {editing.location || '위치 미상'}</div>
                <div className="text-muted-foreground">{editing.hazard_description}</div>
                <WorkStopPhotos urls={parseWorkStopPhotoUrls(editing.photo_url)} />
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
              <p className="text-xs text-destructive">⚠️ 작업중지권 행사 근로자에 대한 어떠한 불이익 처우도 금지됩니다 ({WORK_STOP_LEGAL_CITE}).</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={handle} disabled={!canHandle}>처리</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
