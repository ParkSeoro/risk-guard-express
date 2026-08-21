import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/useAuditLog";
import { sendNotification } from "@/lib/notificationService";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Clock, XCircle, FileCheck, MessageSquare, FileText, ExternalLink, Search, Inbox, Send, AlertTriangle } from "lucide-react";
import { exportToPDFServer } from "@/lib/exportUtils";
import { useMemo } from "react";
import {
  APPROVAL_ENTITY_FILTER_OPTIONS,
  approvalTimelineGroupKey,
  entityTypeLabel,
  isSubmitterApprovalStep,
  sequentialDisplayStatus,
  type ApprovalEntityType,
} from "@/lib/approvalRules";
import { filterRunsByCompanyScope } from "@/lib/companyDocScope";
import { filterApprovalsKeepingFullDocumentTimeline } from "@/lib/approvalDocumentVisibility";
import {
  permitPostStepKind,
  permitPostStepBadge,
  permitPostStepApproveLabel,
  isPostApprovalStep,
  splitApprovalTimeline,
  currentTimelineSteps,
} from "@/lib/permitPostApproval";


const ENTITY_LINK = (t?: string | null, id?: string | null): string | null => {
  if (!t || !id) return null;
  switch (t) {
    case 'assessment_run': return `/assessment-run/${id}`;
    case 'assessment_run_feedback': return `/assessment-run/${id}?tab=feedback`;
    case 'work_plan': return `/work-plan/${id}`;
    case 'work_permit': return `/work-permits/${id}`;
    case 'safety_cost': return `/safety-cost`;
    case 'incident': return `/incidents`;
    case 'emergency_drill': return `/emergency-drills`;
    case 'tbm': return `/app/admin/tbm-logs`;
    default: return null;
  }
};

function resolveLinkedRun(
  runs: any[],
  groupKey: string,
  steps: any[],
): any | null {
  if (groupKey.startsWith('run:')) {
    return runs.find((r) => r.id === groupKey.slice(4)) || null;
  }
  const first = steps[0];
  if (
    first?.entity_id &&
    (first.entity_type === 'assessment_run' || first.entity_type === 'assessment_run_feedback')
  ) {
    return runs.find((r) => r.id === first.entity_id) || null;
  }
  return null;
}

function documentCardTitle(run: any | null, steps: any[]): string {
  if (run) {
    return `[${entityTypeLabel('assessment_run')}] ${run.period_label || run.type || ''}`.trim();
  }
  const first = steps[0];
  const typeLabel = entityTypeLabel(first?.entity_type);
  // Prefer RPC-enriched title when present on a step row (some views denormalize it)
  const title = first?.entity_title || first?.title || '';
  return title ? `${typeLabel} · ${title}` : typeLabel;
}

