import { useState, useEffect } from "react";
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
import { exportToPDF } from "@/lib/exportUtils";
import { useMemo } from "react";


const ENTITY_LINK = (t?: string | null, id?: string | null): string | null => {
  if (!t || !id) return null;
  switch (t) {
    case 'assessment_run': return `/assessment-run/${id}`;
    case 'work_plan': return `/work-plans/${id}`;
    case 'work_permit': return `/work-permits/${id}`;
    case 'safety_cost': return `/safety-cost`;
    case 'incident': return `/incidents`;
    case 'emergency_drill': return `/emergency-drills`;
    case 'tbm': return `/tbm`;
    default: return null;
  }
};

const Approvals = () => {
  const navigate = useNavigate();
  const { user, profile, isAdmin, hasRole } = useAuth();
  const { projects, selectedProject, setSelectedProject, isMaster, isProjectAdmin, userCompanyId } = useGlobalProjectAccess();
  const { toast } = useToast();
  const { log } = useAuditLog();
  const [approvals, setApprovals] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [rejectComment, setRejectComment] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [tab, setTab] = useState('mine');
  const [entityPending, setEntityPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState<'all' | 'work_plan' | 'work_permit'>('all');


  const fetchEntityPending = async () => {
    const { data } = await supabase.rpc('get_my_pending_entity_approvals');
    setEntityPending((data as any[]) || []);
  };

  const actOnEntity = async (id: string, action: 'approve'|'reject') => {
    const comment = action === 'reject' ? (prompt('반려 사유') || '') : '';
    if (action === 'reject' && !comment) return;
    const { data, error } = await supabase.rpc('act_on_entity_approval', { _approval_id: id, _action: action, _comment: comment });
    const r = data as any;
    if (error || r?.error) toast({ title: '처리 실패', description: r?.error || error?.message, variant: 'destructive' });
    else { toast({ title: action === 'approve' ? '승인 완료' : '반려 완료' }); fetchEntityPending(); }
  };

  const handleWithdraw = async (steps: any[]) => {
    const first = steps?.[0];
    if (!first?.entity_type || !first?.entity_id) {
      toast({ title: '회수 불가', description: '이 결재는 회수를 지원하지 않습니다.', variant: 'destructive' });
      return;
    }
    if (steps.some((s: any) => s.status === '승인' || s.status === '반려')) {
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
      const msg = code === 'ALREADY_DECIDED' ? '이미 승인/반려된 단계가 있어 회수할 수 없습니다.'
        : code === 'NOT_SUBMITTER' ? '상신자 본인만 회수할 수 있습니다.'
        : code === 'NO_APPROVAL' ? '결재 정보를 찾을 수 없습니다.'
        : code;
      toast({ title: '회수 실패', description: msg, variant: 'destructive' });
      return;
    }
    toast({ title: '결재 회수 완료', description: '문서가 작성중 상태로 되돌아갔습니다.' });
    fetchData(); fetchEntityPending();
  };

  const fetchData = async () => {
    if (!selectedProject) { setLoading(false); return; }
    setLoading(true);
    try {
      const [a, r] = await Promise.all([
        supabase.from('approvals').select('*').eq('project_id', selectedProject).order('created_at', { ascending: false }),
        supabase.from('assessment_runs').select('*').eq('project_id', selectedProject),
      ]);
      let approvalsData = a.data || [];
      let runsData = r.data || [];

      // 업체 기반 필터링: 발주사/관리자가 아닌 경우 본인 회사 관련 결재만 표시
      if (!isMaster && !isProjectAdmin && userCompanyId) {
        approvalsData = approvalsData.filter((ap: any) =>
          ap.approver_id === user?.id || ap.company_id === userCompanyId
        );
        runsData = runsData.filter((r: any) =>
          !r.target_company_ids || r.target_company_ids.length === 0 || r.target_company_ids.includes(userCompanyId)
        );
      }

      setApprovals(approvalsData);
      setRuns(runsData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); fetchEntityPending(); }, [selectedProject, userCompanyId]);

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
      if (entityTypeFilter !== 'all' && e.entity_type !== entityTypeFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (e.entity_title || '').toLowerCase().includes(q) || (e.step || '').toLowerCase().includes(q);
    });
  }, [entityPending, entityTypeFilter, search]);


  // Group by run_id, only show the latest approval_version per run
  const grouped = (() => {
    const maxVersionByRun: Record<string, number> = {};
    for (const ap of approvals) {
      const key = ap.run_id || 'general';
      const ver = ap.approval_version || 1;
      if (!maxVersionByRun[key] || ver > maxVersionByRun[key]) maxVersionByRun[key] = ver;
    }
    return approvals.reduce((acc, ap) => {
      const key = ap.run_id || 'general';
      const ver = ap.approval_version || 1;
      if (ver === maxVersionByRun[key]) {
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
    for (const [runId, steps] of Object.entries(group)) {
      const run = runs.find((r: any) => r.id === runId);
      const text = [
        run?.type, run?.period_label,
        ...(steps as any[]).map(s => `${s.step} ${s.approver_name || ''} ${s.company_name || ''} ${s.comment || ''}`),
      ].join(' ').toLowerCase();
      if (text.includes(q)) out[runId] = steps;
    }
    return out;
  };

  // Filter tabs
  const getFilteredGrouped = () => {
    if (tab === 'mine' && user) {
      const filtered: Record<string, any[]> = {};
      for (const [runId, steps] of Object.entries(grouped)) {
        // 순차 결재: 오직 현재 활성(진행중) 단계 담당자에게만 노출
        const myActive = (steps as any[]).filter(s => s.approver_id === user.id && s.status === '진행중');
        if (myActive.length > 0) filtered[runId] = steps as any[];
      }
      return applySearch(filtered);
    }
    if (tab === 'submitted' && user) {
      const filtered: Record<string, any[]> = {};
      for (const [runId, steps] of Object.entries(grouped)) {
        const submitted = (steps as any[]).some(s => s.approver_id === user.id && s.step === '작성');
        if (submitted) filtered[runId] = steps as any[];
      }
      return applySearch(filtered);
    }
    if (tab === 'completed') {
      const filtered: Record<string, any[]> = {};
      for (const [runId, steps] of Object.entries(grouped)) {
        const arr = steps as any[];
        const allDecided = arr.every(s => s.status === '승인' || s.status === '반려' || s.status === '취소');
        if (allDecided) filtered[runId] = arr;
      }
      return applySearch(filtered);
    }
    if (tab === 'rejected') {
      const filtered: Record<string, any[]> = {};
      for (const [runId, steps] of Object.entries(grouped)) {
        if ((steps as any[]).some(s => s.status === '반려')) filtered[runId] = steps as any[];
      }
      return applySearch(filtered);
    }
    // 'all' tab — read-only overview (admin only)
    return applySearch(grouped);

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
    if (action === '반려' && !(comment || '').trim()) {
      toast({ title: '반려 사유를 입력하세요.', variant: 'destructive' }); return;
    }

    // 순차 결재/다음 단계 자동 활성화/알림은 DB RPC(SSOT)가 처리
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
    const run = runs.find(r => r.id === runId);
    if (!run) return;
    // Fetch full project info for PDF
    const { data: proj } = await supabase.from('projects').select('*').eq('id', run.project_id).single();
    if (!proj) return;
    try {
      const { data: items } = await supabase.from('risk_items').select('*').eq('run_id', runId).order('sort_order');
      const { data: parts } = await supabase.from('assessment_run_participants').select('*').eq('run_id', runId);
      const rows = (items || []).filter((i: any) => !i.is_excluded).map(i => ({
        ...i, sub_task: i.sub_task || '', hazard: i.hazard || '', hazard_situation: i.hazard_situation || '',
        existing_measure: i.existing_measure || '', improvement_measure: i.improvement_measure || '',
        likelihood_grade: i.likelihood_grade || '중', severity_grade: i.severity_grade || '중', risk_grade: i.risk_grade || '중',
        improved_likelihood_grade: i.improved_likelihood_grade || '하', improved_severity_grade: i.improved_severity_grade || '하', improved_risk_grade: i.improved_risk_grade || '하',
        ppe: i.ppe || [], legal_basis: i.legal_basis || [], department: i.department || '', assignee: i.assignee || '', note: i.note || '',
      }));
      exportToPDF(rows, { ...proj, period_start: proj.period_start || '', period_end: proj.period_end || '' } as any, null, parts || [], { type: run.type, period_label: run.period_label });
    } catch (err) {
      toast({ title: 'PDF 다운로드 실패', description: String(err), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileCheck className="h-6 w-6" /> 전자결재</h1>
          <p className="text-sm text-muted-foreground mt-1">직책 기반 순차 결재: 작성(관리감독자) → 안전관리자 검토 → 현장대리인 확인 → 최종승인</p>
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
          (steps as any[]).some(s => s.approver_id === user.id && s.status === '진행중' && !pendingIds.has(s.id))
        ).length + entityPending.length : 0;
        const submittedCount = user ? Object.values(grouped).filter((steps: any) =>
          (steps as any[]).some(s => s.approver_id === user.id && s.step === '작성')
        ).length : 0;
        const completedCount = Object.values(grouped).filter((steps: any) =>
          (steps as any[]).every(s => s.status === '승인' || s.status === '반려' || s.status === '취소')
        ).length;
        const rejectedCount = Object.values(grouped).filter((steps: any) =>
          (steps as any[]).some(s => s.status === '반려')
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
          <Select value={entityTypeFilter} onValueChange={(v) => setEntityTypeFilter(v as any)}>
            <SelectTrigger className="w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 유형</SelectItem>
              <SelectItem value="work_plan">작업계획서</SelectItem>
              <SelectItem value="work_permit">작업허가서</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {filteredEntityPending.length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 space-y-2">
            <div className="text-sm font-bold flex items-center gap-2">
              <FileCheck className="h-4 w-4" /> 작업계획서·작업허가서 결재 대기 ({filteredEntityPending.length}/{entityPending.length})
            </div>
            {filteredEntityPending.map((e: any) => (
              <div key={e.approval_id} className="flex items-center gap-2 p-2 border rounded bg-background">
                <Badge variant="outline" className="text-[10px]">
                  {e.entity_type === 'work_plan' ? '작업계획서' : '작업허가서'}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{e.entity_title || '-'}</div>
                  <div className="text-xs text-muted-foreground">{e.entity_date || ''} · {e.step}</div>
                </div>
                <Button size="sm" onClick={() => actOnEntity(e.approval_id, 'approve')}>
                  <CheckCircle2 className="h-3 w-3 mr-1" />승인
                </Button>
                <Button size="sm" variant="destructive" onClick={() => actOnEntity(e.approval_id, 'reject')}>
                  <XCircle className="h-3 w-3 mr-1" />반려
                </Button>
              </div>
            ))}
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
                (steps as any[]).some(s => s.approver_id === user.id && s.status === '진행중' && !pendingIds.has(s.id))
              ).length + entityPending.length : 0;
              return mineCount > 0 ? <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">{mineCount}</Badge> : null;
            })()}
          </TabsTrigger>
          <TabsTrigger value="submitted" className="flex-1">상신한 결재</TabsTrigger>
          <TabsTrigger value="completed" className="flex-1">완료</TabsTrigger>
          <TabsTrigger value="rejected" className="flex-1">반려</TabsTrigger>
          {isAdmin() && <TabsTrigger value="all" className="flex-1">전체 현황</TabsTrigger>}
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
              {tab === 'mine' && <div className="text-xs">위험성평가·작업계획서·작업허가서를 상신하면 이 곳에 표시됩니다.</div>}
            </CardContent></Card>
          ) : (
            Object.entries(filteredGrouped).map(([runId, steps]) => {
              const run = runs.find((r: any) => r.id === runId);
              const isAllTab = tab === 'all';
              return (
                <Card key={runId}>
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-semibold">{run ? `[${run.type}] ${run.period_label}` : '일반'}</h3>
                        {run && <p className="text-xs text-muted-foreground">상태: {run.status}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {(() => {
                          const arr = steps as any[];
                          const first = arr[0];
                          const canWithdraw = !!user && !isAllTab
                            && first?.entity_type && first?.entity_id
                            && arr.every(s => s.status === '진행중' || s.status === '대기')
                            && arr.some(s => s.status === '진행중')
                            // 상신자(=문서 작성자) 또는 마스터/프로젝트 관리자만 UI 노출
                            && (isMaster || isProjectAdmin
                                || arr.some(s => s.approver_id === user.id && s.step_order === 1));
                          return canWithdraw ? (
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-destructive" onClick={() => handleWithdraw(arr)}>
                              <XCircle className="h-3 w-3" /> 회수
                            </Button>
                          ) : null;
                        })()}
                        {run && (
                          <>
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleDownloadRunPDF(runId)}>
                              <FileText className="h-3 w-3" /> PDF
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => navigate(`/assessment-run/${runId}`)}>
                              <ExternalLink className="h-3 w-3" /> 상세
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {(steps as any[]).slice().sort((a, b) => {
                        return (a.step_order ?? 99) - (b.step_order ?? 99);
                      }).map((step: any, i: number) => (
                        <div key={step.id} className="flex items-center gap-2">
                          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
                            step.status === '승인' ? 'bg-success/10 text-success' :
                            step.status === '반려' ? 'bg-destructive/10 text-destructive' :
                            step.status === '진행중' ? 'bg-primary/10 text-primary ring-1 ring-primary/40' :
                            step.status === '취소' ? 'bg-muted/50 text-muted-foreground line-through' :
                            'bg-muted/40 text-muted-foreground opacity-60'
                          }`}>
                            {step.status === '승인' ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                             step.status === '반려' ? <XCircle className="h-3.5 w-3.5" /> :
                             step.status === '진행중' ? <Clock className="h-3.5 w-3.5" /> :
                             <Clock className="h-3.5 w-3.5 opacity-50" />}
                            <span>{step.step}</span>
                            <span className="opacity-70">({step.approver_name || '미지정'}{step.company_name ? ` · ${step.company_name}` : ''})</span>
                            {step.status === '대기' && <span className="text-[10px] opacity-70">· 순번대기</span>}
                            {step.status === '진행중' && <span className="text-[10px] font-bold">· 결재중</span>}
                          </div>
                          {/* 오직 활성(진행중) 단계의 지정 결재자에게만 버튼 노출 */}
                          {step.status === '진행중' && !isAllTab && user && step.approver_id === user.id && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => handleApprovalAction(step.id, '승인')}>승인</Button>
                              <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-destructive" onClick={() => setRejectingId(step.id)}>반려</Button>
                            </div>
                          )}
                          {i < (steps as any[]).length - 1 && <div className="h-px w-6 bg-border" />}
                        </div>
                      ))}
                    </div>
                    {rejectingId && (steps as any[]).some(s => s.id === rejectingId) && (
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
                    {(steps as any[]).some((s: any) => s.comment) && (
                      <p className="text-xs text-muted-foreground mt-2">
                        코멘트: {(steps as any[]).filter((s: any) => s.comment).map((s: any) => `${s.approver_name}: "${s.comment}"`).join(' | ')}
                      </p>
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
