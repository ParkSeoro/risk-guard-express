import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ClipboardCheck, Plus, Camera, Printer, AlertTriangle, CheckCircle2, XCircle, Loader2, Trash2 } from 'lucide-react';
import { buildChecklist, INSPECTION_TYPE_LABELS, PROCESS_CATEGORIES, type InspectionType } from '@/lib/inspectionTemplates';
import IMESafeInput from '@/components/IMESafeInput';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import MultiCompanyFilter from '@/components/MultiCompanyFilter';

type Inspection = {
  id: string;
  inspection_type: InspectionType;
  process_category: string;
  inspector_name: string;
  inspected_at: string;
  location: string;
  summary: string;
  status: string;
  created_at: string;
};

type InspItem = {
  id: string;
  inspection_id: string;
  checklist_code: string;
  label: string;
  legal_basis: string;
  result: 'pass' | 'fail' | 'na';
  note: string;
  photos: string[];
  sort_order: number;
};

type InspAction = {
  id: string;
  inspection_id: string;
  item_id: string | null;
  issue: string;
  severity: string;
  assignee_name: string;
  due_date: string | null;
  status: 'pending' | 'in_progress' | 'done';
  evidence_photos: string[];
  completed_at: string | null;
  completion_note: string;
};

export default function SafetyInspections() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { selectedProject } = useGlobalProjectAccess();
  const projectId = selectedProject;
  const [tab, setTab] = useState('list');
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [actions, setActions] = useState<(InspAction & { inspection?: Inspection })[]>([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [detail, setDetail] = useState<Inspection | null>(null);
  const [detailItems, setDetailItems] = useState<InspItem[]>([]);
  const [detailActions, setDetailActions] = useState<InspAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [companyFilter, setCompanyFilter] = useState<string[]>([]);

  // create form
  const [form, setForm] = useState({
    inspection_type: 'pre_work' as InspectionType,
    process_category: '굴착',
    location: '',
    summary: '',
    inspector_name: profile?.display_name || '',
  });

  const load = async () => {
    if (!projectId) return;
    const { data: insps } = await supabase
      .from('safety_inspections' as any)
      .select('*')
      .eq('project_id', projectId)
      .eq('is_deleted', false)
      .order('inspected_at', { ascending: false })
      .limit(200);
    setInspections((insps as any) || []);

    const { data: acts } = await supabase
      .from('safety_inspection_actions' as any)
      .select('*, inspection:inspection_id(id, is_deleted)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(200);
    // 삭제된 점검에 속한 조치는 제외
    setActions(((acts as any) || []).filter((a: any) => !a.inspection?.is_deleted));
  };
  useEffect(() => { load(); }, [projectId]);

  const handleCreate = async () => {
    if (!projectId) return toast({ title: '프로젝트를 선택하세요.', variant: 'destructive' });
    if (!form.location.trim()) return toast({ title: '점검 위치를 입력하세요.', variant: 'destructive' });
    setLoading(true);
    try {
      const { data: ins, error } = await supabase
        .from('safety_inspections' as any)
        .insert({
          project_id: projectId,
          inspection_type: form.inspection_type,
          process_category: form.process_category,
          location: form.location,
          summary: form.summary,
          inspector_name: form.inspector_name || profile?.display_name || '',
          inspector_id: profile?.user_id,
          created_by: profile?.user_id,
          status: 'in_progress',
        })
        .select()
        .single();
      if (error) throw error;

      const checklist = buildChecklist(form.inspection_type, form.process_category);
      const items = checklist.map((c, i) => ({
        inspection_id: (ins as any).id,
        checklist_code: c.code,
        label: c.label,
        legal_basis: c.legal_basis,
        sort_order: i,
      }));
      if (items.length > 0) {
        const { error: e2 } = await supabase.from('safety_inspection_items' as any).insert(items);
        if (e2) throw e2;
      }
      toast({ title: '점검이 생성되었습니다.', description: `체크리스트 ${items.length}개 항목 자동 생성` });
      setOpenCreate(false);
      await load();
      await openDetail((ins as any));
    } catch (e: any) {
      toast({ title: '생성 실패', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (insp: Inspection) => {
    setDetail(insp);
    const { data: its } = await supabase.from('safety_inspection_items' as any)
      .select('*').eq('inspection_id', insp.id).order('sort_order');
    const normalized = ((its as any) || []).map((x: any) => ({ ...x, photos: x.photos || [] }));
    setDetailItems(normalized);
    const { data: acts } = await supabase.from('safety_inspection_actions' as any)
      .select('*').eq('inspection_id', insp.id).order('created_at');
    setDetailActions(((acts as any) || []).map((x: any) => ({ ...x, evidence_photos: x.evidence_photos || [] })));
  };

  const updateItemResult = async (item: InspItem, result: 'pass' | 'fail' | 'na') => {
    const { error } = await supabase.from('safety_inspection_items' as any)
      .update({ result }).eq('id', item.id);
    if (error) return toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    setDetailItems(prev => prev.map(x => x.id === item.id ? { ...x, result } : x));

    // Auto-create action when fail + notify project safety managers
    if (result === 'fail' && detail) {
      const exists = detailActions.find(a => a.item_id === item.id);
      if (!exists) {
        const { data: a, error: e2 } = await supabase.from('safety_inspection_actions' as any).insert({
          inspection_id: detail.id,
          item_id: item.id,
          project_id: projectId,
          issue: item.label,
          severity: 'medium',
          status: 'pending',
        }).select().single();
        if (!e2 && a) {
          setDetailActions(prev => [...prev, { ...(a as any), evidence_photos: [] }]);
          // Notify project members with admin/safety_manager role
          try {
            const { data: members } = await supabase
              .from('project_members')
              .select('user_id, role_new')
              .eq('project_id', projectId)
              .in('role_new', ['project_admin', 'safety_manager']);
            const { sendNotification } = await import('@/lib/notificationService');
            await Promise.all(((members as any) || []).map((m: any) =>
              sendNotification({
                user_id: m.user_id,
                title: '안전점검 불합격 발생',
                message: `${detail.location} · ${item.label}`,
                type: 'inspection_fail',
                related_id: detail.id,
                related_type: 'safety_inspection',
                project_id: projectId,
              })
            ));
          } catch (e) {
            if (import.meta.env.DEV) console.warn('notify failed', e);
          }
        }
      }
    }
  };

  const updateItemNote = async (item: InspItem, note: string) => {
    setDetailItems(prev => prev.map(x => x.id === item.id ? { ...x, note } : x));
    await supabase.from('safety_inspection_items' as any).update({ note }).eq('id', item.id);
  };

  const uploadPhoto = async (file: File, folder: string): Promise<string | null> => {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${projectId}/safety-inspection/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from('attachments').upload(path, file);
    if (error) { toast({ title: '업로드 실패', description: error.message, variant: 'destructive' }); return null; }
    const { data } = supabase.storage.from('attachments').getPublicUrl(path);
    return data.publicUrl;
  };

  const onItemPhoto = async (item: InspItem, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const urls: string[] = [];
    for (const f of Array.from(files)) {
      const u = await uploadPhoto(f, `item-${item.id}`);
      if (u) urls.push(u);
    }
    const newPhotos = [...(item.photos || []), ...urls];
    await supabase.from('safety_inspection_items' as any).update({ photos: newPhotos }).eq('id', item.id);
    setDetailItems(prev => prev.map(x => x.id === item.id ? { ...x, photos: newPhotos } : x));
  };

  const onActionEvidence = async (action: InspAction, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const urls: string[] = [];
    for (const f of Array.from(files)) {
      const u = await uploadPhoto(f, `action-${action.id}`);
      if (u) urls.push(u);
    }
    const newPhotos = [...(action.evidence_photos || []), ...urls];
    await supabase.from('safety_inspection_actions' as any).update({ evidence_photos: newPhotos }).eq('id', action.id);
    setDetailActions(prev => prev.map(x => x.id === action.id ? { ...x, evidence_photos: newPhotos } : x));
  };

  const completeAction = async (action: InspAction) => {
    if (!action.evidence_photos || action.evidence_photos.length === 0) {
      return toast({ title: '증빙 사진 필수', description: '조치 완료를 위해 증빙 사진을 1장 이상 첨부하세요.', variant: 'destructive' });
    }
    const { error } = await supabase.from('safety_inspection_actions' as any).update({
      status: 'done', completed_at: new Date().toISOString(), completed_by: profile?.user_id,
    }).eq('id', action.id);
    if (error) return toast({ title: '실패', description: error.message, variant: 'destructive' });
    setDetailActions(prev => prev.map(x => x.id === action.id ? { ...x, status: 'done', completed_at: new Date().toISOString() } : x));
    toast({ title: '조치 완료 처리되었습니다.' });
  };

  const updateActionField = async (action: InspAction, patch: Partial<InspAction>) => {
    setDetailActions(prev => prev.map(x => x.id === action.id ? { ...x, ...patch } : x));
    await supabase.from('safety_inspection_actions' as any).update(patch).eq('id', action.id);
  };

  const finishInspection = async () => {
    if (!detail) return;
    await supabase.from('safety_inspections' as any).update({ status: 'completed' }).eq('id', detail.id);
    toast({ title: '점검이 완료되었습니다.' });
    setDetail({ ...detail, status: 'completed' });
    load();
  };

  const removeInspection = async (id: string) => {
    if (!confirm('점검을 삭제하시겠습니까?')) return;
    await supabase.from('safety_inspections' as any).update({ is_deleted: true }).eq('id', id);
    toast({ title: '삭제되었습니다.' });
    setDetail(null);
    load();
  };

  const printDetail = () => {
    if (!detail) return;
    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) return;
    const photoTag = (urls: string[]) => urls.map(u => `<img src="${u}" style="width:120px;height:90px;object-fit:cover;border:1px solid #ccc;margin:2px;"/>`).join('');
    const itemRows = detailItems.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${it.checklist_code}</td>
        <td>${it.label}</td>
        <td style="font-size:10px;color:#555">${it.legal_basis}</td>
        <td style="text-align:center;font-weight:bold;color:${it.result === 'fail' ? '#c00' : it.result === 'pass' ? '#080' : '#888'}">
          ${it.result === 'pass' ? '통과' : it.result === 'fail' ? '불합격' : '해당없음'}
        </td>
        <td>${it.note || ''}</td>
        <td>${photoTag(it.photos || [])}</td>
      </tr>
    `).join('');
    const actionRows = detailActions.map((a, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${a.issue}</td>
        <td>${a.assignee_name || '-'}</td>
        <td>${a.due_date || '-'}</td>
        <td style="text-align:center;color:${a.status === 'done' ? '#080' : '#c80'}">
          ${a.status === 'done' ? '완료' : a.status === 'in_progress' ? '진행중' : '대기'}
        </td>
        <td>${photoTag(a.evidence_photos || [])}</td>
      </tr>
    `).join('');
    win.document.write(`
      <html><head><title>안전점검표</title>
      <style>
        body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;padding:20px;font-size:12px}
        h1{font-size:18px;text-align:center;margin-bottom:10px}
        h2{font-size:14px;border-bottom:2px solid #333;padding-bottom:4px;margin-top:20px}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th,td{border:1px solid #999;padding:5px;vertical-align:top}
        th{background:#eee;font-weight:bold}
        .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:10px 0}
        .meta div{border:1px solid #ccc;padding:6px}
        @media print{body{padding:10mm}}
      </style></head><body>
      <h1>산업안전보건법 기반 안전점검표</h1>
      <div class="meta">
        <div><b>점검 유형:</b> ${INSPECTION_TYPE_LABELS[detail.inspection_type]}</div>
        <div><b>공종:</b> ${detail.process_category}</div>
        <div><b>점검자:</b> ${detail.inspector_name}</div>
        <div><b>점검일시:</b> ${new Date(detail.inspected_at).toLocaleString('ko-KR')}</div>
        <div><b>점검위치:</b> ${detail.location}</div>
        <div><b>상태:</b> ${detail.status}</div>
      </div>
      <h2>점검 항목 (${detailItems.length})</h2>
      <table><thead><tr><th>#</th><th>코드</th><th>점검 항목</th><th>법적 근거</th><th>결과</th><th>비고</th><th>사진</th></tr></thead><tbody>${itemRows}</tbody></table>
      ${detailActions.length > 0 ? `<h2>조치 요청 (${detailActions.length})</h2>
        <table><thead><tr><th>#</th><th>내용</th><th>담당</th><th>기한</th><th>상태</th><th>증빙</th></tr></thead><tbody>${actionRows}</tbody></table>` : ''}
      <p style="margin-top:30px;font-size:10px;color:#666">출력일: ${new Date().toLocaleString('ko-KR')}</p>
      <script>setTimeout(()=>window.print(),500)</script>
      </body></html>
    `);
    win.document.close();
  };

  const failCount = detailItems.filter(x => x.result === 'fail').length;
  const passCount = detailItems.filter(x => x.result === 'pass').length;
  const pendingActions = actions.filter(a => a.status !== 'done').length;

  if (!projectId) {
    return <div className="p-6 text-sm text-muted-foreground">프로젝트를 먼저 선택하세요.</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardCheck className="h-6 w-6" />안전점검</h1>
          <p className="text-sm text-muted-foreground">산업안전보건법 기준 법적 안전점검 · 조치관리</p>
        </div>
        <Button onClick={() => setOpenCreate(true)}><Plus className="h-4 w-4 mr-1" />새 점검</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">점검 목록 ({inspections.length})</TabsTrigger>
          <TabsTrigger value="actions">미조치 항목 <Badge variant={pendingActions > 0 ? 'destructive' : 'secondary'} className="ml-2">{pendingActions}</Badge></TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <div className="grid gap-2">
            {inspections.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">아직 점검 기록이 없습니다.</CardContent></Card>
            ) : inspections.map(i => (
              <Card key={i.id} className="cursor-pointer hover:bg-accent/30" onClick={() => openDetail(i)}>
                <CardContent className="p-3 flex items-center justify-between text-sm">
                  <div className="flex-1">
                    <div className="font-semibold">{INSPECTION_TYPE_LABELS[i.inspection_type]} · {i.process_category}</div>
                    <div className="text-xs text-muted-foreground">{i.location} · {i.inspector_name} · {new Date(i.inspected_at).toLocaleString('ko-KR')}</div>
                  </div>
                  <Badge variant={i.status === 'completed' ? 'default' : 'secondary'}>{i.status === 'completed' ? '완료' : '진행중'}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="actions">
          <div className="grid gap-2">
            {actions.filter(a => a.status !== 'done').length === 0 ? (
              <Card><CardContent className="p-6 text-center text-sm text-muted-foreground"><CheckCircle2 className="h-8 w-8 mx-auto text-success mb-2" />미조치 항목이 없습니다.</CardContent></Card>
            ) : actions.filter(a => a.status !== 'done').map(a => (
              <Card key={a.id}>
                <CardContent className="p-3 text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span className="font-semibold">{a.issue}</span>
                    <Badge variant="outline">{a.severity}</Badge>
                    <Badge variant="secondary">{a.status === 'pending' ? '대기' : '진행중'}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">담당: {a.assignee_name || '미지정'} · 기한: {a.due_date || '미정'}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Create dialog */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>새 안전점검</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>점검 유형</Label>
              <Select value={form.inspection_type} onValueChange={(v) => setForm({ ...form, inspection_type: v as InspectionType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(INSPECTION_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>공종</Label>
              <Select value={form.process_category} onValueChange={(v) => setForm({ ...form, process_category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROCESS_CATEGORIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  <SelectItem value="일반">일반</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>점검 위치</Label>
              <IMESafeInput defaultValue={form.location} onCommit={(v) => setForm({ ...form, location: v })} placeholder="예: 1동 3층 A구역" />
            </div>
            <div>
              <Label>점검자</Label>
              <IMESafeInput defaultValue={form.inspector_name} onCommit={(v) => setForm({ ...form, inspector_name: v })} />
            </div>
            <div>
              <Label>요약(선택)</Label>
              <Textarea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>취소</Button>
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}생성
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between">
                  <span>{INSPECTION_TYPE_LABELS[detail.inspection_type]} · {detail.process_category}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={printDetail}><Printer className="h-4 w-4 mr-1" />인쇄/PDF</Button>
                    {detail.status !== 'completed' && (
                      <Button size="sm" onClick={finishInspection}><CheckCircle2 className="h-4 w-4 mr-1" />점검 완료</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => removeInspection(detail.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </DialogTitle>
              </DialogHeader>

              <div className="text-xs text-muted-foreground mb-2">
                {detail.location} · {detail.inspector_name} · {new Date(detail.inspected_at).toLocaleString('ko-KR')}
                <span className="ml-3"><Badge variant="default" className="bg-success">통과 {passCount}</Badge> <Badge variant="destructive">불합격 {failCount}</Badge></span>
              </div>

              <h3 className="font-semibold mt-2">점검 항목</h3>
              <div className="space-y-2">
                {detailItems.map((it, i) => (
                  <Card key={it.id} className={it.result === 'fail' ? 'border-destructive' : ''}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="text-sm font-medium">{i + 1}. [{it.checklist_code}] {it.label}</div>
                          <div className="text-[10px] text-muted-foreground">{it.legal_basis}</div>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant={it.result === 'pass' ? 'default' : 'outline'} onClick={() => updateItemResult(it, 'pass')} className={it.result === 'pass' ? 'bg-success' : ''}>통과</Button>
                          <Button size="sm" variant={it.result === 'fail' ? 'destructive' : 'outline'} onClick={() => updateItemResult(it, 'fail')}>불합격</Button>
                          <Button size="sm" variant={it.result === 'na' ? 'secondary' : 'outline'} onClick={() => updateItemResult(it, 'na')}>해당없음</Button>
                        </div>
                      </div>
                      <div className="flex gap-2 items-start">
                        <IMESafeInput defaultValue={it.note} onCommit={(v) => updateItemNote(it, v)} placeholder="비고" className="flex-1 text-sm" />
                        <label className="cursor-pointer inline-flex items-center gap-1 text-xs px-2 py-1 border rounded hover:bg-accent">
                          <Camera className="h-3 w-3" />사진
                          <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => onItemPhoto(it, e.target.files)} />
                        </label>
                      </div>
                      {(it.photos || []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {it.photos.map((p, idx) => <img key={idx} src={p} alt="" className="h-16 w-16 object-cover border rounded" />)}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {detailActions.length > 0 && (
                <>
                  <h3 className="font-semibold mt-4 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />조치 요청 ({detailActions.length})</h3>
                  <div className="space-y-2">
                    {detailActions.map(a => (
                      <Card key={a.id} className={a.status === 'done' ? 'border-success' : 'border-warning'}>
                        <CardContent className="p-3 space-y-2 text-sm">
                          <div className="font-medium">{a.issue}</div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <Label className="text-xs">담당자</Label>
                              <IMESafeInput defaultValue={a.assignee_name} onCommit={(v) => updateActionField(a, { assignee_name: v })} />
                            </div>
                            <div>
                              <Label className="text-xs">기한</Label>
                              <Input type="date" value={a.due_date || ''} onChange={(e) => updateActionField(a, { due_date: e.target.value || null })} />
                            </div>
                            <div>
                              <Label className="text-xs">심각도</Label>
                              <Select value={a.severity} onValueChange={(v) => updateActionField(a, { severity: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="low">낮음</SelectItem>
                                  <SelectItem value="medium">보통</SelectItem>
                                  <SelectItem value="high">높음</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="flex gap-2 items-center">
                            <label className="cursor-pointer inline-flex items-center gap-1 text-xs px-2 py-1 border rounded hover:bg-accent">
                              <Camera className="h-3 w-3" />증빙 사진
                              <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => onActionEvidence(a, e.target.files)} />
                            </label>
                            {a.status !== 'done' ? (
                              <Button size="sm" onClick={() => completeAction(a)}><CheckCircle2 className="h-4 w-4 mr-1" />조치 완료</Button>
                            ) : (
                              <Badge className="bg-success">완료 · {a.completed_at ? new Date(a.completed_at).toLocaleString('ko-KR') : ''}</Badge>
                            )}
                          </div>
                          {(a.evidence_photos || []).length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {a.evidence_photos.map((p, idx) => <img key={idx} src={p} alt="" className="h-16 w-16 object-cover border rounded" />)}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
