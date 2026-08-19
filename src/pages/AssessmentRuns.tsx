import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useAuditLog } from '@/hooks/useAuditLog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, ShieldAlert, Calendar, Filter, Search, ClipboardList, Upload, Building2 } from 'lucide-react';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { format } from 'date-fns';
import RunCardActions from '@/components/assessment-runs/RunCardActions';
import EditRunDialog from '@/components/assessment-runs/EditRunDialog';
import DeleteRunDialog from '@/components/assessment-runs/DeleteRunDialog';
import CloneRunDialog from '@/components/assessment-runs/CloneRunDialog';
import {
  fetchCreatorCompanyLabelMap,
  filterRunsByCompanyScope,
  pickProjectMemberRow,
  preferredCompanyIdsByRunAuthors,
  readPreferredCompanyId,
  resolveAssessmentRunListCompanyLabel,
  buildProjectCompanyLabelMap,
} from '@/lib/companyDocScope';
import {
  ASSESSMENT_RUN_TYPES,
  ASSESSMENT_RUN_TYPE_LABELS,
  buildAssessmentRunCreatePayload,
  emptyAssessmentRunCreateForm,
  periodLabelPlaceholder,
  type AssessmentRunCreateForm,
} from '@/lib/assessmentRunType';
import { canCreateAssessmentRun, defaultAuthorUserId } from '@/lib/assessmentAuthor';
import AssessmentAuthorPicker from '@/components/assessment-runs/AssessmentAuthorPicker';
import { pickPreviousApprovedRun, type WeeklyLinkRun } from '@/lib/weeklyAssessmentLink';

const statusConfig: Record<string, { bg: string; text: string }> = {
  '작성중': { bg: 'bg-muted', text: 'text-muted-foreground' },
  '제출됨': { bg: 'bg-primary/10', text: 'text-primary' },
  '검증중': { bg: 'bg-warning/10', text: 'text-warning' },
  '검증대기': { bg: 'bg-warning/10', text: 'text-warning' },
  '보완요청': { bg: 'bg-destructive/10', text: 'text-destructive' },
  '보완중': { bg: 'bg-warning/10', text: 'text-warning' },
  '검증완료': { bg: 'bg-accent/10', text: 'text-accent' },
  '결재진행': { bg: 'bg-primary/10', text: 'text-primary' },
  '승인완료': { bg: 'bg-success/10', text: 'text-success' },
  '반려': { bg: 'bg-destructive/10', text: 'text-destructive' },
  '폐기': { bg: 'bg-muted', text: 'text-muted-foreground' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] || { bg: 'bg-muted', text: 'text-muted-foreground' };
  return (
    <Badge variant="outline" className={`text-[10px] font-semibold border-0 ${cfg.bg} ${cfg.text}`}>
      {status}
    </Badge>
  );
}

function VerdictBadge({ verdict, score }: { verdict: string | null; score: number | null }) {
  if (!verdict) return null;
  const cfg = verdict === '적정'
    ? { bg: 'bg-success/10', text: 'text-success' }
    : verdict === '조건부 적정'
    ? { bg: 'bg-warning/10', text: 'text-warning' }
    : { bg: 'bg-destructive/10', text: 'text-destructive' };
  return (
    <Badge variant="outline" className={`text-[10px] font-medium border-0 ${cfg.bg} ${cfg.text}`}>
      검증: {verdict}{score != null ? ` (${score}점)` : ''}
    </Badge>
  );
}

