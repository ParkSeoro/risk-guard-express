import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Plus, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, FileSignature, Pencil, Trash2, Users, Copy } from 'lucide-react';
import { useAuditLog } from '@/hooks/useAuditLog';
import WorkPermitWorkersDialog from '@/components/permits/WorkPermitWorkersDialog';
import SubmitApprovalDialog from '@/components/approval/SubmitApprovalDialog';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import type { PermitType } from '@/components/permits/DigPermitForm';
import PermitKindSelector from '@/components/permits/PermitKindSelector';
import { normalizePermitKinds, primaryPermitKind, type PermitKindId, PERMIT_KIND_LABEL } from '@/lib/permitKinds';
import {
  todayKst,
  syncPermitDateFromWorkStart,
  resolvePermitWorkDate,
  permitValidityKind,
  shouldShowPermitValidityBadge,
  canViewPermitInList,
  isUserInvolvedInPermit,
} from '@/lib/permitWorkDate';
import { filterRunsByCompanyScope } from '@/lib/companyDocScope';


const STATUS_COLOR: Record<string, string> = {
  '작성중': 'bg-muted text-muted-foreground',
  '임시저장': 'bg-muted text-muted-foreground',
  '결재중': 'bg-primary/10 text-primary',
  '결재진행': 'bg-primary/10 text-primary',
  '검토대기': 'bg-warning/10 text-warning',
  '검토완료': 'bg-primary/10 text-primary',
  '대기': 'bg-muted text-muted-foreground',
  '승인': 'bg-success/10 text-success',
  '발행완료': 'bg-success/10 text-success',
  '승인완료': 'bg-success/10 text-success',
  '반려': 'bg-destructive/10 text-destructive',
  '작업중': 'bg-primary/10 text-primary',
  '완료': 'bg-accent/10 text-accent',
};

const EDITABLE_PERMIT_STATUSES = new Set(['작성중', '반려', '임시저장']);
const APPROVED_PERMIT_STATUSES = new Set(['승인', '승인완료', '발행완료', 'approved']);

function permitStatusLabel(status?: string | null) {
  if (APPROVED_PERMIT_STATUSES.has(status || '')) return '발행 완료';
  if (status === '결재중' || status === '결재진행') return '결재 진행중';
  return status || '-';
}
function isPermitEditable(status?: string | null) {
  return EDITABLE_PERMIT_STATUSES.has(status || '');
}

const userLabel = (u: any) => u?.user_metadata?.display_name || u?.email || '';
const PERMIT_TYPES: { id: PermitType; label: string }[] = [
  { id: 'general', label: '일반 안전작업허가서' },
  { id: 'confined_space', label: '밀폐공간 작업허가서' },
  { id: 'hot_work', label: '화기작업허가서' },
  { id: 'excavation', label: '굴착·중장비 작업허가서' },
];

const makeBlankForm = (companyName = '') => ({
  permit_date: todayKst(),
  permit_type: 'general' as PermitType,
  permit_kinds: ['general'] as PermitKindId[],
  work_name: '',
  work_description: '',
  location: '',
  work_location: '',
  contractor_company: companyName,
  applicant_company: companyName,
  personnel_count: '',
  work_start: '',
  work_end: '',
  work_plan_id: '',
  assessment_run_id: '',
  tbm_session_id: '',
});

