import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, FileSignature, Pencil, Trash2 } from 'lucide-react';

const STATUS_COLOR: Record<string, string> = {
  '작성중': 'bg-muted text-muted-foreground',
  '검토대기': 'bg-warning/10 text-warning',
  '검토완료': 'bg-primary/10 text-primary',
  '대기': 'bg-muted text-muted-foreground',
  '승인': 'bg-success/10 text-success',
  '반려': 'bg-destructive/10 text-destructive',
  '작업중': 'bg-primary/10 text-primary',
  '완료': 'bg-accent/10 text-accent',
};

const userLabel = (u: any) => u?.user_metadata?.display_name || u?.email || '';

export default function WorkPermits() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const projectId = typeof window !== 'undefined' ? localStorage.getItem('selectedProjectId') || '' : '';

  const [permits, setPermits] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [tbms, setTbms] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [gateOpen, setGateOpen] = useState<any | null>(null);
  const [gateResult, setGateResult] = useState<any>(null);

  const blankForm = {
    permit_date: new Date().toISOString().slice(0, 10),
    work_description: '', location: '',
    work_plan_id: '', assessment_run_id: '', tbm_session_id: '',
  };
  const [form, setForm] = useState<any>(blankForm);

  const load = async () => {
    if (!projectId) return;
    const [{ data: p }, { data: wp }, { data: ar }, { data: tb }] = await Promise.all([
      supabase.from('work_permits' as any).select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('work_plans' as any).select('id, title, status').eq('project_id', projectId).order('created_at', { ascending: false }).limit(100),
      supabase.from('assessment_runs').select('id, period_label, status').eq('project_id', projectId).eq('is_deleted', false).order('created_at', { ascending: false }).limit(100),
      supabase.from('tbm_sessions' as any).select('id, title, tbm_date, is_active').eq('project_id', projectId).order('created_at', { ascending: false }).limit(50),
    ]);
    setPermits((p as any) || []);
    setPlans((wp as any) || []);
    setRuns((ar as any) || []);
    setTbms((tb as any) || []);
  };

  useEffect(() => { load(); }, [projectId]);

  const save = async () => {
    if (!projectId) return toast({ title: '프로젝트를 먼저 선택하세요.', variant: 'destructive' });
    if (!form.work_description.trim()) return toast({ title: '작업 내용을 입력하세요.', variant: 'destructive' });
    const payload: any = {
      permit_date: form.permit_date,
      work_description: form.work_description,
      location: form.location,
      work_plan_id: form.work_plan_id || null,
      assessment_run_id: form.assessment_run_id || null,
      tbm_session_id: form.tbm_session_id || null,
    };
    if (editing) {
      const { error } = await supabase.from('work_permits' as any).update(payload).eq('id', editing.id);
      if (error) return toast({ title: '수정 실패', description: error.message, variant: 'destructive' });
      toast({ title: '작업허가서가 수정되었습니다.' });
    } else {
      const { error } = await supabase.from('work_permits' as any).insert({
        ...payload, project_id: projectId, created_by: user?.id, status: '작성중',
      });
      if (error) return toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
      toast({ title: '작업허가서가 생성되었습니다.' });
    }
    setShowCreate(false); setEditing(null); setForm(blankForm);
    load();
  };

  const openEdit = (p: any) => {
    if (p.status === '승인') {
      if (!confirm('승인된 허가서입니다. 수정하면 추적이 남습니다. 계속하시겠습니까?')) return;
    }
    setEditing(p);
    setForm({
      permit_date: p.permit_date || new Date().toISOString().slice(0, 10),
      work_description: p.work_description || '',
      location: p.location || '',
      work_plan_id: p.work_plan_id || '',
      assessment_run_id: p.assessment_run_id || '',
      tbm_session_id: p.tbm_session_id || '',
    });
  };

  const remove = async (p: any) => {
    const reason = prompt(`작업허가서를 삭제합니다. 사유를 입력하세요.\n[${p.work_description}]`);
    if (!reason) return;
    const { error } = await supabase.from('work_permits' as any).delete().eq('id', p.id);
    if (error) return toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
    toast({ title: '작업허가서가 삭제되었습니다.' });
    load();
  };

  const runGateCheck = async (permit: any) => {
    setGateOpen(permit);
    setGateResult(null);

    const checks: any = {
      assessment: { ok: false, msg: '위험성평가 미연결' },
      work_plan: { ok: false, msg: '작업계획서 미연결' },
      tbm: { ok: false, msg: 'TBM 미연결' },
      weather: { ok: true, msg: '확인됨' },
    };

    if (permit.assessment_run_id) {
      const { data } = await supabase.from('assessment_runs').select('status').eq('id', permit.assessment_run_id).single();
      checks.assessment = data?.status === '승인완료'
        ? { ok: true, msg: `위험성평가 승인완료` }
        : { ok: false, msg: `위험성평가 상태: ${data?.status || '없음'}` };
    }
    if (permit.work_plan_id) {
      const { data } = await supabase.from('work_plans' as any).select('status').eq('id', permit.work_plan_id).single();
      const st = (data as any)?.status;
      checks.work_plan = st === '승인완료' || st === 'approved'
        ? { ok: true, msg: '작업계획서 승인완료' }
        : { ok: false, msg: `작업계획서 상태: ${st || '없음'}` };
    }
    if (permit.tbm_session_id) {
      const { count } = await supabase.from('tbm_participations' as any)
        .select('id', { count: 'exact', head: true }).eq('tbm_session_id', permit.tbm_session_id);
      checks.tbm = (count || 0) > 0
        ? { ok: true, msg: `TBM 참여 ${count}명` }
        : { ok: false, msg: 'TBM 참여자 0명' };
    }

    const all_ok = Object.values(checks).every((c: any) => c.ok);
    setGateResult({ checks, all_ok });

    await supabase.from('work_permits' as any).update({
      gate_check_result: { checks, all_ok, checked_at: new Date().toISOString() },
      weather_check_passed: checks.weather.ok,
    }).eq('id', permit.id);
    load();
  };

  const submit = async (permit: any) => {
    if (!permit.gate_check_result?.all_ok) {
      return toast({ title: '게이트 체크 통과 후 상신할 수 있습니다.', variant: 'destructive' });
    }
    await supabase.from('work_permits' as any).update({
      status: '검토대기',
      submitted_by: user?.id,
      submitted_by_name: userLabel(user),
      submitted_at: new Date().toISOString(),
    }).eq('id', permit.id);
    toast({ title: '검토 요청이 상신되었습니다.' });
    load();
  };

  const review = async (permit: any) => {
    const comment = prompt('검토 의견 (선택)') || '';
    await supabase.from('work_permits' as any).update({
      status: '검토완료',
      reviewed_by: user?.id,
      reviewed_by_name: userLabel(user),
      reviewed_at: new Date().toISOString(),
      review_comment: comment,
    }).eq('id', permit.id);
    toast({ title: '검토 완료되었습니다.' });
    load();
  };

  const approve = async (permit: any) => {
    if (permit.status !== '검토완료') {
      return toast({ title: '검토 완료 후 승인할 수 있습니다.', variant: 'destructive' });
    }
    const comment = prompt('승인 의견 (선택)') || '';
    await supabase.from('work_permits' as any).update({
      status: '승인',
      approved_by: user?.id,
      approved_by_name: userLabel(user),
      approved_at: new Date().toISOString(),
      approval_comment: comment,
    }).eq('id', permit.id);
    toast({ title: '승인되었습니다.' });
    load();
  };

  const reject = async (permit: any) => {
    const reason = prompt('반려 사유를 입력하세요');
    if (!reason) return;
    await supabase.from('work_permits' as any).update({ status: '반려', rejection_reason: reason }).eq('id', permit.id);
    toast({ title: '반려되었습니다.' });
    load();
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileSignature className="h-6 w-6" />작업허가서</h1>
          <p className="text-sm text-muted-foreground">위험성평가·작업계획서·TBM 참여를 통합 검증하여 작업을 승인합니다.</p>
        </div>
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1" />허가서 생성</Button>
      </div>

      <div className="grid gap-3">
        {permits.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">등록된 작업허가서가 없습니다.</CardContent></Card>
        ) : permits.map((p) => (
          <Card key={p.id}>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_COLOR[p.status] || ''}>{p.status}</Badge>
                  <span className="font-semibold">{p.work_description}</span>
                </div>
                <p className="text-xs text-muted-foreground">{p.permit_date} · {p.location || '-'}</p>
                {p.gate_check_result?.all_ok === false && (
                  <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />작업불가 - 조건 미충족</p>
                )}
                {p.gate_check_result?.all_ok === true && (
                  <p className="text-xs text-success mt-1 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />작업가능</p>
                )}
                {p.rejection_reason && <p className="text-xs text-destructive mt-1">반려: {p.rejection_reason}</p>}
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  {p.submitted_at && <div>📤 상신: {p.submitted_by_name || '-'} · {new Date(p.submitted_at).toLocaleString('ko-KR')}</div>}
                  {p.reviewed_at && <div>🔍 검토: {p.reviewed_by_name || '-'} · {new Date(p.reviewed_at).toLocaleString('ko-KR')}{p.review_comment ? ` · ${p.review_comment}` : ''}</div>}
                  {p.approved_at && <div>✅ 승인: {p.approved_by_name || '-'} · {new Date(p.approved_at).toLocaleString('ko-KR')}{p.approval_comment ? ` · ${p.approval_comment}` : ''}</div>}
                </div>
              </div>
              <div className="flex gap-1 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => runGateCheck(p)}><ShieldCheck className="h-3 w-3 mr-1" />게이트체크</Button>
                {p.status === '작성중' && (
                  <Button size="sm" onClick={() => submit(p)} disabled={!p.gate_check_result?.all_ok}>상신</Button>
                )}
                {p.status === '검토대기' && isAdmin && (
                  <>
                    <Button size="sm" onClick={() => review(p)}>검토완료</Button>
                    <Button size="sm" variant="destructive" onClick={() => reject(p)}><XCircle className="h-3 w-3 mr-1" />반려</Button>
                  </>
                )}
                {p.status === '검토완료' && isAdmin && (
                  <>
                    <Button size="sm" onClick={() => approve(p)}><CheckCircle2 className="h-3 w-3 mr-1" />승인</Button>
                    <Button size="sm" variant="destructive" onClick={() => reject(p)}><XCircle className="h-3 w-3 mr-1" />반려</Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>작업허가서 생성</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label>일자</Label><Input type="date" value={form.permit_date} onChange={(e) => setForm({ ...form, permit_date: e.target.value })} /></div>
              <div><Label>장소</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            </div>
            <div><Label>작업 내용 *</Label><Textarea value={form.work_description} onChange={(e) => setForm({ ...form, work_description: e.target.value })} rows={3} /></div>
            <div>
              <Label>위험성평가 회차</Label>
              <Select value={form.assessment_run_id} onValueChange={(v) => setForm({ ...form, assessment_run_id: v })}>
                <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                <SelectContent>{runs.map((r) => <SelectItem key={r.id} value={r.id}>{r.period_label} ({r.status})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>작업계획서</Label>
              <Select value={form.work_plan_id} onValueChange={(v) => setForm({ ...form, work_plan_id: v })}>
                <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                <SelectContent>{plans.map((r) => <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>TBM 세션</Label>
              <Select value={form.tbm_session_id} onValueChange={(v) => setForm({ ...form, tbm_session_id: v })}>
                <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                <SelectContent>{tbms.map((r) => <SelectItem key={r.id} value={r.id}>{r.title} ({r.tbm_date})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={create} className="w-full">생성</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!gateOpen} onOpenChange={(v) => !v && setGateOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>작업 게이트 체크 결과</DialogTitle></DialogHeader>
          {!gateResult ? <p className="text-sm text-muted-foreground">검사 중...</p> : (
            <div className="space-y-2">
              {Object.entries(gateResult.checks).map(([k, v]: any) => (
                <div key={k} className="flex items-center gap-2 p-2 rounded border">
                  {v.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                  <span className="text-sm font-medium w-24">
                    {k === 'assessment' ? '위험성평가' : k === 'work_plan' ? '작업계획서' : k === 'tbm' ? 'TBM' : '날씨'}
                  </span>
                  <span className="text-sm text-muted-foreground">{v.msg}</span>
                </div>
              ))}
              <div className={`p-3 rounded text-center font-bold ${gateResult.all_ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                {gateResult.all_ok ? '✅ 작업 가능' : '🚫 작업 불가'}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
