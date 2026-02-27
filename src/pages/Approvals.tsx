import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/useAuditLog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Clock, XCircle, FileCheck, MessageSquare, FileText, ExternalLink } from "lucide-react";
import { exportToPDF } from "@/lib/exportUtils";

const Approvals = () => {
  const navigate = useNavigate();
  const { user, profile, isAdmin, hasRole } = useAuth();
  const { toast } = useToast();
  const { log } = useAuditLog();
  const [projects, setProjects] = useState<{ id: string; name: string; site_name: string; client: string; contractor: string; period_start: string; period_end: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [approvals, setApprovals] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [rejectComment, setRejectComment] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [tab, setTab] = useState('all');

  useEffect(() => {
    supabase.from('projects').select('id, name, site_name, client, contractor, period_start, period_end').then(({ data }) => {
      if (data && data.length > 0) { setProjects(data); setSelectedProject(data[0].id); }
    });
  }, []);

  const fetchData = async () => {
    if (!selectedProject) return;
    const [a, r] = await Promise.all([
      supabase.from('approvals').select('*').eq('project_id', selectedProject).order('created_at', { ascending: false }),
      supabase.from('assessment_runs').select('*').eq('project_id', selectedProject),
    ]);
    setApprovals(a.data || []);
    setRuns(r.data || []);
  };

  useEffect(() => { fetchData(); }, [selectedProject]);

  // Group by run_id
  const grouped = approvals.reduce((acc, ap) => {
    const key = ap.run_id || 'general';
    if (!acc[key]) acc[key] = [];
    acc[key].push(ap);
    return acc;
  }, {} as Record<string, any[]>);

  // Filter tabs
  const getFilteredGrouped = () => {
    if (tab === 'all') return grouped;
    if (tab === 'mine' && user) {
      const filtered: Record<string, any[]> = {};
      for (const [runId, steps] of Object.entries(grouped)) {
        const mySteps = (steps as any[]).filter(s => s.approver_id === user.id && s.status === '대기');
        if (mySteps.length > 0) filtered[runId] = steps as any[];
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
    return grouped;
  };

  const filteredGrouped = getFilteredGrouped();

  const handleApprovalAction = async (approvalId: string, action: '승인' | '반려', comment?: string) => {
    if (!user || !profile) return;
    await supabase.from('approvals').update({
      status: action, approver_id: user.id, approver_name: profile.display_name, comment: comment || '',
    }).eq('id', approvalId);

    const ap = approvals.find(a => a.id === approvalId);
    if (action === '승인' && ap?.run_id) {
      const { data: allAp } = await supabase.from('approvals').select('*').eq('run_id', ap.run_id);
      const allApproved = (allAp || []).every((a: any) => a.status === '승인' || a.id === approvalId);
      if (allApproved) {
        await supabase.from('assessment_runs').update({ status: '승인완료' }).eq('id', ap.run_id);
        await supabase.from('risk_items').update({ is_locked: true }).eq('run_id', ap.run_id);
        // Notify author
        const authorStep = (allAp || []).find((a: any) => a.step === '작성');
        if (authorStep?.approver_id) {
          await supabase.from('notifications').insert([{
            user_id: authorStep.approver_id,
            title: '결재 최종 승인',
            message: `회차가 최종 승인되었습니다.`,
            type: 'approval_approved',
            related_id: ap.run_id,
            related_type: 'assessment_run',
            project_id: ap.project_id,
          }]);
        }
        toast({ title: '최종 승인 완료! 해당 회차가 잠금되었습니다.' });
      } else {
        // Notify next approver
        const nextPending = (allAp || []).find((a: any) => a.status === '대기' && a.id !== approvalId);
        if (nextPending?.approver_id) {
          await supabase.from('notifications').insert([{
            user_id: nextPending.approver_id,
            title: '결재 요청',
            message: `${ap.step} 단계 승인 완료. 결재를 진행해주세요.`,
            type: 'approval_request',
            related_id: ap.run_id,
            related_type: 'assessment_run',
            project_id: ap.project_id,
          }]);
        }
        toast({ title: `${ap.step} 단계가 승인되었습니다.` });
      }
    } else if (action === '반려' && ap?.run_id) {
      await supabase.from('assessment_runs').update({ status: '보완중' }).eq('id', ap.run_id);
      // Notify author
      const authorStep = approvals.find(a => a.run_id === ap.run_id && a.step === '작성');
      if (authorStep?.approver_id) {
        await supabase.from('notifications').insert([{
          user_id: authorStep.approver_id,
          title: '결재 반려',
          message: `회차가 반려되었습니다. 사유: ${comment || '(없음)'}`,
          type: 'approval_rejected',
          related_id: ap.run_id,
          related_type: 'assessment_run',
          project_id: ap.project_id,
        }]);
      }
      toast({ title: '반려되었습니다. 보완 후 재제출이 필요합니다.', variant: 'destructive' });
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
    const proj = projects.find(p => p.id === run.project_id);
    if (!proj) return;
    try {
      const { data: items } = await supabase.from('risk_items').select('*').eq('run_id', runId).order('sort_order');
      const { data: parts } = await supabase.from('assessment_run_participants').select('*').eq('run_id', runId);
      const rows = (items || []).map(i => ({
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
          <p className="text-sm text-muted-foreground mt-1">회차 단위 결재: 작성 → 검토 → 승인</p>
        </div>
        <Select value={selectedProject} onValueChange={setSelectedProject}>
          <SelectTrigger className="w-60 text-xs"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
          <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">전체 결재 현황</TabsTrigger>
          <TabsTrigger value="mine" className="flex-1">내 결재 (대기)</TabsTrigger>
          <TabsTrigger value="submitted" className="flex-1">상신한 결재</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="space-y-3 mt-3">
          {Object.keys(filteredGrouped).length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">결재 내역이 없습니다. 위험성평가 회차에서 결재 상신하세요.</CardContent></Card>
          ) : (
            Object.entries(filteredGrouped).map(([runId, steps]) => {
              const run = runs.find((r: any) => r.id === runId);
              return (
                <Card key={runId}>
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-semibold">
                          {run ? `[${run.type}] ${run.period_label}` : '일반'}
                        </h3>
                        {run && <p className="text-xs text-muted-foreground">상태: {run.status}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {run && (
                          <>
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleDownloadRunPDF(runId)}>
                              <FileText className="h-3 w-3" /> PDF 다운로드
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => navigate(`/assessment-run/${runId}`)}>
                              <ExternalLink className="h-3 w-3" /> 회차 상세
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {(steps as any[]).sort((a, b) => {
                        const order = { '작성': 0, '검토': 1, '승인': 2 };
                        return (order[a.step as keyof typeof order] || 0) - (order[b.step as keyof typeof order] || 0);
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
                            <span className="opacity-70">({step.approver_name || '미지정'})</span>
                          </div>
                          {step.status === '대기' && (isAdmin() || (user && step.approver_id === user.id)) && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => handleApprovalAction(step.id, '승인')}>승인</Button>
                              <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-destructive" onClick={() => setRejectingId(step.id)}>반려</Button>
                            </div>
                          )}
                          {i < (steps as any[]).length - 1 && <div className="h-px w-6 bg-border" />}
                        </div>
                      ))}
                    </div>
                    {/* Reject comment input */}
                    {rejectingId && (steps as any[]).some(s => s.id === rejectingId) && (
                      <div className="mt-3 flex items-end gap-2">
                        <div className="flex-1">
                          <Textarea placeholder="반려 사유를 입력하세요..." value={rejectComment} onChange={e => setRejectComment(e.target.value)} rows={2} className="text-xs" />
                        </div>
                        <Button size="sm" variant="destructive" className="h-8 gap-1" onClick={() => handleApprovalAction(rejectingId, '반려', rejectComment)}>
                          <MessageSquare className="h-3 w-3" /> 반려 확인
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
