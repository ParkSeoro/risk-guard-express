import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/useAuditLog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Clock, XCircle, FileCheck } from "lucide-react";

const Approvals = () => {
  const { user, profile, isAdmin } = useAuth();
  const { toast } = useToast();
  const { log } = useAuditLog();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [approvals, setApprovals] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('projects').select('id, name').then(({ data }) => {
      if (data && data.length > 0) { setProjects(data); setSelectedProject(data[0].id); }
    });
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    Promise.all([
      supabase.from('approvals').select('*').eq('project_id', selectedProject).order('created_at', { ascending: false }),
      supabase.from('assessment_runs').select('*').eq('project_id', selectedProject),
    ]).then(([a, r]) => {
      setApprovals(a.data || []);
      setRuns(r.data || []);
    });
  }, [selectedProject]);

  // Group by run_id
  const grouped = approvals.reduce((acc, ap) => {
    const key = ap.run_id || 'general';
    if (!acc[key]) acc[key] = [];
    acc[key].push(ap);
    return acc;
  }, {} as Record<string, any[]>);

  const handleApprovalAction = async (approvalId: string, action: '승인' | '반려') => {
    if (!user || !profile) return;
    await supabase.from('approvals').update({
      status: action, approver_id: user.id, approver_name: profile.display_name,
    }).eq('id', approvalId);

    // Check if all steps for this run are approved
    const ap = approvals.find(a => a.id === approvalId);
    if (action === '승인' && ap?.run_id) {
      const { data: allAp } = await supabase.from('approvals').select('*').eq('run_id', ap.run_id);
      const allApproved = (allAp || []).every((a: any) => a.status === '승인' || a.id === approvalId);
      if (allApproved) {
        await supabase.from('assessment_runs').update({ status: '승인완료' }).eq('id', ap.run_id);
        await supabase.from('risk_items').update({ is_locked: true }).eq('run_id', ap.run_id);
        toast({ title: '최종 승인 완료! 해당 회차가 잠금되었습니다.' });
      } else {
        toast({ title: `${ap.step} 단계가 승인되었습니다.` });
      }
    } else if (action === '반려' && ap?.run_id) {
      await supabase.from('assessment_runs').update({ status: '작성중' }).eq('id', ap.run_id);
      toast({ title: '반려되었습니다.', variant: 'destructive' });
    } else {
      toast({ title: `${action} 처리되었습니다.` });
    }

    log(action, 'approval', approvalId, selectedProject);
    const { data } = await supabase.from('approvals').select('*').eq('project_id', selectedProject).order('created_at', { ascending: false });
    setApprovals(data || []);
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

      {Object.keys(grouped).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">결재 내역이 없습니다. 위험성평가 회차에서 결재 상신하세요.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([runId, steps]) => {
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
                        {step.status === '대기' && isAdmin() && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => handleApprovalAction(step.id, '승인')}>승인</Button>
                            <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-destructive" onClick={() => handleApprovalAction(step.id, '반려')}>반려</Button>
                          </div>
                        )}
                        {i < (steps as any[]).length - 1 && <div className="h-px w-6 bg-border" />}
                      </div>
                    ))}
                  </div>
                  {(steps as any[]).some((s: any) => s.comment) && (
                    <p className="text-xs text-muted-foreground mt-2">
                      코멘트: {(steps as any[]).filter((s: any) => s.comment).map((s: any) => `${s.approver_name}: "${s.comment}"`).join(' | ')}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Approvals;