const AssessmentRuns = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { log } = useAuditLog();
  const [projectRole, setProjectRole] = useState<string | null>(null);

  const { selectedProject, isMaster, accessibleCompanyIds, scopeStatus } = useGlobalProjectAccess();
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);

  // Companies for contractor selection
  const [contractors, setContractors] = useState<{ id: string; name: string; type: string }[]>([]);
  const [companyNameMap, setCompanyNameMap] = useState<Record<string, string>>({});
  /** created_by / author → 소속 업체 라벨 (대상 업체 없을 때 fallback) */
  const [creatorCompanyMap, setCreatorCompanyMap] = useState<Record<string, string>>({});

  const [form, setForm] = useState<AssessmentRunCreateForm>(() => emptyAssessmentRunCreateForm());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [runStats, setRunStats] = useState<Record<string, { total: number; high: number; med: number; low: number }>>({});

  const [editRun, setEditRun] = useState<any>(null);
  const [deleteRun, setDeleteRun] = useState<any>(null);
  const [cloneRun, setCloneRun] = useState<any>(null);


  const fetchSeqRef = useRef(0);

  // Fetch contractors for selected project (contractor + vendor types)
  const [allProjectCompanies, setAllProjectCompanies] = useState<{ id: string; name: string; type: string }[]>([]);
  const fetchContractors = async () => {
    if (!selectedProject) { setContractors([]); setAllProjectCompanies([]); return; }
    const { fetchProjectCompanies } = await import('@/lib/projectCompanies');
    const allData = await fetchProjectCompanies(selectedProject);
    setAllProjectCompanies(allData.map(c => ({ id: c.id, name: c.name, type: c.type || '' })));
    const filtered = allData.filter(c => c.type === 'contractor' || c.type === 'vendor');
    setContractors(filtered.map(c => ({ id: c.id, name: c.name, type: c.type || '' })));
    const map: Record<string, string> = {};
    allData.forEach(c => { map[c.id] = c.name; });
    setCompanyNameMap(prev => ({ ...prev, ...map }));
  };

  const fetchProjectRole = async () => {
    if (!user || !selectedProject) { setProjectRole(null); return; }
    if (isMaster) { setProjectRole('master'); return; }
    const { data } = await supabase
      .from('project_members')
      .select('role_new, company_id')
      .eq('project_id', selectedProject)
      .eq('user_id', user.id);
    const picked = pickProjectMemberRow((data || []) as any[], readPreferredCompanyId());
    setProjectRole((picked as any)?.role_new || null);
  };

  // 고시 §7: 작성 주체 = 관리감독자. SM/관리자는 보좌 초안만(작성 주체 지정 필수).
  const canCreateRun = canCreateAssessmentRun(projectRole, isMaster);

  const fetchRuns = async () => {
    if (!selectedProject || scopeStatus !== 'ready') return;
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    let query = supabase.from('assessment_runs')
      .select('*')
      .eq('project_id', selectedProject)
      .order('created_at', { ascending: false });
    if (showDeleted && isMaster) {
      query = query.eq('is_deleted', true);
    } else {
      query = query.eq('is_deleted', false).neq('status', '폐기');
    }
    const { data } = await query;
    if (seq !== fetchSeqRef.current) return;
    const list = filterRunsByCompanyScope(data || [], {
      userId: user?.id,
      accessibleCompanyIds,
    });
    setRuns(list);

    if (list.length > 0) {
      const runIds = list.map((r: any) => r.id);
      const creatorIds = list.flatMap((r: any) => [r.author_user_id, r.created_by]).filter(Boolean);
      const [{ data: items }, creatorMap] = await Promise.all([
        supabase.from('risk_items')
          .select('run_id, risk_grade')
          .in('run_id', runIds),
        fetchCreatorCompanyLabelMap(
          selectedProject,
          creatorIds,
          preferredCompanyIdsByRunAuthors(list),
        ).catch(() => ({})),
      ]);
      if (seq !== fetchSeqRef.current) return;
      setCreatorCompanyMap(creatorMap);
      const stats: Record<string, { total: number; high: number; med: number; low: number }> = {};
      (items || []).forEach((item: any) => {
        if (!item.run_id) return;
        if (!stats[item.run_id]) stats[item.run_id] = { total: 0, high: 0, med: 0, low: 0 };
        stats[item.run_id].total++;
        if (item.risk_grade === '상') stats[item.run_id].high++;
        else if (item.risk_grade === '중') stats[item.run_id].med++;
        else stats[item.run_id].low++;
      });
      setRunStats(stats);
    } else {
      setCreatorCompanyMap({});
    }
    if (seq !== fetchSeqRef.current) return;
    setLoading(false);
  };

  useEffect(() => {
    if (scopeStatus !== 'ready') {
      setLoading(true);
      return;
    }
    fetchProjectRole();
    fetchRuns();
    fetchContractors();
  }, [selectedProject, showDeleted, accessibleCompanyIds, scopeStatus]);

  const toggleContractor = (id: string) => {
    setForm(prev => ({
      ...prev,
      target_company_ids: prev.target_company_ids.includes(id)
        ? prev.target_company_ids.filter(c => c !== id)
        : [...prev.target_company_ids, id],
    }));
  };

  const handleCreate = async () => {
    if (!user || !selectedProject) return;

    const errors: Record<string, string> = {};
    if (!form.type) errors.type = '종류를 선택해주세요.';
    if (!form.author_user_id) errors.author_user_id = '작성 주체(관리감독자)를 선택해주세요.';
    if (!form.period_label.trim()) errors.period_label = '회차명을 입력해주세요.';
    if (form.period_label.trim().length > 100) errors.period_label = '회차명은 100자 이내로 입력해주세요.';
    if (form.start_date && form.end_date && form.start_date > form.end_date) errors.end_date = '종료일이 시작일보다 이전입니다.';
    if (form.notes.length > 2000) errors.notes = '비고는 2000자 이내로 입력해주세요.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setCreateError(null);
    setCreating(true);

    try {
      // Build contractor names for legacy field from selected company ids
      const contractorNames = form.target_company_ids.map(id => companyNameMap[id] || id);

      const payload = buildAssessmentRunCreatePayload({
        projectId: selectedProject,
        userId: user.id,
        form,
        contractorNames,
      });

      const { data, error } = await supabase.from('assessment_runs').insert([payload]).select().single();

      if (error) {
        const msg = error.code === '42501' || error.message?.includes('row-level security')
          ? '프로젝트 권한이 없습니다. 프로젝트에 초대가 필요합니다.'
          : error.message || '알 수 없는 오류가 발생했습니다.';
        setCreateError(msg);
        return;
      }

      const previous = pickPreviousApprovedRun(data as WeeklyLinkRun, (runs || []) as WeeklyLinkRun[]);
      toast({
        title: '회차가 생성되었습니다.',
        description: previous
          ? `전회차 「${previous.period_label || '승인 회차'}」의 금주 이행 확인이 연결됩니다.`
          : '첫 회차입니다. 금주 이행은 이 회차 승인 후 다음 회차에서 연결됩니다.',
      });
      setShowCreate(false);
      setForm(emptyAssessmentRunCreateForm(filterType, defaultAuthorUserId({ userId: user.id, role: projectRole })));
      setCreateError(null);
      fetchRuns();
      if (data) navigate(`/assessment-run/${data.id}`);
    } catch (e: any) {
      setCreateError(e?.message || '네트워크 오류가 발생했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (run: any) => {
    const { error } = await supabase
      .from('assessment_runs')
      .update({ is_deleted: false, deleted_at: null, deleted_reason: '', deleted_by: null })
      .eq('id', run.id);
    if (error) {
      toast({ title: '복구 실패', description: error.message, variant: 'destructive' });
      return;
    }
    await log('restore_run', 'assessment_run', run.id, run.project_id, { period_label: run.period_label });
    toast({ title: '회차가 복구되었습니다.' });
    fetchRuns();
  };

  const openCreate = () => {
    setForm(emptyAssessmentRunCreateForm(filterType, defaultAuthorUserId({ userId: user?.id, role: projectRole })));
    setCreateError(null);
    setFieldErrors({});
    setShowCreate(true);
  };

  const canEditRun = (run: any) => {
    if (isMaster) return true;
    if (run.created_by === user?.id) return true;
    if (
      projectRole === 'project_admin' ||
      projectRole === 'site_supervisor' ||
      projectRole === 'safety_manager'
    ) {
      return true;
    }
    return false;
  };

  const canDeleteRun = (run: any) => {
    if (isMaster) return true;
    if (run.created_by === user?.id) return true;
    return false;
  };

  const companyLabelById = buildProjectCompanyLabelMap(allProjectCompanies);
  const runCompanyLabel = (run: any) => resolveAssessmentRunListCompanyLabel(run, {
    companyLabelById,
    userCompanyLabelById: creatorCompanyMap,
  });

  const filtered = runs.filter(r => {
    if (showDeleted) { if (!r.is_deleted) return false; }
    else { if (r.is_deleted) return false; }
    if (filterType !== 'all' && r.type !== filterType) return false;
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (search) {
      const term = search.toLowerCase();
      const company = runCompanyLabel(r).toLowerCase();
      return (
        r.period_label?.toLowerCase().includes(term)
        || r.notes?.toLowerCase().includes(term)
        || company.includes(term)
      );
    }
    return true;
  });

  const getApprovalLabel = (run: any) => {
    if (run.status === '승인완료') return { label: '승인완료', className: 'bg-success/10 text-success' };
    if (run.status === '결재진행') return { label: '결재중', className: 'bg-primary/10 text-primary' };
    return { label: '미상신', className: 'bg-muted text-muted-foreground' };
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6" /> 위험성평가
          </h1>
          <p className="text-sm text-muted-foreground mt-1">평가 회차 목록 · 회차 단위로 작성/검증/결재</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/schedule-upload')}>
            <Upload className="h-3.5 w-3.5" /> 예정공종표 업로드
          </Button>
          {canCreateRun && (
            <Button size="sm" className="gap-1.5" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> 회차 생성
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">종류 전체</SelectItem>
                {ASSESSMENT_RUN_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">상태 전체</SelectItem>
                {Object.keys(statusConfig).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="기간, 작성사, 메모 검색..." className="h-8 pl-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {isMaster && (
              <div className="flex items-center gap-1.5">
                <Switch checked={showDeleted} onCheckedChange={setShowDeleted} id="show-deleted" />
                <label htmlFor="show-deleted" className="text-xs text-muted-foreground cursor-pointer">삭제됨</label>
              </div>
            )}
            <span className="text-xs text-muted-foreground font-medium">{filtered.length}건</span>
          </div>
        </CardContent>
      </Card>

      {/* Run List */}
      {loading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">로딩 중...</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mx-auto">
              <ClipboardList className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold">
                {showDeleted ? '삭제된 회차가 없습니다' : '평가 회차가 없습니다'}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {!showDeleted && "'회차 생성'을 눌러 평가를 시작하세요."}
              </p>
            </div>
            {!showDeleted && canCreateRun && (
              <Button size="sm" onClick={openCreate} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> 회차 생성
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(run => {
            const stats = runStats[run.id] || { total: 0, high: 0, med: 0, low: 0 };
            const approval = getApprovalLabel(run);
            const creatorCompany = runCompanyLabel(run);
            return (
              <Card
                key={run.id}
                className={`group hover:shadow-md transition-all cursor-pointer ${run.is_deleted ? 'opacity-60 border-dashed' : ''}`}
                onClick={() => !run.is_deleted && navigate(`/assessment-run/${run.id}`)}
              >
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px] font-medium">
                          {run.type}
                        </Badge>
                        <h3 className="font-semibold text-sm">
                          {run.period_label || '(기간 미지정)'}
                        </h3>
                        <StatusBadge status={run.status} />
                        {run.is_deleted && (
                          <Badge variant="destructive" className="text-[10px]">삭제됨</Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-xs flex-wrap">
                        <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                        {creatorCompany ? (
                          <span className="font-medium text-foreground" title="작성 회사">
                            {creatorCompany}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">작성사 미확인</span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {run.start_date && run.end_date ? `${run.start_date} ~ ${run.end_date}` : format(new Date(run.created_at), 'yyyy-MM-dd')}
                        </span>
                        <span className="font-medium">항목 {stats.total}건</span>
                        {stats.total > 0 && (
                          <span className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-0.5">
                              <span className="h-2 w-2 rounded-full bg-destructive" />
                              <span className="text-destructive font-semibold">{stats.high}</span>
                            </span>
                            <span className="inline-flex items-center gap-0.5">
                              <span className="h-2 w-2 rounded-full bg-warning" />
                              <span className="text-warning font-semibold">{stats.med}</span>
                            </span>
                            <span className="inline-flex items-center gap-0.5">
                              <span className="h-2 w-2 rounded-full bg-success" />
                              <span className="text-success font-semibold">{stats.low}</span>
                            </span>
                          </span>
                        )}
                        <VerdictBadge verdict={run.validation_verdict} score={run.validation_score} />
                        <Badge variant="outline" className={`text-[10px] font-medium border-0 ${approval.className}`}>
                          {approval.label}
                        </Badge>
                      </div>

                      {run.notes && <p className="text-xs text-muted-foreground truncate max-w-lg">{run.notes}</p>}
                      {run.is_deleted && run.deleted_reason && (
                        <p className="text-xs text-destructive">삭제 사유: {run.deleted_reason}</p>
                      )}
                    </div>

                    <RunCardActions
                      run={run}
                      canEdit={!run.is_deleted && canEditRun(run)}
                      canDelete={!run.is_deleted && canDeleteRun(run)}
                      canRestore={run.is_deleted && isMaster}
                      onEdit={() => setEditRun(run)}
                      onDelete={() => setDeleteRun(run)}
                      onClone={() => setCloneRun(run)}
                      onRestore={() => handleRestore(run)}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) { setCreateError(null); setFieldErrors({}); } }}>
        <DialogContent className="max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>평가 회차 생성</DialogTitle></DialogHeader>
          {createError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {createError}
            </div>
          )}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">종류 *</Label>
              <div className="grid grid-cols-4 gap-1.5">
                {ASSESSMENT_RUN_TYPES.map((t) => {
                  const selected = form.type === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, type: t }))}
                      className={`rounded-md border px-1.5 py-2 text-xs font-medium transition-colors ${
                        selected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      {ASSESSMENT_RUN_TYPE_LABELS[t]}
                    </button>
                  );
                })}
              </div>
              {fieldErrors.type && <p className="text-xs text-destructive">{fieldErrors.type}</p>}
            </div>
            <AssessmentAuthorPicker
              projectId={selectedProject}
              value={form.author_user_id}
              onChange={(id) => setForm((p) => ({ ...p, author_user_id: id }))}
              required
              error={fieldErrors.author_user_id}
            />
            {projectRole === 'safety_manager' && (
              <p className="text-[10px] text-muted-foreground">
                안전관리자는 보좌 입력만 가능합니다. 작성 주체와 상신은 관리감독자입니다.
              </p>
            )}
            <div className="space-y-1">
              <Label className="text-xs">회차명 *</Label>
              <Input className="h-9" value={form.period_label} onChange={e => setForm(p => ({ ...p, period_label: e.target.value }))} placeholder={periodLabelPlaceholder(form.type)} />
              {fieldErrors.period_label && <p className="text-xs text-destructive">{fieldErrors.period_label}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">시작일</Label>
                <Input type="date" className="h-9" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} />
                {fieldErrors.start_date && <p className="text-xs text-destructive">{fieldErrors.start_date}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">종료일</Label>
                <Input type="date" className="h-9" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} />
                {fieldErrors.end_date && <p className="text-xs text-destructive">{fieldErrors.end_date}</p>}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">날짜는 비워 두어도 생성됩니다.</p>
            <details className="text-xs space-y-2">
              <summary className="cursor-pointer text-muted-foreground">대상 공정 (선택)</summary>
              <div className="pt-2">
                <Input className="h-9" value={form.target_processes} onChange={e => setForm(p => ({ ...p, target_processes: e.target.value }))} placeholder="배관, 철골, 용접" />
              </div>
            </details>
            <div className="space-y-1">
              <Label className="text-xs">대상 협력사 (등록 업체에서 선택)</Label>
              {contractors.length > 0 ? (
                <div className="border rounded-md p-2 max-h-32 overflow-y-auto space-y-1">
                  {contractors.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 p-1 rounded">
                      <Checkbox
                        checked={form.target_company_ids.includes(c.id)}
                        onCheckedChange={() => toggleContractor(c.id)}
                      />
                      {c.name}
                      <Badge variant="outline" className="text-[9px] ml-auto">{c.type === 'vendor' ? '공급사' : '협력사'}</Badge>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-2 space-y-1">
                  {allProjectCompanies.length === 0 ? (
                    <p>등록된 업체가 없습니다. 프로젝트 설정 &gt; 업체관리에서 먼저 등록하세요.</p>
                  ) : allProjectCompanies.every(c => c.type === 'gc' || c.type === 'client') ? (
                    <p>협력사(구분=협력사/공급사)로 등록된 업체가 없습니다. 업체관리에서 구분을 확인하세요.</p>
                  ) : (
                    <p>조건에 맞는 협력사가 없습니다. 업체관리에서 업체 상태를 확인하세요.</p>
                  )}
                </div>
              )}
              {form.target_company_ids.length > 0 && (
                <p className="text-[10px] text-muted-foreground">{form.target_company_ids.length}개 선택됨</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">비고</Label>
              <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="특이사항, 메모..." rows={2} />
              {fieldErrors.notes && <p className="text-xs text-destructive">{fieldErrors.notes}</p>}
            </div>
            <Button onClick={handleCreate} disabled={creating || !form.period_label.trim() || !form.author_user_id} className="w-full">
              {creating ? '생성 중...' : '회차 생성'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <EditRunDialog open={!!editRun} onOpenChange={(open) => !open && setEditRun(null)} run={editRun} onSaved={fetchRuns} />
      <DeleteRunDialog
        open={!!deleteRun}
        onOpenChange={(open) => {
          if (!open) setDeleteRun(null);
        }}
        run={deleteRun}
        onDeleted={() => {
          fetchRuns();
        }}
      />
      <CloneRunDialog open={!!cloneRun} onOpenChange={(open) => !open && setCloneRun(null)} run={cloneRun} onCloned={fetchRuns} />
    </div>
  );
};

export default AssessmentRuns;
