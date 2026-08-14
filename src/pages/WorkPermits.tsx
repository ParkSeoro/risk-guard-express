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
import { Plus, CheckCircle2, XCircle, FileSignature, Pencil, Trash2, Users, Copy, Clock, Search } from 'lucide-react';
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
  shouldShowPermitRejectionReason,
  resolvePermitCompanyName,
  canViewPermitInList,
  isUserInvolvedInPermit,
} from '@/lib/permitWorkDate';
import { filterRunsByCompanyScope } from '@/lib/companyDocScope';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import {
  filterPermitsForList,
  closureListProgress,
  resolvePermitSubmittedByName,
  resolvePermitApprovedByName,
  type PermitListPeriod,
  type PermitListStatusFilter,
  type PermitApprovalNameRow,
} from '@/lib/permitListQuery';


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
  '종료대기': 'bg-warning/10 text-warning',
  '종료완료': 'bg-muted text-muted-foreground',
  '반려': 'bg-destructive/10 text-destructive',
  '작업중': 'bg-primary/10 text-primary',
  '완료': 'bg-accent/10 text-accent',
};

const EDITABLE_PERMIT_STATUSES = new Set(['작성중', '반려', '임시저장']);
const APPROVED_PERMIT_STATUSES = new Set(['승인', '승인완료', '발행완료', 'approved']);
const CLOSED_PERMIT_STATUSES = new Set(['종료완료', 'CLOSED', '마감']);
const CLOSURE_PENDING_STATUSES = new Set(['종료대기', 'CLOSURE_PENDING']);

function canRequestPermitExtend(p: any): boolean {
  if (!p || CLOSED_PERMIT_STATUSES.has(p.status)) return false;
  if (CLOSURE_PENDING_STATUSES.has(p.status)) return false;
  if (!APPROVED_PERMIT_STATUSES.has(p.status)) return false;
  const fd = p.form_data || {};
  if (fd.work_extend_requested_until) return false;
  return true;
}