function toDbTimestamp(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toLocalInput(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cleanCloneData(src: any) {
  const formData = { ...(src?.form_data || {}) };
  ['approved_at', 'reviewed_at', 'work_extend_until'].forEach((k) => delete formData[k]);
  return formData;
}

export default function WorkPermits() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const { log } = useAuditLog();
  const navigate = useNavigate();
  const {
    selectedProject: projectId,
    userCompanyId,
    userCompanyType,
    userRole,
    applyCompanyFilter,
    isProjectAdmin,
    accessibleCompanyIds,
  } = useGlobalProjectAccess();

  const [permits, setPermits] = useState<any[]>([]);
  const [involvedPermitIds, setInvolvedPermitIds] = useState<Set<string>>(new Set());
  const [listTab, setListTab] = useState<'all' | 'involved'>('all');
  const [plans, setPlans] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [tbms, setTbms] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [gateOpen, setGateOpen] = useState<any | null>(null);
  const [gateResult, setGateResult] = useState<any>(null);
  const [workersDialog, setWorkersDialog] = useState<any | null>(null);
  const [approvalTarget, setApprovalTarget] = useState<any | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [previousPermits, setPreviousPermits] = useState<any[]>([]);
  const [loadingPrevious, setLoadingPrevious] = useState(false);

  const [form, setForm] = useState<any>(() => makeBlankForm());

  const visibilityOpts = useMemo(
    () => ({
      userId: user?.id || null,
      isPermitAdmin: !!isProjectAdmin || !!isAdmin,
      involvedPermitIds,
    }),
    [user?.id, isProjectAdmin, isAdmin, involvedPermitIds],
  );

  const visiblePermits = useMemo(() => {
    const scoped = permits.filter((p) => canViewPermitInList(p, visibilityOpts));
    if (listTab === 'involved') {
      return scoped.filter((p) => isUserInvolvedInPermit(p, visibilityOpts));
    }
    return scoped;
  }, [permits, visibilityOpts, listTab]);

  const load = async () => {
    if (!projectId) return;
    let permitQuery: any = supabase
      .from('work_permits' as any)
      .select('*')
      .eq('project_id', projectId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });
    permitQuery = applyCompanyFilter(permitQuery);

    let plansQ: any = supabase.from('work_plans' as any).select('id, title, status').eq('project_id', projectId).order('created_at', { ascending: false }).limit(100);
    plansQ = applyCompanyFilter(plansQ);
    let tbmQ: any = supabase.from('tbm_sessions' as any).select('id, title, tbm_date, is_active').eq('project_id', projectId).order('created_at', { ascending: false }).limit(50);
    tbmQ = applyCompanyFilter(tbmQ);
    // assessment_runs: no company_id — filter by target_company_ids / creator for subordinates
    let runsQ: any = supabase.from('assessment_runs').select('id, period_label, status, created_by, target_company_ids').eq('project_id', projectId).eq('is_deleted', false).order('created_at', { ascending: false }).limit(100);

    const [{ data: p }, { data: wp }, { data: ar }, { data: tb }, { data: myApprovals }] = await Promise.all([
      permitQuery,
      plansQ,
      runsQ,
      tbmQ,
      user?.id
        ? supabase
            .from('approvals')
            .select('entity_id')
            .eq('project_id', projectId)
            .eq('entity_type', 'work_permit')
            .eq('approver_id', user.id)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    setPermits((p as any) || []);
    setInvolvedPermitIds(
      new Set(
        ((myApprovals as any[]) || [])
          .map((a) => a.entity_id)
          .filter((id): id is string => !!id),
      ),
    );
    setPlans((wp as any) || []);
    const runsRaw = (ar as any[]) || [];
    setRuns(
      filterRunsByCompanyScope(runsRaw, {
        userId: user?.id,
        accessibleCompanyIds,
      }),
    );
    setTbms((tb as any) || []);
  };

  useEffect(() => { load(); }, [projectId, user?.id, applyCompanyFilter, accessibleCompanyIds]);

  useEffect(() => {
    if (!userCompanyId) { setCompanyName(''); return; }
    (async () => {
      const { data } = await supabase.from('companies').select('name').eq('id', userCompanyId).maybeSingle();
      const name = (data as any)?.name || '';
      setCompanyName(name);
      setForm((current: any) => ({
        ...current,
        contractor_company: current.contractor_company || name,
        applicant_company: current.applicant_company || name,
      }));
    })();
  }, [userCompanyId]);

  useEffect(() => {
    if (!showCreate || !projectId) { setPreviousPermits([]); return; }
    (async () => {
      setLoadingPrevious(true);
      let q: any = supabase
        .from('work_permits' as any)
        .select('id, permit_date, permit_type, work_name, work_description, location, contractor_company, personnel_count, work_start_at, work_end_at, form_data')
        .eq('project_id', projectId)
        .eq('is_deleted', false)
        .eq('permit_type', form.permit_type || 'general')
        .order('permit_date', { ascending: false })
        .limit(10);
      q = applyCompanyFilter(q);
      const { data } = await q;
      setPreviousPermits((data as any[]) || []);
      setLoadingPrevious(false);
    })();
  }, [showCreate, projectId, form.permit_type, applyCompanyFilter]);

  const resetForm = () => setForm(makeBlankForm(companyName));

  const applyPreviousPermit = (src: any) => {
    const cloned = cleanCloneData(src);
    const location = cloned.work_location || src.location || '';
    setForm((current: any) => ({
      ...current,
      ...cloned,
      permit_date: current.permit_date,
      permit_type: current.permit_type,
      work_plan_id: current.work_plan_id,
      assessment_run_id: current.assessment_run_id,
      tbm_session_id: current.tbm_session_id,
      work_name: cloned.work_name || src.work_name || '',
      work_description: cloned.work_description || src.work_description || '',
      location,
      work_location: location,
      contractor_company: companyName || cloned.contractor_company || src.contractor_company || '',
      applicant_company: companyName || cloned.applicant_company || '',
      personnel_count: cloned.personnel_count || src.personnel_count || '',
      work_start: toLocalInput(src.work_start_at) || cloned.work_start || '',
      work_end: toLocalInput(src.work_end_at) || cloned.work_end || '',
    }));
    toast({ title: '전회차 내용을 생성 양식에 반영했습니다.' });
  };

  const save = async () => {
    if (!projectId) return toast({ title: '프로젝트를 먼저 선택하세요.', variant: 'destructive' });
    if (!form.work_description.trim()) return toast({ title: '작업 내용을 입력하세요.', variant: 'destructive' });
    const kinds = normalizePermitKinds(form.permit_kinds, (form.permit_type || 'general') as PermitKindId);
    const primary = primaryPermitKind(kinds);
    const syncedPermitDate = syncPermitDateFromWorkStart(form.work_start, form.permit_date);
    const formData = {
      ...form,
      permit_date: syncedPermitDate,
      permit_kinds: kinds,
      contractor_company: form.contractor_company || companyName,
      applicant_company: form.applicant_company || form.contractor_company || companyName,
      work_location: form.work_location || form.location,
      work_description: form.work_description,
      work_name: form.work_name || form.work_description,
      personnel_count: Number(form.personnel_count || 0),
    };
    const payload: any = {
      permit_date: syncedPermitDate,
      permit_type: primary,
      permit_kinds: kinds,
      form_data: formData,
      work_name: formData.work_name,
      work_description: form.work_description,
      location: formData.work_location || form.location,
      contractor_company: formData.contractor_company,
      personnel_count: formData.personnel_count,
      work_start_at: toDbTimestamp(form.work_start),
      work_end_at: toDbTimestamp(form.work_end),
      work_plan_id: form.work_plan_id || null,
      assessment_run_id: form.assessment_run_id || null,
      tbm_session_id: form.tbm_session_id || null,
    };
    if (editing) {
      if (!isPermitEditable(editing.status)) {
        return toast({ title: '수정 불가', description: '결재 진행중/완료 문서는 수정할 수 없습니다.', variant: 'destructive' });
      }
      const { error } = await supabase.from('work_permits' as any).update(payload).eq('id', editing.id);
      if (error) return toast({ title: '수정 실패', description: error.message, variant: 'destructive' });
      toast({ title: '작업허가서가 수정되었습니다.' });
    } else {
      const { error } = await supabase.from('work_permits' as any).insert({
        ...payload, project_id: projectId, company_id: userCompanyId || null, created_by: user?.id, status: '작성중',
      });
      if (error) return toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
      toast({ title: '작업허가서가 생성되었습니다.' });
    }
    setShowCreate(false); setEditing(null); resetForm();
    load();
  };

  const openEdit = (p: any) => {
    if (!isPermitEditable(p.status)) {
      toast({ title: '수정 불가', description: '결재 진행중/완료 문서는 수정할 수 없습니다.', variant: 'destructive' });
      return;
    }
    setEditing(p);
    setForm({
      permit_date: syncPermitDateFromWorkStart(
        p.form_data?.work_start || toLocalInput(p.work_start_at),
        p.permit_date || todayKst(),
      ),
      permit_type: p.permit_type || 'general',
      permit_kinds: normalizePermitKinds(p.permit_kinds, (p.permit_type || 'general') as PermitKindId),
      work_name: p.work_name || p.form_data?.work_name || '',
      work_description: p.work_description || '',
      location: p.location || p.form_data?.work_location || '',
      work_location: p.form_data?.work_location || p.location || '',
      contractor_company: p.contractor_company || p.form_data?.contractor_company || companyName,
      applicant_company: p.form_data?.applicant_company || p.contractor_company || companyName,
      personnel_count: p.personnel_count || p.form_data?.personnel_count || '',
      work_start: p.form_data?.work_start || toLocalInput(p.work_start_at),
      work_end: p.form_data?.work_end || toLocalInput(p.work_end_at),
      work_plan_id: p.work_plan_id || '',
      assessment_run_id: p.assessment_run_id || '',
      tbm_session_id: p.tbm_session_id || '',
    });
  };

  const remove = async (p: any) => {
    const reason = prompt(`작업허가서를 삭제합니다. 사유를 입력하세요.\n[${p.work_description}]`);
    if (!reason || !reason.trim()) return;
    const { error } = await supabase.from('work_permits' as any).update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_reason: reason,
      deleted_by: user?.id || null,
    }).eq('id', p.id);
    if (error) return toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
    await log('삭제', 'work_permit', p.id, projectId || undefined, { reason, work_description: p.work_description });
    toast({ title: '작업허가서가 삭제되었습니다.' });
    load();
  };

  const runGateCheck = async (permit: any) => {
    setGateOpen(permit);
    setGateResult(null);

    // 결재 게이트: 위험성평가/작업계획서는 선택. 연결된 경우에만 상태 검증.
    const checks: any = {
      assessment: { ok: true, msg: '위험성평가 미연결 (선택)' },
      work_plan: { ok: true, msg: '작업계획서 미연결 (선택)' },
    };
    // TBM은 실행 조건(별도 표시)
    const exec: any = { tbm: { ok: false, msg: 'TBM 미실시 - 작업 실행 시 당일 TBM 필요' } };

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
      const today = todayKst();
      const { data: tbm } = await supabase.from('tbm_sessions' as any).select('tbm_date').eq('id', permit.tbm_session_id).single();
      const isSameDay = (tbm as any)?.tbm_date === today;
      const { count } = await supabase.from('tbm_participations' as any)
        .select('id', { count: 'exact', head: true }).eq('tbm_session_id', permit.tbm_session_id);
      if ((count || 0) > 0 && isSameDay) {
        exec.tbm = { ok: true, msg: `당일 TBM 참여 ${count}명 - 작업 실행 가능` };
      } else if ((count || 0) > 0) {
        exec.tbm = { ok: false, msg: `TBM 참여 ${count}명 (당일 TBM 아님 - 당일 실시 필요)` };
      } else {
        exec.tbm = { ok: false, msg: 'TBM 참여자 0명 - 작업 실행 시 당일 TBM 필요' };
      }
    }

    const all_ok = Object.values(checks).every((c: any) => c.ok); // 결재용 (연결된 항목만 검증)
    const exec_ok = exec.tbm.ok; // 실행용
    setGateResult({ checks, exec, all_ok, exec_ok });


    await supabase.from('work_permits' as any).update({
      gate_check_result: { checks, exec, all_ok, exec_ok, checked_at: new Date().toISOString() },
      weather_check_passed: true,
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

      <Tabs value={listTab} onValueChange={(v) => setListTab(v as 'all' | 'involved')}>
        <TabsList>
          <TabsTrigger value="all">전체</TabsTrigger>
          <TabsTrigger value="involved">내가 관여</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-3">
        {visiblePermits.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            {listTab === 'involved' ? '내가 작성·결재한 작업허가서가 없습니다.' : '등록된 작업허가서가 없습니다.'}
          </CardContent></Card>
        ) : visiblePermits.map((p) => {
          const workDate = resolvePermitWorkDate(p);
          const today = todayKst();
          const validity = shouldShowPermitValidityBadge(p.status) ? permitValidityKind(workDate, today) : null;
          return (
          <Card key={p.id}>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={STATUS_COLOR[p.status] || ''}>{permitStatusLabel(p.status)}</Badge>
                  <button className="font-semibold text-left hover:underline" onClick={() => navigate(`/work-permits/${p.id}`)}>{p.work_description}</button>
                  {validity === 'expired' && <Badge variant="outline" className="text-destructive border-destructive/40">만료 (유효기간 경과)</Badge>}
                  {validity === 'today' && <Badge variant="outline" className="text-success border-success/40">오늘 유효</Badge>}
                  {validity === 'scheduled' && workDate && <Badge variant="outline" className="text-muted-foreground">예정 ({workDate})</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {workDate || '-'} · {p.location || '-'}
                  {' · '}
                  {normalizePermitKinds(p.permit_kinds, (p.permit_type || 'general') as PermitKindId)
                    .map((k) => PERMIT_KIND_LABEL[k])
                    .join(' · ')}
                </p>
                {p.gate_check_result?.all_ok === false && (
                  <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />결재불가 - 연결된 위험성평가/작업계획서가 승인완료 상태가 아닙니다</p>
                )}
                {p.gate_check_result?.all_ok === true && (
                  <p className="text-xs text-success mt-1 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />결재 가능</p>
                )}

                {APPROVED_PERMIT_STATUSES.has(p.status) && (
                  p.gate_check_result?.exec_ok
                    ? <p className="text-xs text-success mt-1 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />당일 TBM 완료 - 작업 실행 가능</p>
                    : <p className="text-xs text-warning mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />작업 불가 - 당일 TBM 미실시</p>
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
                {isPermitEditable(p.status) && (
                  <>
                    <Button size="sm" onClick={() => submit(p)} disabled={!p.gate_check_result?.all_ok}>상신</Button>
                    <Button size="sm" variant="outline" onClick={() => setApprovalTarget(p)}>결재상신(결재선 지정)</Button>
                  </>
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
                <Button size="sm" onClick={() => navigate(`/work-permits/${p.id}`)}><FileSignature className="h-3 w-3 mr-1" />{isPermitEditable(p.status) ? '양식 작성' : '양식 조회'}</Button>
                <Button size="sm" variant="outline" onClick={() => setWorkersDialog(p)} title="근로자 배정"><Users className="h-3 w-3" /></Button>
                {isPermitEditable(p.status) && (
                  <Button size="sm" variant="outline" onClick={() => openEdit(p)} title="수정"><Pencil className="h-3 w-3" /></Button>
                )}
                {isAdmin && (
                  <Button size="sm" variant="outline" onClick={() => remove(p)} title="삭제"><Trash2 className="h-3 w-3 text-destructive" /></Button>
                )}
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>

      <Dialog open={showCreate || !!editing} onOpenChange={(v) => { if (!v) { setShowCreate(false); setEditing(null); resetForm(); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? '작업허가서 수정' : '작업허가서 생성'}</DialogTitle></DialogHeader>
          <div className="space-y-3 pb-2">
            <div>
              <PermitKindSelector
                value={normalizePermitKinds(form.permit_kinds, (form.permit_type || 'general') as PermitKindId)}
                onChange={(kinds) => setForm({
                  ...form,
                  permit_kinds: kinds,
                  permit_type: primaryPermitKind(kinds),
                })}
                disabled={!!editing}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>작업 일자</Label><Input type="date" value={form.permit_date} onChange={(e) => setForm({ ...form, permit_date: e.target.value })} /></div>
              <div><Label>장소</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            </div>
            <div><Label>공사업체</Label><Input value={form.contractor_company} onChange={(e) => setForm({ ...form, contractor_company: e.target.value, applicant_company: e.target.value })} placeholder="작성자 소속 회사 자동 입력" /></div>
            <div><Label>작업명</Label><Input value={form.work_name} onChange={(e) => setForm({ ...form, work_name: e.target.value })} /></div>
            <div><Label>작업 내용 *</Label><Textarea value={form.work_description} onChange={(e) => setForm({ ...form, work_description: e.target.value })} rows={3} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>작업 시작</Label>
                <Input
                  type="datetime-local"
                  value={form.work_start}
                  onChange={(e) => {
                    const work_start = e.target.value;
                    setForm({
                      ...form,
                      work_start,
                      permit_date: syncPermitDateFromWorkStart(work_start, form.permit_date),
                    });
                  }}
                />
              </div>
              <div><Label>작업 종료</Label><Input type="datetime-local" value={form.work_end} onChange={(e) => setForm({ ...form, work_end: e.target.value })} /></div>
            </div>
            <div><Label>작업 인원</Label><Input type="number" value={form.personnel_count} onChange={(e) => setForm({ ...form, personnel_count: e.target.value })} /></div>
            {!editing && (
              <div>
                <Label className="flex items-center gap-1"><Copy className="h-3 w-3" />전회차 복사</Label>
                <Select
                  value=""
                  onValueChange={(v) => {
                    const src = previousPermits.find((p) => p.id === v);
                    if (src) applyPreviousPermit(src);
                  }}
                  disabled={loadingPrevious || previousPermits.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      loadingPrevious ? '이전 허가서를 불러오는 중...'
                        : previousPermits.length === 0 ? '같은 종류의 이전 허가서가 없습니다'
                        : '최신 회차부터 선택하여 내용 복사'
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {previousPermits.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {resolvePermitWorkDate(p) || p.permit_date} · {p.work_name || p.form_data?.work_name || p.work_description || '(제목 없음)'} · {p.location || p.form_data?.work_location || '-'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
            <Button onClick={save} className="w-full">{editing ? '수정' : '생성'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!gateOpen} onOpenChange={(v) => !v && setGateOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>작업 게이트 체크 결과</DialogTitle></DialogHeader>
          {!gateResult ? <p className="text-sm text-muted-foreground">검사 중...</p> : (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold mb-1 text-muted-foreground">결재 조건 (사전 승인용)</p>
                <div className="space-y-1">
                  {Object.entries(gateResult.checks).map(([k, v]: any) => (
                    <div key={k} className="flex items-center gap-2 p-2 rounded border">
                      {v.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                      <span className="text-sm font-medium w-24">{k === 'assessment' ? '위험성평가' : '작업계획서'}</span>
                      <span className="text-sm text-muted-foreground">{v.msg}</span>
                    </div>
                  ))}
                </div>
                <div className={`p-2 mt-2 rounded text-center text-sm font-bold ${gateResult.all_ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                  {gateResult.all_ok ? '✅ 결재 가능' : '🚫 결재 불가'}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold mb-1 text-muted-foreground">작업 실행 조건 (당일 TBM)</p>
                <div className="flex items-center gap-2 p-2 rounded border">
                  {gateResult.exec?.tbm.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-warning" />}
                  <span className="text-sm font-medium w-24">TBM</span>
                  <span className="text-sm text-muted-foreground">{gateResult.exec?.tbm.msg}</span>
                </div>
                <div className={`p-2 mt-2 rounded text-center text-sm font-bold ${gateResult.exec_ok ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                  {gateResult.exec_ok ? '✅ 작업 실행 가능' : '⚠ 작업 불가 - 당일 TBM 미실시'}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <WorkPermitWorkersDialog
        permit={workersDialog}
        projectId={projectId}
        open={!!workersDialog}
        onClose={() => setWorkersDialog(null)}
      />
      {approvalTarget && (
        <SubmitApprovalDialog
          open={!!approvalTarget}
          onOpenChange={(v) => !v && setApprovalTarget(null)}
          entityType="work_permit"
          entityId={approvalTarget.id}
          projectId={projectId}
          submitterCompanyId={approvalTarget.company_id || userCompanyId || null}
          onSubmitted={() => { setApprovalTarget(null); load(); }}
        />
      )}
    </div>
  );
}
