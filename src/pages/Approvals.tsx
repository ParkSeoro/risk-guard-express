import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProjectAccess } from "@/hooks/useProjectAccess";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/useAuditLog";
import { sendNotification } from "@/lib/notificationService";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Clock, XCircle, FileCheck, MessageSquare, FileText, ExternalLink } from "lucide-react";
import { exportToPDF } from "@/lib/exportUtils";

const APPROVAL_STEP_ORDER: Record<string, number> = { '작성': 0, '안전관리자 검토': 1, '현장대리인 확인': 2, '최종승인': 3, '검토': 1, '승인': 3 };

const Approvals = () => {
  const navigate = useNavigate();
  const { user, profile, isAdmin, hasRole } = useAuth();
  const { projects, selectedProject, setSelectedProject, isMaster, isProjectAdmin, userCompanyId } = useProjectAccess();
  const { toast } = useToast();
  const { log } = useAuditLog();
  const [approvals, setApprovals] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [rejectComment, setRejectComment] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [tab, setTab] = useState('mine');
  const [entityPending, setEntityPending] = useState<any[]>([]);

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

  const fetchData = async () => {
    if (!selectedProject) return;
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
  };

  useEffect(() => { fetchData(); fetchEntityPending(); }, [selectedProject, userCompanyId]);

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

  // Filter tabs
  const getFilteredGrouped = () => {
    if (tab === 'mine' && user) {
      // Only show runs where I have a pending step assigned to me
      const filtered: Record<string, any[]> = {};
      for (const [runId, steps] of Object.entries(grouped)) {
        const myPending = (steps as any[]).filter(s => s.approver_id === user.id && s.status === '대기');
        if (myPending.length > 0) filtered[runId] = steps as any[];
      }
      return filtered;
    }
    if (tab === 'submitted' && user) {
      const filtered: Record<string, any[]> = {};
      for (const [runId, steps] of Object.entries(grouped)) {
        const submitted = (steps as any[]).some(s => s.approver_id === user.id && s.step === '작성');
        if (submitted) filtered[runId] = steps as any[];
      }
      return filtered;
    }
    // 'all' tab — read-only overview (admin only)
    return grouped;
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

    // Sequential approval enforcement: check all prior steps are approved
    if (ap.run_id) {
      const runApprovals = approvals.filter(a => a.run_id === ap.run_id && (a.approval_version || 1) === (ap.approval_version || 1) && a.status !== '취소');
      const sorted = runApprovals.sort((a, b) => (APPROVAL_STEP_ORDER[a.step] ?? 99) - (APPROVAL_STEP_ORDER[b.step] ?? 99));
      const myIndex = sorted.findIndex(a => a.id === ap.id);
      const priorNotApproved = sorted.slice(0, myIndex).some(a => a.status !== '승인');
      if (priorNotApproved) {
        toast({ title: '이전 단계 결재가 완료되지 않았습니다.', description: '순차 결재 방식으로, 앞 단계가 먼저 승인되어야 합니다.', variant: 'destructive' });
        return;
      }
    }

    await supabase.from('approvals').update({
      status: action, approver_id: user.id, approver_name: profile.display_name, comment: comment || '',
      approved_at: action === '승인' ? new Date().toISOString() : null,
    }).eq('id', approvalId);

    if (action === '승인' && ap?.run_id) {
      const { data: allAp } = await supabase.from('approvals').select('*')
        .eq('run_id', ap.run_id).eq('approval_version', ap.approval_version || 1);
      const allApproved = (allAp || []).filter((a: any) => a.status !== '취소').every((a: any) => a.status === '승인' || a.id === approvalId);
      if (allApproved) {
        await supabase.from('assessment_runs').update({ status: '승인완료' }).eq('id', ap.run_id);
        await supabase.from('risk_items').update({ is_locked: true }).eq('run_id', ap.run_id);
        const run = runs.find(r => r.id === ap.run_id);
        const authorStep = (allAp || []).find((a: any) => a.step === '작성');
        if (authorStep?.approver_id) {
          await sendNotification({
            user_id: authorStep.approver_id, title: '결재 최종 승인',
            message: `[${run?.type || ''}] ${run?.period_label || ''} 회차가 최종 승인되었습니다.`,
            type: 'approval_approved', related_id: ap.run_id, related_type: 'assessment_run', project_id: ap.project_id,
          });
        }
        toast({ title: '최종 승인 완료!' });
      } else {
        // Notify next pending
        const sortedPending = (allAp || [])
          .filter((a: any) => a.status === '대기' && a.id !== approvalId)
          .sort((a: any, b: any) => {
            return (APPROVAL_STEP_ORDER[a.step] ?? 99) - (APPROVAL_STEP_ORDER[b.step] ?? 99);
          });
        const nextPending = sortedPending[0];
        if (nextPending?.approver_id) {
          const run = runs.find(r => r.id === ap.run_id);
          await sendNotification({
            user_id: nextPending.approver_id, title: '결재 요청',
            message: `[${run?.type || ''}] ${run?.period_label || ''} - ${ap.step} 승인 완료. ${nextPending.step} 결재를 진행해주세요.`,
            type: 'approval_request', related_id: ap.run_id, related_type: 'assessment_run', project_id: ap.project_id,
          });
        }
        toast({ title: `${ap.step} 단계가 승인되었습니다.` });
      }
    } else if (action === '반려' && ap?.run_id) {
      await supabase.from('assessment_runs').update({ status: '보완중' }).eq('id', ap.run_id);
      const run = runs.find(r => r.id === ap.run_id);
      const { data: authorData } = await supabase.from('approvals').select('*')
        .eq('run_id', ap.run_id).eq('step', '작성').eq('approval_version', ap.approval_version || 1).limit(1);
      const authorStep = authorData?.[0];
      if (authorStep?.approver_id) {
        await sendNotification({
          user_id: authorStep.approver_id, title: '결재 반려',
          message: `[${run?.type || ''}] ${run?.period_label || ''} 반려됨. 사유: ${comment || '(없음)'}`,
          type: 'approval_rejected', related_id: ap.run_id, related_type: 'assessment_run', project_id: ap.project_id,
        });
      }
      toast({ title: '반려되었습니다.', variant: 'destructive' });
    } else {
      toast({ title: `${action} 처리되었습니다.` });
    }

    log(action, 'approval', approvalId, selectedProject);
    setRejectingId(null);
    setRejectComment('');
    fetchData();
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
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileCheck className="h-6 w-6" /> 결재함</h1>
          <p className="text-sm text-muted-foreground mt-1">직책 기반 순차 결재: 작성(관리감독자) → 안전관리자 검토 → 현장대리인 확인 → 최종승인</p>
        </div>
        <Select value={selectedProject} onValueChange={setSelectedProject}>
          <SelectTrigger className="w-60 text-xs"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
          <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {entityPending.length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 space-y-2">
            <div className="text-sm font-bold flex items-center gap-2">
              <FileCheck className="h-4 w-4" /> 작업계획서·작업허가서 결재 대기 ({entityPending.length})
            </div>
            {entityPending.map((e: any) => (
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
        <TabsList className="w-full">
          <TabsTrigger value="mine" className="flex-1">내 결재 (대기)</TabsTrigger>
          <TabsTrigger value="submitted" className="flex-1">상신한 결재</TabsTrigger>
          {isAdmin() && <TabsTrigger value="all" className="flex-1">전체 현황 (읽기전용)</TabsTrigger>}
        </TabsList>

        <TabsContent value={tab} className="space-y-3 mt-3">
          {Object.keys(filteredGrouped).length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              {tab === 'mine' ? '대기 중인 결재가 없습니다.' : '결재 내역이 없습니다.'}
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
                      {(steps as any[]).sort((a, b) => {
                        return (APPROVAL_STEP_ORDER[a.step] ?? 99) - (APPROVAL_STEP_ORDER[b.step] ?? 99);
                      }).map((step: any, i: number) => (
                        <div key={step.id} className="flex items-center gap-2">
                          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
                            step.status === '승인' ? 'bg-success/10 text-success' :
                            step.status === '반려' ? 'bg-destructive/10 text-destructive' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            {step.status === '승인' ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                             step.status === '반려' ? <XCircle className="h-3.5 w-3.5" /> :
                             <Clock className="h-3.5 w-3.5" />}
                            <span>{step.step}</span>
                            <span className="opacity-70">({step.approver_name || '미지정'}{step.company_name ? ` · ${step.company_name}` : ''})</span>
                          </div>
                          {/* Only show action buttons to the ASSIGNED approver, not admins in 'all' tab */}
                          {step.status === '대기' && !isAllTab && user && step.approver_id === user.id && (
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
