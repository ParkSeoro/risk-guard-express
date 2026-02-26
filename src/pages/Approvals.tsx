import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/useAuditLog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Clock, XCircle, Send, FileCheck } from "lucide-react";

const Approvals = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { log } = useAuditLog();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [approvals, setApprovals] = useState<any[]>([]);
  const [riskItems, setRiskItems] = useState<any[]>([]);
  const [showSubmit, setShowSubmit] = useState(false);
  const [selectedRiskItems, setSelectedRiskItems] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  useEffect(() => {
    supabase.from('projects').select('id, name').then(({ data }) => {
      if (data && data.length > 0) {
        setProjects(data);
        setSelectedProject(data[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    Promise.all([
      supabase.from('approvals').select('*').eq('project_id', selectedProject).order('created_at', { ascending: false }),
      supabase.from('risk_items').select('id, process, sub_task, hazard, risk, improved_risk, status').eq('project_id', selectedProject),
    ]).then(([a, r]) => {
      setApprovals(a.data || []);
      setRiskItems(r.data || []);
    });
  }, [selectedProject]);

  // Group approvals by risk_item_id
  const grouped = approvals.reduce((acc, ap) => {
    const key = ap.risk_item_id || 'general';
    if (!acc[key]) acc[key] = [];
    acc[key].push(ap);
    return acc;
  }, {} as Record<string, any[]>);

  const handleSubmitForApproval = async () => {
    if (!user || !profile || !selectedProject) return;
    const inserts = selectedRiskItems.map(riId => ({
      project_id: selectedProject,
      risk_item_id: riId,
      step: '작성',
      status: '승인',
      approver_id: user.id,
      approver_name: profile.display_name,
      comment: comment || '',
    }));
    // Also create review and approval steps as pending
    const reviewInserts = selectedRiskItems.map(riId => ({
      project_id: selectedProject,
      risk_item_id: riId,
      step: '검토',
      status: '대기',
      approver_name: '',
    }));
    const approvalInserts = selectedRiskItems.map(riId => ({
      project_id: selectedProject,
      risk_item_id: riId,
      step: '승인',
      status: '대기',
      approver_name: '',
    }));

    await supabase.from('approvals').insert([...inserts, ...reviewInserts, ...approvalInserts]);
    toast({ title: `${selectedRiskItems.length}건이 결재 상신되었습니다.` });
    log('결재상신', 'approvals', selectedProject, selectedProject, { count: selectedRiskItems.length });
    setShowSubmit(false);
    setSelectedRiskItems([]);
    setComment('');
    // Refresh
    const { data } = await supabase.from('approvals').select('*').eq('project_id', selectedProject).order('created_at', { ascending: false });
    setApprovals(data || []);
  };

  const handleApprovalAction = async (approvalId: string, action: '승인' | '반려', approvalComment: string = '') => {
    if (!user || !profile) return;
    await supabase.from('approvals').update({
      status: action,
      approver_id: user.id,
      approver_name: profile.display_name,
      comment: approvalComment,
    }).eq('id', approvalId);
    toast({ title: `${action} 처리되었습니다.` });
    log(action, 'approval', approvalId, selectedProject);
    const { data } = await supabase.from('approvals').select('*').eq('project_id', selectedProject).order('created_at', { ascending: false });
    setApprovals(data || []);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">결재함</h1><p className="text-sm text-muted-foreground mt-1">작성 → 검토 → 승인 워크플로우</p></div>
        <div className="flex items-center gap-2">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-60 text-xs"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
            <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" className="gap-1.5" onClick={() => setShowSubmit(true)}>
            <Send className="h-3.5 w-3.5" /> 결재 상신
          </Button>
        </div>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">결재 내역이 없습니다.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([riskId, steps]) => {
            const riskItem = riskItems.find(r => r.id === riskId);
            return (
              <Card key={riskId}>
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-semibold">{riskItem ? `${riskItem.process} – ${riskItem.sub_task}` : '일반'}</h3>
                      {riskItem && <p className="text-xs text-muted-foreground">{riskItem.hazard}</p>}
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
                        {step.status === '대기' && (
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
                    <p className="text-xs text-muted-foreground mt-2 ml-1">
                      코멘트: {(steps as any[]).filter((s: any) => s.comment).map((s: any) => `${s.approver_name}: "${s.comment}"`).join(' | ')}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Submit for Approval Dialog */}
      <Dialog open={showSubmit} onOpenChange={setShowSubmit}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>결재 상신</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">위험성평가 항목을 선택하여 결재를 상신합니다.</p>
            <div className="max-h-60 overflow-y-auto space-y-1">
              {riskItems.filter(ri => !Object.keys(grouped).includes(ri.id)).map(ri => (
                <label key={ri.id} className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer text-sm">
                  <input type="checkbox" checked={selectedRiskItems.includes(ri.id)}
                    onChange={e => setSelectedRiskItems(prev => e.target.checked ? [...prev, ri.id] : prev.filter(x => x !== ri.id))} />
                  <span className="font-medium">{ri.process}</span> – <span>{ri.sub_task || ri.hazard}</span>
                </label>
              ))}
            </div>
            <div className="space-y-1">
              <Label>코멘트 (선택)</Label>
              <Textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="결재 관련 메모..." />
            </div>
            <Button onClick={handleSubmitForApproval} disabled={selectedRiskItems.length === 0} className="w-full">
              {selectedRiskItems.length}건 결재 상신
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Approvals;