function permitStatusLabel(status?: string | null) {
  if (CLOSED_PERMIT_STATUSES.has(status || '')) return '종료 완료';
  if (CLOSURE_PENDING_STATUSES.has(status || '')) return '작업 완료 확인 대기';
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
  const [approvalNameRows, setApprovalNameRows] = useState<PermitApprovalNameRow[]>([]);
  const [involvedPermitIds, setInvolvedPermitIds] = useState<Set<string>>(new Set());
  const [listTab, setListTab] = useState<'all' | 'involved'>('all');
  const [listSearch, setListSearch] = useState('');
  const [listPeriod, setListPeriod] = useState<PermitListPeriod>('7d');
  const [listStatus, setListStatus] = useState<PermitListStatusFilter>('all');
  const [plans, setPlans] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [tbms, setTbms] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [workersDialog, setWorkersDialog] = useState<any | null>(null);
  const [approvalTarget, setApprovalTarget] = useState<any | null>(null);
  const [extendTarget, setExtendTarget] = useState<any | null>(null);
  const [extendUntil, setExtendUntil] = useState('');
  const [extending, setExtending] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companyNameById, setCompanyNameById] = useState<Map<string, string>>(new Map());
  const [previousPermits, setPreviousPermits] = useState<any[]>([]);
  const [loadingPrevious, setLoadingPrevious] = useState(false);

  const [form, setForm] = useState<any>(() => makeBlankForm());

  // Feature ACL: SM/PA may see drafts in their company-filtered query (applyCompanyFilter).
  // Do not treat isProjectAdmin as project-wide company visibility.
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
    const tabbed = listTab === 'involved'
      ? scoped.filter((p) => isUserInvolvedInPermit(p, visibilityOpts))
      : scoped;
    return filterPermitsForList(tabbed, {
      period: listPeriod,
      statusFilter: listStatus,
      search: listSearch,
      companyNameById,
    });
  }, [permits, visibilityOpts, listTab, listPeriod, listStatus, listSearch, companyNameById]);

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

    const [{ data: p }, { data: wp }, { data: ar }, { data: tb }, { data: myApprovals }, { data: nameApprovals }] = await Promise.all([
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
      supabase
        .from('approvals')
        .select('entity_id, position, status, approver_name, approved_at')
        .eq('project_id', projectId)
        .eq('entity_type', 'work_permit'),
    ]);
    const permitRows = (p as any[]) || [];
    setPermits(permitRows);
    setApprovalNameRows((nameApprovals as PermitApprovalNameRow[]) || []);
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

    // Resolve company names for list cards (contractor_company may be empty on older rows)
    const companyIds = Array.from(
      new Set(permitRows.map((row) => row.company_id).filter(Boolean)),
    ) as string[];
    if (companyIds.length === 0) {
      setCompanyNameById(new Map());
    } else {
      const nameMap = new Map<string, string>();
      for (let i = 0; i < companyIds.length; i += 100) {
        const chunk = companyIds.slice(i, i + 100);
        const { data: cos } = await supabase.from('companies').select('id, name').in('id', chunk);
        for (const c of (cos as any[]) || []) {
          if (c.id && c.name) nameMap.set(c.id, c.name);
        }
      }
      setCompanyNameById(nameMap);
    }
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

  const requestExtend = async () => {
    if (!extendTarget?.id || !extendUntil) {
      toast({ title: '연장 종료 시각을 선택하세요.', variant: 'destructive' });
      return;
    }
    const iso = toDbTimestamp(extendUntil);
    if (!iso) {
      toast({ title: '연장 시각 형식이 올바르지 않습니다.', variant: 'destructive' });
      return;
    }
    setExtending(true);
    try {
      const { data: res, error } = await supabase.rpc('request_work_permit_extension' as any, {
        _permit_id: extendTarget.id,
        _extend_until: iso,
      });
      const r = res as any;
      if (error || r?.error) {
        const code = r?.error || error?.message || '';
        const msg =
          code === 'MUST_BE_AFTER_CURRENT_END' ? '현재 종료 시각보다 이후여야 합니다.'
          : code === 'MUST_BE_FUTURE' ? '현재 시각보다 이후여야 합니다.'
          : code === 'PENDING_POST_APPROVAL' ? '이미 종료/연장 결재가 진행 중입니다.'
          : code === 'NO_SM' ? '발주처 SM을 찾을 수 없습니다.'
          : code === 'NOT_APPROVED' ? '승인된 허가서만 연장할 수 있습니다.'
          : String(code);
        toast({ title: '연장 신청 실패', description: msg, variant: 'destructive' });
        return;
      }
      toast({ title: '연장 신청 완료', description: '발주처 SM에게 결재 요청이 전달되었습니다.' });
      setExtendTarget(null);
      setExtendUntil('');
      load();
    } finally {
      setExtending(false);
    }
  };

  const submit = async (permit: any) => {
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
      rejection_reason: '',
    }).eq('id', permit.id);
    try {
      const { ensureTbmAfterPermitIssued } = await import('@/lib/tbmLifecycle');
      await ensureTbmAfterPermitIssued({
        force: true,
        entityType: 'work_permit',
        entityId: permit.id,
        projectId: permit.project_id || projectId,
        companyId: permit.company_id,
      });
    } catch (e) {
      console.warn('ensureTbmAfterPermitIssued', e);
    }
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

      <Card>
        <CardContent className="pt-4 flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="작업명·업체·장소 검색"
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
              />
            </div>
          </div>
          <Select value={listPeriod} onValueChange={(v) => setListPeriod(v as PermitListPeriod)}>
            <SelectTrigger className="w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">최근 7일</SelectItem>
              <SelectItem value="14d">최근 14일</SelectItem>
              <SelectItem value="month">이번 달</SelectItem>
              <SelectItem value="all">전체 기간</SelectItem>
            </SelectContent>
          </Select>
          <Select value={listStatus} onValueChange={(v) => setListStatus(v as PermitListStatusFilter)}>
            <SelectTrigger className="w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 상태</SelectItem>
              <SelectItem value="draft">작성중</SelectItem>
              <SelectItem value="in_approval">결재중</SelectItem>
              <SelectItem value="issued">발행</SelectItem>
              <SelectItem value="closure_pending">종료대기</SelectItem>
              <SelectItem value="closed">종료</SelectItem>
              <SelectItem value="rejected">반려</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {visiblePermits.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            {listTab === 'involved'
              ? '내가 작성·결재한 작업허가서가 없습니다.'
              : listPeriod !== 'all' || listSearch || listStatus !== 'all'
                ? '조건에 맞는 작업허가서가 없습니다. 기간을 「전체 기간」으로 바꿔 보세요.'
                : '등록된 작업허가서가 없습니다.'}
          </CardContent></Card>
        ) : visiblePermits.map((p) => {
          const workDate = resolvePermitWorkDate(p);
          const today = todayKst();
          const validity = shouldShowPermitValidityBadge(p.status) ? permitValidityKind(workDate, today) : null;
          const companyLabel = resolvePermitCompanyName(p, companyNameById);
          const submittedName = resolvePermitSubmittedByName(p, approvalNameRows);
          const approvedName = resolvePermitApprovedByName(p, approvalNameRows);
          const closureProg = CLOSURE_PENDING_STATUSES.has(p.status)
            ? closureListProgress(p.id, approvalNameRows)
            : null;
          return (
          <Card key={p.id}>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={STATUS_COLOR[p.status] || ''}>{permitStatusLabel(p.status)}</Badge>
                  <button className="font-semibold text-left hover:underline" onClick={() => navigate(`/work-permits/${p.id}`)}>{p.work_description}</button>
                  {CLOSURE_PENDING_STATUSES.has(p.status) && (
                    <Badge variant="outline" className="text-amber-700 border-amber-500/40">종료 결재 필요</Badge>
                  )}
                  {validity === 'expired' && !CLOSED_PERMIT_STATUSES.has(p.status) && (
                    <Badge variant="outline" className="text-destructive border-destructive/40">
                      만료 (작업일 경과)
                    </Badge>
                  )}
                  {validity === 'today' && <Badge variant="outline" className="text-success border-success/40">오늘 유효</Badge>}
                  {validity === 'scheduled' && workDate && <Badge variant="outline" className="text-muted-foreground">예정 ({workDate})</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {companyLabel ? (
                    <>
                      <span className="font-medium text-foreground/80">{companyLabel}</span>
                      {' · '}
                    </>
                  ) : null}
                  {workDate || '-'} · {p.location || '-'}
                  {' · '}
                  {normalizePermitKinds(p.permit_kinds, (p.permit_type || 'general') as PermitKindId)
                    .map((k) => PERMIT_KIND_LABEL[k])
                    .join(' · ')}
                </p>
                {shouldShowPermitRejectionReason(p.status, p.rejection_reason) && (
                  <p className="text-xs text-destructive mt-1">반려: {p.rejection_reason}</p>
                )}
                {p.form_data?.work_extend_requested_until && (
                  <p className="text-xs text-amber-700 mt-1 flex items-center gap-1"><Clock className="h-3 w-3" />연장 승인 대기</p>
                )}
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  {p.submitted_at && <div>📤 상신: {submittedName || '-'} · {new Date(p.submitted_at).toLocaleString('ko-KR')}</div>}
                  {p.reviewed_at && <div>🔍 검토: {p.reviewed_by_name || '-'} · {new Date(p.reviewed_at).toLocaleString('ko-KR')}{p.review_comment ? ` · ${p.review_comment}` : ''}</div>}
                  {p.approved_at && <div>✅ 발행 승인: {approvedName || '-'} · {new Date(p.approved_at).toLocaleString('ko-KR')}{p.approval_comment ? ` · ${p.approval_comment}` : ''}</div>}
                  {closureProg && (
                    <div className="text-amber-700">종료 결재: {closureProg.label}</div>
                  )}
                </div>
              </div>
              <div className="flex gap-1 flex-wrap">
                {canRequestPermitExtend(p) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setExtendTarget(p);
                      setExtendUntil('');
                    }}
                  >
                    <Clock className="h-3 w-3 mr-1" />연장 작업
                  </Button>
                )}
                {isPermitEditable(p.status) && (
                  <>
                    <Button size="sm" onClick={() => submit(p)}>상신</Button>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label>작업 시작</Label>
                <DateTimePicker
                  className="w-full"
                  value={form.work_start}
                  onChange={(work_start) => {
                    setForm({
                      ...form,
                      work_start,
                      permit_date: syncPermitDateFromWorkStart(work_start, form.permit_date),
                    });
                  }}
                  placeholder="시작 일시 선택"
                />
              </div>
              <div>
                <Label>작업 종료</Label>
                <DateTimePicker
                  className="w-full"
                  value={form.work_end}
                  onChange={(work_end) => setForm({ ...form, work_end })}
                  placeholder="종료 일시 선택"
                />
              </div>
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

      <Dialog
        open={!!extendTarget}
        onOpenChange={(v) => {
          if (!v) {
            setExtendTarget(null);
            setExtendUntil('');
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>연장 작업</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              연장 종료 시각을 고른 뒤 신청하면 발주처 SM에게 결재가 갑니다. 승인되면 양식에 시간이 찍힙니다.
            </p>
            <div>
              <Label>연장 종료 시각</Label>
              <DateTimePicker
                className="w-full mt-1"
                value={extendUntil}
                onChange={setExtendUntil}
                placeholder="연장 종료 일시 선택"
              />
            </div>
            <Button className="w-full" onClick={requestExtend} disabled={extending || !extendUntil}>
              {extending ? '신청 중…' : '발주처 SM에게 연장 결재 요청'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <WorkPermitWorkersDialog
        permit={workersDialog}
        projectId={projectId}
        open={!!workersDialog}
        onClose={() => setWorkersDialog(null)}
        onSaved={() => { void load(); }}
      />
      {approvalTarget && (
        <SubmitApprovalDialog
          open={!!approvalTarget}
          onOpenChange={(v) => !v && setApprovalTarget(null)}
          entityType="work_permit"
          entityId={approvalTarget.id}
          projectId={projectId}
          submitterCompanyId={approvalTarget.company_id || userCompanyId || null}
          permitBriefingContext={{
            permitKinds: normalizePermitKinds(approvalTarget.permit_kinds, approvalTarget.permit_type),
            formData: (approvalTarget.form_data || {}) as Record<string, unknown>,
            workName: approvalTarget.work_name,
            workDescription: approvalTarget.work_description,
            workLocation: approvalTarget.location || approvalTarget.form_data?.work_location,
            permitDate: resolvePermitWorkDate(approvalTarget) || approvalTarget.permit_date,
            contractorCompany: resolvePermitCompanyName(approvalTarget, companyNameById) || approvalTarget.contractor_company,
          }}
          onSubmitted={() => { setApprovalTarget(null); load(); }}
        />
      )}
    </div>
  );
}