const Approvals = () => {
  const navigate = useNavigate();
  const { user, profile, isAdmin, hasRole } = useAuth();
  const {
    projects,
    selectedProject,
    setSelectedProject,
    isMaster,
    isProjectAdmin,
    seesAllCompanies,
    userCompanyId,
    userCompanyType,
    userRole,
    accessibleCompanyIds,
    scopeStatus,
  } = useGlobalProjectAccess();
  const { toast } = useToast();
  const { log } = useAuditLog();
  const [approvals, setApprovals] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [rejectComment, setRejectComment] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [tab, setTab] = useState('mine');
  const [entityPending, setEntityPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchSeqRef = useRef(0);
  const [search, setSearch] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState<'all' | ApprovalEntityType>('all');

  const fetchEntityPending = async () => {
    try { await (supabase as any).rpc('repair_stuck_permit_closure_sm'); } catch { /* ignore */ }
    try { await (supabase as any).rpc('promote_permits_to_closure_pending'); } catch { /* ignore */ }
    const { data } = await supabase.rpc('get_my_pending_entity_approvals');
    setEntityPending((data as any[]) || []);
  };

  const runEntityApproval = async (
    id: string,
    action: 'approve' | 'reject',
    stepKind: ReturnType<typeof permitPostStepKind> = 'normal',
    comment = '',
    stepMeta?: { entity_type?: string; entity_id?: string; project_id?: string } | null,
  ) => {
    const { data, error } = await supabase.rpc('act_on_entity_approval', {
      _approval_id: id,
      _action: action,
      _comment: comment,
    });
    const r = data as any;
    if (error || r?.error) {
      const code = r?.error || error?.message || '';
      const msg = code === 'SUBMITTER_STEP_NO_SELF_APPROVE'
        ? '상신(기안) 단계는 승인/반려할 수 없습니다.'
        : code === 'WORK_PERMIT_LOCKED' || String(code).includes('WORK_PERMIT_LOCKED')
          ? '문서 잠금 충돌이 발생했습니다. 페이지를 새로고침 후 다시 시도하세요.'
        : code === 'ACCOUNT_INACTIVE'
          ? '로그인 차단된 계정은 결재할 수 없습니다.'
          : (r?.error || error?.message);
      toast({ title: '처리 실패', description: msg, variant: 'destructive' });
      return false;
    }
    const title =
      stepKind === 'closure_sm'
        ? (action === 'approve' ? '작업 완료 및 종료 처리됨' : '종료 확인 반려')
        : stepKind === 'closure_supervisor'
          ? (action === 'approve' ? '관리감독자 완료 확인됨 → 발주처 SM 대기' : '완료 확인 반려')
          : stepKind === 'extend_sm'
            ? (action === 'approve' ? '연장 승인 완료' : '연장 요청 반려')
            : (action === 'approve' ? '승인 완료' : '반려 완료');
    toast({ title });
    // 발행 최종 승인 시 TBM 일지 자동 생성·연결
    if (action === 'approve' && stepKind === 'normal') {
      try {
        const { ensureTbmAfterPermitIssued } = await import('@/lib/tbmLifecycle');
        await ensureTbmAfterPermitIssued({
          rpcResult: r,
          entityType: stepMeta?.entity_type,
          entityId: stepMeta?.entity_id,
          projectId: stepMeta?.project_id || selectedProject,
        });
      } catch (e) {
        console.warn('ensureTbmAfterPermitIssued', e);
      }
    }
    fetchEntityPending();
    fetchData();
    return true;
  };

  const actOnEntity = async (id: string, action: 'approve'|'reject', stepKind: ReturnType<typeof permitPostStepKind> = 'normal', stepMeta?: any) => {
    if (stepMeta && isSubmitterApprovalStep(stepMeta)) {
      toast({
        title: '상신 단계는 승인/반려할 수 없습니다.',
        description: '기안 상신은 제출 시 자동 완료됩니다.',
        variant: 'destructive',
      });
      return;
    }
    const comment = action === 'reject' ? (prompt('반려 사유') || '') : '';
    if (action === 'reject' && !comment) return;

    await runEntityApproval(id, action, stepKind, comment, stepMeta);
  };

  const handleWithdraw = async (steps: any[]) => {
    const first = steps?.[0];
    if (!first?.entity_type || !first?.entity_id) {
      toast({ title: '회수 불가', description: '이 결재는 회수를 지원하지 않습니다.', variant: 'destructive' });
      return;
    }
    // 상신 자동승인만 있는 경우는 회수 허용 — 실결재(비-상신 승인/반려)가 있으면 차단
    if (steps.some((s: any) =>
      (s.status === '승인' && !isSubmitterApprovalStep(s)) || s.status === '반려'
    )) {
      toast({ title: '회수 불가', description: '이미 처리된 결재 단계가 있어 회수할 수 없습니다.', variant: 'destructive' });
      return;
    }
    if (!confirm('정말 이 결재를 회수하시겠습니까? 문서가 작성중 상태로 돌아갑니다.')) return;
    const reason = prompt('회수 사유 (선택)') ?? '';
    const { data, error } = await supabase.rpc('withdraw_approval', {
      _entity_type: first.entity_type, _entity_id: first.entity_id, _reason: reason,
    });
    const r: any = data;
    if (error || r?.error) {
      const code = r?.error || error?.message || '';
      const msg = code === 'ALREADY_REJECTED' ? '이미 반려된 결재입니다. 문서를 수정한 뒤 재상신하세요.'
        : code === 'ALREADY_DECIDED' ? '이미 승인/반려된 단계가 있어 회수할 수 없습니다.'
        : code === 'NOT_SUBMITTER' ? '상신자 본인만 회수할 수 있습니다.'
        : code === 'NO_APPROVAL' ? '결재 정보를 찾을 수 없습니다.'
        : code;
      toast({ title: '회수 실패', description: msg, variant: 'destructive' });
      fetchData(); fetchEntityPending();
      return;
    }
    toast({ title: '결재 회수 완료', description: '문서가 작성중 상태로 되돌아갔습니다.' });
    fetchData(); fetchEntityPending();
  };

  const fetchData = async () => {
    if (!selectedProject || scopeStatus !== 'ready') return;
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      const [a, r] = await Promise.all([
        supabase.from('approvals').select('*').eq('project_id', selectedProject).order('created_at', { ascending: false }),
        supabase.from('assessment_runs').select('*').eq('project_id', selectedProject).eq('is_deleted', false).neq('status', '폐기'),
      ]);
      if (seq !== fetchSeqRef.current) return;
      let approvalsData = a.data || [];
      let runsData = r.data || [];

      // 시공사/협력사: 문서 단위로 스코프 — 보이는 문서의 결재 단계는 전부 유지(반려 사유 포함)
      if (accessibleCompanyIds !== null) {
        approvalsData = filterApprovalsKeepingFullDocumentTimeline(approvalsData, {
          userId: user?.id,
          accessibleCompanyIds,
        });
        runsData = filterRunsByCompanyScope(runsData, {
          userId: user?.id,
          accessibleCompanyIds,
        });
      }

      setApprovals(approvalsData);
      setRuns(runsData);
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (scopeStatus !== 'ready') {
      setLoading(true);
      return;
    }
    fetchData();
    fetchEntityPending();
  }, [selectedProject, userCompanyId, accessibleCompanyIds, scopeStatus]);

  // Realtime: approvals 변경 시 즉시 갱신
  useEffect(() => {
    if (!selectedProject) return;
    const ch = supabase
      .channel(`approvals-${selectedProject}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'approvals', filter: `project_id=eq.${selectedProject}` },
        () => { fetchData(); fetchEntityPending(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selectedProject]);

  const filteredEntityPending = useMemo(() => {
    return entityPending.filter((e: any) => {
      // 상신(기안) 단계는 승인/반려 대기 목록에 노출하지 않음
      if (isSubmitterApprovalStep(e)) return false;
      if (entityTypeFilter !== 'all' && e.entity_type !== entityTypeFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const typeLabel = entityTypeLabel(e.entity_type).toLowerCase();
      return (
        (e.entity_title || '').toLowerCase().includes(q)
        || (e.step || '').toLowerCase().includes(q)
        || typeLabel.includes(q)
        || (e.entity_type || '').toLowerCase().includes(q)
      );
    });
  }, [entityPending, entityTypeFilter, search]);


  // Group by entity. Non-permit: latest version only.
  // work_permit: keep all versions so issuance vs post-approval (closure/extend) can be split.
  const grouped = (() => {
    const maxVersionByKey: Record<string, number> = {};
    for (const ap of approvals) {
      const key = approvalTimelineGroupKey(ap);
      const ver = ap.approval_version || 1;
      if (!maxVersionByKey[key] || ver > maxVersionByKey[key]) maxVersionByKey[key] = ver;
    }
    return approvals.reduce((acc, ap) => {
      const key = approvalTimelineGroupKey(ap);
      const ver = ap.approval_version || 1;
      const isPermit = (ap.entity_type || '').toString() === 'work_permit' || key.startsWith('work_permit:');
      if (isPermit || ver === maxVersionByKey[key]) {
        if (!acc[key]) acc[key] = [];
        acc[key].push(ap);
      }
      return acc;
    }, {} as Record<string, any[]>);
  })();

  const applySearch = (group: Record<string, any[]>) => {
    const q = search.trim().toLowerCase();
    if (!q) return group;
    const out: Record<string, any[]> = {};
    for (const [groupKey, steps] of Object.entries(group)) {
      const run = resolveLinkedRun(runs, groupKey, steps as any[]);
      const typeLabel = entityTypeLabel((steps as any[])[0]?.entity_type || (run ? 'assessment_run' : null));
      const text = [
        typeLabel,
        run?.type, run?.period_label,
        ...(steps as any[]).map(s => `${s.step} ${s.approver_name || ''} ${s.company_name || ''} ${s.comment || ''} ${s.entity_type || ''} ${entityTypeLabel(s.entity_type)}`),
      ].join(' ').toLowerCase();
      if (text.includes(q)) out[groupKey] = steps;
    }
    return out;
  };

  const matchesEntityTypeFilter = (groupKey: string, steps: any[]) => {
    if (entityTypeFilter === 'all') return true;
    const t = steps[0]?.entity_type;
    if (t) return t === entityTypeFilter;
    // Legacy run:* groups without entity_type → 위험성평가
    if (entityTypeFilter === 'assessment_run') {
      return groupKey.startsWith('run:') || steps.some((s) => !!s.run_id);
    }
    return false;
  };

  // Filter tabs
  const getFilteredGrouped = () => {
    if (tab === 'mine' && user) {
      const filtered: Record<string, any[]> = {};
      for (const [runId, steps] of Object.entries(grouped)) {
        const current = currentTimelineSteps(steps as any[]);
        const myActive = current.filter(s => s.approver_id === user.id && s.status === '진행중');
        if (myActive.length > 0 && matchesEntityTypeFilter(runId, steps as any[])) filtered[runId] = steps as any[];
      }
      return applySearch(filtered);
    }
    if (tab === 'submitted' && user) {
      const filtered: Record<string, any[]> = {};
      for (const [runId, steps] of Object.entries(grouped)) {
        const { issuanceSteps } = splitApprovalTimeline(steps as any[]);
        const submitted = issuanceSteps.some(s =>
          s.approver_id === user.id && isSubmitterApprovalStep(s)
        );
        if (submitted && matchesEntityTypeFilter(runId, steps as any[])) filtered[runId] = steps as any[];
      }
      return applySearch(filtered);
    }
    if (tab === 'completed') {
      const filtered: Record<string, any[]> = {};
      for (const [runId, steps] of Object.entries(grouped)) {
        const current = currentTimelineSteps(steps as any[]);
        const allDecided = current.length > 0
          && current.every(s => s.status === '승인' || s.status === '반려');
        if (allDecided && matchesEntityTypeFilter(runId, steps as any[])) filtered[runId] = steps as any[];
      }
      return applySearch(filtered);
    }
    if (tab === 'rejected') {
      const filtered: Record<string, any[]> = {};
      for (const [runId, steps] of Object.entries(grouped)) {
        const { issuanceSteps, postSteps, priorIssuanceSteps } = splitApprovalTimeline(steps as any[]);
        const hasReject = [...issuanceSteps, ...postSteps, ...priorIssuanceSteps].some(s => s.status === '반려');
        if (hasReject && matchesEntityTypeFilter(runId, steps as any[])) {
          filtered[runId] = steps as any[];
        }
      }
      return applySearch(filtered);
    }
    // 'all' tab — read-only overview (admin only)
    if (entityTypeFilter === 'all') return applySearch(grouped);
    const filtered: Record<string, any[]> = {};
    for (const [runId, steps] of Object.entries(grouped)) {
      if (matchesEntityTypeFilter(runId, steps as any[])) filtered[runId] = steps as any[];
    }
    return applySearch(filtered);

  };

  const filteredGrouped = getFilteredGrouped();

  const handleApprovalAction = async (approvalId: string, action: '승인' | '반려', comment?: string) => {
    if (!user || !profile) return;
    const ap = approvals.find(a => a.id === approvalId);
    if (!ap) { toast({ title: '결재 정보를 찾을 수 없습니다.', variant: 'destructive' }); return; }
    if (ap.approver_id !== user.id) {
      toast({ title: '결재 권한이 없습니다.', description: '해당 단계의 지정된 결재자만 승인/반려할 수 있습니다.', variant: 'destructive' });
      return;
    }
    if (ap.status !== '진행중') {
      toast({ title: '아직 결재 순번이 아닙니다.', description: '앞 단계가 먼저 승인되어야 결재할 수 있습니다.', variant: 'destructive' });
      return;
    }
    if (isSubmitterApprovalStep(ap)) {
      toast({
        title: '상신 단계는 승인/반려할 수 없습니다.',
        description: '기안 상신은 제출 시 자동 완료됩니다. 다음 결재자의 차례를 기다리세요.',
        variant: 'destructive',
      });
      return;
    }
    if (action === '반려' && !(comment || '').trim()) {
      toast({ title: '반려 사유를 입력하세요.', variant: 'destructive' }); return;
    }

    // 순차 결재/다음 단계 자동 활성화/서명 스탬프는 DB RPC(SSOT)만 수행 — 원본 문서 전체 UPDATE 금지
    const { data, error } = await supabase.rpc('act_on_entity_approval', {
      _approval_id: approvalId,
      _action: action === '승인' ? 'approve' : 'reject',
      _comment: comment || '',
    });
    const res: any = data;
    if (error || res?.error) {
      const code = res?.error || error?.message || '';
      const msg = code === 'PRIOR_STEP_NOT_APPROVED' ? '이전 단계 결재가 완료되지 않았습니다.'
        : code === 'NOT_ACTIVE_STEP' ? '아직 결재 순번이 아닙니다.'
        : code === 'NOT_AUTHORIZED' ? '결재 권한이 없습니다.'
        : code === 'SUBMITTER_STEP_NO_SELF_APPROVE' ? '상신(기안) 단계는 승인/반려할 수 없습니다.'
        : code;
      toast({ title: '처리 실패', description: msg, variant: 'destructive' });
      return;
    }
    toast({
      title: action === '승인'
        ? (res?.action === 'forwarded' ? `${ap.step} 승인 완료 → 다음 단계로 이관` : '최종 승인 완료')
        : '반려되었습니다.',
      variant: action === '반려' ? 'destructive' : undefined,
    });

    log(action, 'approval', approvalId, selectedProject);
    setRejectingId(null);
    setRejectComment('');
    fetchData();
    fetchEntityPending();
  };

  const handleDownloadRunPDF = async (runId: string) => {
    // Must open the window in the click gesture — then fill with generate-pdf HTML
    // (jsPDF fallback has no Korean font and no approval signature table).
    const printWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!printWindow) {
      toast({
        title: '팝업이 차단되었습니다',
        description: '주소창의 팝업 아이콘에서 허용 후 다시 시도해 주세요.',
        variant: 'destructive',
      });
      return;
    }
    toast({ title: '인쇄용 문서 생성 중...' });
    try {
      await exportToPDFServer(runId, 'assessment', 'print', printWindow);
    } catch (err) {
      toast({ title: 'PDF 생성 실패', description: String(err), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileCheck className="h-6 w-6" /> 전자결재</h1>
          <p className="text-sm text-muted-foreground mt-1">
            위험성평가·작업계획서·작업허가서 등 공통 순차 결재: 담당자(시공) → 담당자(안전) → 책임자(소장) → 담당자(CM) → 담당자(SM)
          </p>
        </div>
        <Select value={selectedProject} onValueChange={setSelectedProject}>
          <SelectTrigger className="w-60 text-xs"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
          <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {/* KPI 카드 (중복 제거: entityPending 은 approvals 테이블에 이미 존재하므로 approval_id 기준 dedupe) */}
      {(() => {
        const pendingIds = new Set(entityPending.map((e: any) => e.approval_id));
        const mineCount = user ? Object.values(grouped).filter((steps: any) =>
          currentTimelineSteps(steps as any[]).some(s => s.approver_id === user.id && s.status === '진행중' && !pendingIds.has(s.id))
        ).length + entityPending.length : 0;
        const submittedCount = user ? Object.values(grouped).filter((steps: any) =>
          splitApprovalTimeline(steps as any[]).issuanceSteps.some(s => s.approver_id === user.id && isSubmitterApprovalStep(s))
        ).length : 0;
        const completedCount = Object.values(grouped).filter((steps: any) => {
          const current = currentTimelineSteps(steps as any[]);
          return current.length > 0 && current.every(s => s.status === '승인' || s.status === '반려');
        }).length;
        const rejectedCount = Object.values(grouped).filter((steps: any) =>
          currentTimelineSteps(steps as any[]).some(s => s.status === '반려')
        ).length;
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="pt-4 flex items-center justify-between">
              <div><div className="text-xs text-muted-foreground">내 대기</div><div className="text-2xl font-bold text-destructive">{mineCount}</div></div>
              <Inbox className="h-6 w-6 text-destructive" />
            </CardContent></Card>
            <Card><CardContent className="pt-4 flex items-center justify-between">
              <div><div className="text-xs text-muted-foreground">상신</div><div className="text-2xl font-bold">{submittedCount}</div></div>
              <Send className="h-6 w-6 text-primary" />
            </CardContent></Card>
            <Card><CardContent className="pt-4 flex items-center justify-between">
              <div><div className="text-xs text-muted-foreground">완료</div><div className="text-2xl font-bold text-success">{completedCount}</div></div>
              <CheckCircle2 className="h-6 w-6 text-success" />
            </CardContent></Card>
            <Card><CardContent className="pt-4 flex items-center justify-between">
              <div><div className="text-xs text-muted-foreground">반려</div><div className="text-2xl font-bold text-destructive">{rejectedCount}</div></div>
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </CardContent></Card>
          </div>
        );
      })()}

      <Card>
        <CardContent className="pt-4 flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="제목·결재자·코멘트 검색" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <Select value={entityTypeFilter} onValueChange={(v) => setEntityTypeFilter(v as 'all' | ApprovalEntityType)}>
            <SelectTrigger className="w-52 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 유형</SelectItem>
              {APPROVAL_ENTITY_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {filteredEntityPending.length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 space-y-2">
            <div className="text-sm font-bold flex items-center gap-2">
              <FileCheck className="h-4 w-4" /> 결재 대기 ({filteredEntityPending.length}/{entityPending.length})
            </div>
            {filteredEntityPending.map((e: any) => {
              const stepKind = permitPostStepKind(e.step_position);
              const badge = permitPostStepBadge(stepKind);
              return (
              <div key={e.approval_id} className="flex items-center gap-2 p-2 border rounded bg-background flex-wrap">
                <Badge variant="outline" className="text-[10px]">
                  {entityTypeLabel(e.entity_type)}
                </Badge>
                {badge && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700">
                    {badge}
                  </Badge>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{e.entity_title || '-'}</div>
                  <div className="text-xs text-muted-foreground">{e.entity_date || ''} · {e.step}</div>
                </div>
                {(() => {
                  const href = ENTITY_LINK(e.entity_type, e.entity_id);
                  return href ? (
                    <Button size="sm" variant="outline" onClick={() => navigate(href)}>
                      <ExternalLink className="h-3 w-3 mr-1" />문서 보기
                    </Button>
                  ) : null;
                })()}
                <Button size="sm" onClick={() => actOnEntity(e.approval_id, 'approve', stepKind, e)}>
                  <CheckCircle2 className="h-3 w-3 mr-1" />{permitPostStepApproveLabel(stepKind)}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => actOnEntity(e.approval_id, 'reject', stepKind, e)}>
                  <XCircle className="h-3 w-3 mr-1" />반려
                </Button>
              </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full flex-wrap h-auto">
          <TabsTrigger value="mine" className="flex-1 gap-1.5">
            내 결재 (대기)
            {(() => {
              const pendingIds = new Set(entityPending.map((e: any) => e.approval_id));
              const mineCount = user ? Object.values(grouped).filter((steps: any) =>
                currentTimelineSteps(steps as any[]).some(s => s.approver_id === user.id && s.status === '진행중' && !pendingIds.has(s.id))
              ).length + entityPending.length : 0;
              return mineCount > 0 ? <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">{mineCount}</Badge> : null;
            })()}
          </TabsTrigger>
          <TabsTrigger value="submitted" className="flex-1">상신한 결재</TabsTrigger>
          <TabsTrigger value="completed" className="flex-1">완료</TabsTrigger>
          <TabsTrigger value="rejected" className="flex-1">반려</TabsTrigger>
          {isAdmin && <TabsTrigger value="all" className="flex-1">전체 현황</TabsTrigger>}
        </TabsList>


        <TabsContent value={tab} className="space-y-3 mt-3">
          {loading ? (
            <div className="space-y-2">
              {[0,1,2].map(i => <div key={i} className="h-20 rounded bg-muted animate-pulse" />)}
            </div>
          ) : Object.keys(filteredGrouped).length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground space-y-2">
              <FileCheck className="h-10 w-10 mx-auto opacity-30" />
              <div>{tab === 'mine' ? '대기 중인 결재가 없습니다.' : tab === 'submitted' ? '상신한 결재가 없습니다.' : '결재 내역이 없습니다.'}</div>
              {tab === 'mine' && (
                <div className="text-xs">
                  위험성평가·작업계획서·작업허가서 등 상신 문서가 유형별로 표시됩니다.
                </div>
              )}
            </CardContent></Card>
          ) : (
            Object.entries(filteredGrouped).map(([groupKey, steps]) => {
              const isAllTab = tab === 'all';
              const allSteps = steps as any[];
              const isPermit = allSteps.some((s) => s.entity_type === 'work_permit')
                || groupKey.startsWith('work_permit:');
              const timeline = isPermit
                ? splitApprovalTimeline(allSteps)
                : {
                    issuanceSteps: allSteps
                      .filter((s) => s.status !== '취소')
                      .slice()
                      .sort((a, b) => (a.step_order ?? 99) - (b.step_order ?? 99)),
                    postSteps: [] as any[],
                    priorIssuanceSteps: [] as any[],
                    maxIssuanceVersion: 0,
                    maxPostVersion: 0,
                  };
              const activeSteps = [...timeline.issuanceSteps, ...timeline.postSteps];
              const run = resolveLinkedRun(runs, groupKey, activeSteps.length ? activeSteps : allSteps);
              const cardTitle = documentCardTitle(run, activeSteps.length ? activeSteps : allSteps);
              const firstStep = (activeSteps[0] || allSteps[0]) as any;
              const docHref = run
                ? `/assessment-run/${run.id}`
                : ENTITY_LINK(firstStep?.entity_type, firstStep?.entity_id);

              const renderStepChip = (step: any, sectionSteps: any[], i: number, sectionLen: number) => {
                const displayStatus = sequentialDisplayStatus(sectionSteps, step);
                const isSubmitterStep = isSubmitterApprovalStep(step);
                const canAct = displayStatus === '진행중'
                  && !isAllTab
                  && !!user
                  && step.approver_id === user.id
                  && !isSubmitterStep;
                return (
                  <div key={step.id} className="flex items-center gap-2">
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
                      displayStatus === '승인' ? 'bg-success/10 text-success' :
                      displayStatus === '반려' ? 'bg-destructive/10 text-destructive' :
                      displayStatus === '진행중' ? 'bg-primary/10 text-primary ring-1 ring-primary/40' :
                      displayStatus === '취소' ? 'bg-muted/50 text-muted-foreground line-through' :
                      'bg-muted/40 text-muted-foreground opacity-60'
                    }`}>
                      {displayStatus === '승인' ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                       displayStatus === '반려' ? <XCircle className="h-3.5 w-3.5" /> :
                       displayStatus === '진행중' ? <Clock className="h-3.5 w-3.5" /> :
                       <Clock className="h-3.5 w-3.5 opacity-50" />}
                      <span>{step.step}</span>
                      <span className="opacity-70">({step.approver_name || '미지정'}{step.company_name ? ` · ${step.company_name}` : ''})</span>
                      {displayStatus === '대기' && <span className="text-[10px] opacity-70">· 순번대기</span>}
                      {displayStatus === '진행중' && <span className="text-[10px] font-bold">· 결재중</span>}
                      {displayStatus === '승인' && isSubmitterStep && <span className="text-[10px] opacity-70">· 상신완료</span>}
                    </div>
                    {canAct && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => handleApprovalAction(step.id, '승인')}>승인</Button>
                        <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-destructive" onClick={() => setRejectingId(step.id)}>반려</Button>
                      </div>
                    )}
                    {i < sectionLen - 1 && <div className="h-px w-6 bg-border" />}
                  </div>
                );
              };

              const renderComments = (sectionSteps: any[]) => {
                const withComments = sectionSteps.filter((s: any) => s.comment);
                if (withComments.length === 0) return null;
                return (
                  <p className="text-xs text-muted-foreground mt-1">
                    코멘트: {withComments.map((s: any) => `${s.approver_name}: "${s.comment}"`).join(' | ')}
                  </p>
                );
              };

              const postIsExtend = timeline.postSteps.some((s) =>
                String((s as any).position || (s as any).step_position || '').toLowerCase().startsWith('extend')
              );

              return (
                <Card key={groupKey}>
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">
                            {entityTypeLabel(firstStep?.entity_type || (run ? 'assessment_run' : null))}
                          </Badge>
                          <h3 className="font-semibold">{cardTitle}</h3>
                        </div>
                        {run && <p className="text-xs text-muted-foreground mt-0.5">상태: {run.status}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {(() => {
                          const arr = timeline.issuanceSteps;
                          const first = arr[0];
                          const canWithdraw = !!user && !isAllTab
                            && first?.entity_type && first?.entity_id
                            && timeline.postSteps.length === 0
                            && arr.every(s => s.status === '진행중' || s.status === '대기' || s.status === '승인')
                            && arr.some(s => s.status === '진행중')
                            && !arr.some(s => s.status === '승인' && !isSubmitterApprovalStep(s) && (s.step_order ?? 0) > 1)
                            && (isMaster || seesAllCompanies || isProjectAdmin
                                || arr.some(s => s.approver_id === user.id && (s.step_order === 1 || isSubmitterApprovalStep(s))));
                          return canWithdraw ? (
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-destructive" onClick={() => handleWithdraw(arr)}>
                              <XCircle className="h-3 w-3" /> 회수
                            </Button>
                          ) : null;
                        })()}
                        {run && (
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleDownloadRunPDF(run.id)}>
                            <FileText className="h-3 w-3" /> PDF
                          </Button>
                        )}
                        {docHref && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => navigate(docHref)}>
                            <ExternalLink className="h-3 w-3" /> {run ? '상세' : '문서 보기'}
                          </Button>
                        )}
                      </div>
                    </div>

                    {timeline.issuanceSteps.length > 0 && (
                      <div className="space-y-1.5">
                        {isPermit && (
                          <p className="text-[11px] font-medium text-muted-foreground">발행 결재</p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          {timeline.issuanceSteps.map((step: any, i: number) =>
                            renderStepChip(step, timeline.issuanceSteps, i, timeline.issuanceSteps.length)
                          )}
                        </div>
                        {renderComments(timeline.issuanceSteps)}
                      </div>
                    )}

                    {timeline.postSteps.length > 0 && (
                      <div className="space-y-1.5 mt-3 pt-3 border-t border-dashed">
                        <p className="text-[11px] font-medium text-muted-foreground">
                          {postIsExtend ? '연장 결재' : '작업완료 결재'}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {timeline.postSteps.map((step: any, i: number) =>
                            renderStepChip(step, timeline.postSteps, i, timeline.postSteps.length)
                          )}
                        </div>
                        {renderComments(timeline.postSteps)}
                      </div>
                    )}

                    {timeline.priorIssuanceSteps.length > 0 && (
                      <details className="mt-3 rounded-md border bg-muted/5 px-3 py-2">
                        <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                          이전 상신 ({timeline.priorIssuanceSteps.length}건)
                        </summary>
                        <div className="mt-2 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            {timeline.priorIssuanceSteps.map((step: any, i: number) =>
                              renderStepChip(step, timeline.priorIssuanceSteps, i, timeline.priorIssuanceSteps.length)
                            )}
                          </div>
                          {renderComments(timeline.priorIssuanceSteps)}
                        </div>
                      </details>
                    )}

                    {rejectingId && activeSteps.some(s => s.id === rejectingId) && (
                      <div className="mt-3 flex items-end gap-2">
                        <div className="flex-1">
                          <Textarea placeholder="반려 사유를 입력하세요..." value={rejectComment} onChange={e => setRejectComment(e.target.value)} rows={2} className="text-xs" />
                        </div>
                        <Button size="sm" variant="destructive" className="h-8 gap-1" onClick={() => handleApprovalAction(rejectingId, '반려', rejectComment)}>
                          <MessageSquare className="h-3 w-3" /> 반려
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => { setRejectingId(null); setRejectComment(''); }}>취소</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Approvals;
