import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useToast } from '@/hooks/use-toast';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useSoftDelete } from '@/hooks/useSoftDelete';
import { WORK_PLAN_TYPES } from '@/lib/workPlanTemplates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, FileText, Clock, CheckCircle2, AlertTriangle, Trash2, Pencil, MoreVertical, Copy, CalendarClock } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { format, isPast, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';

const statusColors: Record<string, string> = {
  '작성중': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  '결재중': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  '완료': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  '만료': 'bg-muted text-muted-foreground',
  '반려': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const WorkPlans = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { log: auditLog } = useAuditLog();
  const access = useGlobalProjectAccess();
  const [plans, setPlans] = useState<any[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newPlan, setNewPlan] = useState({ workType: '', title: '', startDate: '', endDate: '', assessmentRunId: '' });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [editTitle, setEditTitle] = useState('');
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompany, setSelectedCompany] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [runs, setRuns] = useState<any[]>([]);

  useEffect(() => {
    if (access.selectedProject) {
      loadPlans();
      loadCompanies();
      loadRuns();
    }
  }, [access.selectedProject, access.userCompanyId]);

  const loadRuns = async () => {
    if (!access.selectedProject) return;
    const { data } = await supabase.from('assessment_runs')
      .select('id, title, period_label, status')
      .eq('project_id', access.selectedProject)
      .eq('is_deleted', false)
      .eq('status', '승인완료')
      .order('updated_at', { ascending: false }).limit(50);
    setRuns(data || []);
  };

  const loadCompanies = async () => {
    if (!access.selectedProject) return;
    const { data } = await supabase.from('companies').select('id, name, type').eq('project_id', access.selectedProject).order('name');
    setCompanies(data || []);
  };

  const loadPlans = async () => {
    let query: any = (supabase as any)
      .from('work_plans')
      .select('*')
      .eq('project_id', access.selectedProject)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    query = access.applyCompanyFilter(query);
    const { data, error } = await query;
    if (error) {
      toast({ title: '목록 로드 실패', description: error.message, variant: 'destructive' });
      return;
    }
    let items = data || [];

    // Auto-expire past end_date items
    const toExpire = items.filter(p => p.end_date && p.status === '완료' && isPast(parseISO(p.end_date)));
    if (toExpire.length > 0) {
      await Promise.all(toExpire.map(p =>
        supabase.from('work_plans').update({ status: '만료' }).eq('id', p.id)
      ));
      items = items.map(p => toExpire.find(e => e.id === p.id) ? { ...p, status: '만료' } : p);
    }

    setPlans(items);
  };

  const handleCreate = async () => {
    if (!newPlan.workType || !access.selectedProject || !newPlan.startDate || !newPlan.endDate) {
      toast({ title: '작업기간을 입력해주세요.', variant: 'destructive' });
      return;
    }
    const wpType = WORK_PLAN_TYPES.find(t => t.id === newPlan.workType);
    if (!wpType) return;

    const title = newPlan.title || `${wpType.name} 작업계획서`;
    const sections = wpType.templateSections.map(s => ({
      key: s.key, title: s.title, type: s.type, content: '', placeholder: s.placeholder,
    }));
    const attachments = wpType.requiredAttachments.map((name, i) => ({
      id: `att-${i}`, name, uploaded: false, fileUrl: '',
    }));

    const companyId = access.userCompanyId || selectedCompany || null;

    const { data, error } = await supabase.from('work_plans').insert({
      project_id: access.selectedProject,
      company_id: companyId,
      work_type: newPlan.workType,
      title,
      sections,
      attachments,
      created_by: user?.id,
      start_date: newPlan.startDate,
      end_date: newPlan.endDate,
      assessment_run_id: newPlan.assessmentRunId || null,
      version: 1,
    } as any).select().single();

    if (error) {
      toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '작업계획서가 생성되었습니다.' });
      if (data) await auditLog('create', 'work_plan', data.id, access.selectedProject, { title, work_type: newPlan.workType });
      setDialogOpen(false);
      setNewPlan({ workType: '', title: '', startDate: '', endDate: '', assessmentRunId: '' });
      setSelectedCompany('');
      if (data) navigate(`/work-plan/${data.id}`);
    }
  };

  const handleClone = async (plan: any) => {
    if (!user) return;
    const { data, error } = await supabase.from('work_plans').insert({
      project_id: plan.project_id,
      company_id: plan.company_id,
      work_type: plan.work_type,
      title: `${plan.title} (v${(plan.version || 1) + 1})`,
      sections: plan.sections,
      attachments: plan.attachments,
      created_by: user.id,
      parent_id: plan.id,
      version: (plan.version || 1) + 1,
      status: '작성중',
    }).select().single();

    if (error) {
      toast({ title: '복사 실패', description: error.message, variant: 'destructive' });
    } else if (data) {
      toast({ title: '새 회차가 생성되었습니다.' });
      await auditLog('clone', 'work_plan', data.id, plan.project_id, { from_id: plan.id, version: data.version });
      navigate(`/work-plan/${data.id}`);
    }
  };

  const { softDelete } = useSoftDelete();
  const handleDelete = async () => {
    if (!deleteTarget) return;
    const r = await softDelete('work_plans', deleteTarget.id, {
      label: `작업계획서 "${deleteTarget.title || ''}"`,
      projectId: deleteTarget.project_id,
    });
    if (r.ok) setPlans(prev => prev.filter(p => p.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  const handleEditTitle = async () => {
    if (!editTarget || !editTitle.trim()) return;
    const { error } = await supabase.from('work_plans').update({ title: editTitle }).eq('id', editTarget.id);
    if (error) {
      toast({ title: '수정 실패', variant: 'destructive' });
    } else {
      toast({ title: '제목이 수정되었습니다.' });
      setPlans(prev => prev.map(p => p.id === editTarget.id ? { ...p, title: editTitle } : p));
    }
    setEditTarget(null);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case '완료': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case '반려': return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case '만료': return <CalendarClock className="h-4 w-4 text-muted-foreground" />;
      default: return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const filteredPlans = statusFilter === 'all' ? plans : plans.filter(p => p.status === statusFilter);

  if (access.loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">로딩 중...</div>;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileText className="h-5 w-5" /> 작업계획서
          </h1>
          <p className="text-xs text-muted-foreground mt-1">산업안전보건법 기준 법정 작업계획서 관리</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="작성중">작성중</SelectItem>
              <SelectItem value="결재중">결재중</SelectItem>
              <SelectItem value="완료">완료</SelectItem>
              <SelectItem value="만료">만료</SelectItem>
            </SelectContent>
          </Select>
          {access.canCreate('work_plan') && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1"><Plus className="h-3.5 w-3.5" /> 새 작업계획서</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>작업계획서 생성</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">공종 선택 (법정 대상)</Label>
                    <Select value={newPlan.workType} onValueChange={v => setNewPlan(p => ({ ...p, workType: v }))}>
                      <SelectTrigger><SelectValue placeholder="공종을 선택하세요" /></SelectTrigger>
                      <SelectContent>
                        {WORK_PLAN_TYPES.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {newPlan.workType && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {WORK_PLAN_TYPES.find(t => t.id === newPlan.workType)?.legalBasis}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">작업 시작일 *</Label>
                      <Input type="date" value={newPlan.startDate} onChange={e => setNewPlan(p => ({ ...p, startDate: e.target.value }))} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">작업 종료일 *</Label>
                      <Input type="date" value={newPlan.endDate} onChange={e => setNewPlan(p => ({ ...p, endDate: e.target.value }))} className="h-9" />
                    </div>
                  </div>
                  {access.isProjectAdmin && companies.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">소속 업체</Label>
                      <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                        <SelectTrigger><SelectValue placeholder="업체 선택 (선택사항)" /></SelectTrigger>
                        <SelectContent>
                          {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">제목 (선택)</Label>
                    <Input value={newPlan.title} onChange={e => setNewPlan(p => ({ ...p, title: e.target.value }))} placeholder="미입력 시 자동 생성" className="h-9" />
                  </div>
                  <Button onClick={handleCreate} disabled={!newPlan.workType || !newPlan.startDate || !newPlan.endDate} className="w-full">생성</Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex gap-2 flex-wrap">
        {['작성중', '결재중', '완료', '만료'].map(s => {
          const count = plans.filter(p => p.status === s).length;
          if (count === 0) return null;
          return (
            <Badge key={s} variant="outline" className="text-xs cursor-pointer" onClick={() => setStatusFilter(s)}>
              {s} {count}
            </Badge>
          );
        })}
        <Badge variant="outline" className="text-xs cursor-pointer" onClick={() => setStatusFilter('all')}>
          전체 {plans.length}
        </Badge>
      </div>

      {filteredPlans.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">작업계획서가 없습니다.</p>
            <p className="text-xs mt-1">새 작업계획서를 생성하세요.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredPlans.map(plan => {
            const wpType = WORK_PLAN_TYPES.find(t => t.id === plan.work_type);
            const company = companies.find(c => c.id === plan.company_id);
            const isExpired = plan.end_date && isPast(parseISO(plan.end_date));
            return (
              <Card key={plan.id} className={`hover:border-primary/40 transition-colors ${plan.status === '만료' ? 'opacity-60' : ''}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle
                      className="text-sm leading-tight cursor-pointer hover:underline"
                      onClick={() => navigate(`/work-plan/${plan.id}`)}
                    >
                      {plan.title}
                      {plan.version > 1 && <span className="text-muted-foreground ml-1">v{plan.version}</span>}
                    </CardTitle>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge className={`text-[10px] ${statusColors[plan.status] || ''}`}>
                        {getStatusIcon(plan.status)}
                        <span className="ml-1">{plan.status}</span>
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/work-plan/${plan.id}`)}>
                            <FileText className="h-3.5 w-3.5 mr-2" /> 열기
                          </DropdownMenuItem>
                          {access.canEdit('work_plan') && (
                            <DropdownMenuItem onClick={() => { setEditTarget(plan); setEditTitle(plan.title); }}>
                              <Pencil className="h-3.5 w-3.5 mr-2" /> 제목 수정
                            </DropdownMenuItem>
                          )}
                          {access.canCreate('work_plan') && (
                            <DropdownMenuItem onClick={() => handleClone(plan)}>
                              <Copy className="h-3.5 w-3.5 mr-2" /> 이 계획서로 새로 만들기
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {access.canDelete('work_plan') && (
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(plan)}>
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> 삭제
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 cursor-pointer" onClick={() => navigate(`/work-plan/${plan.id}`)}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{wpType?.name}</span>
                    {company && (
                      <Badge variant="outline" className="text-[9px] h-4">{company.name}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    {plan.start_date && plan.end_date ? (
                      <span className={isExpired ? 'text-destructive font-medium' : ''}>
                        {format(parseISO(plan.start_date), 'MM.dd')} ~ {format(parseISO(plan.end_date), 'MM.dd')}
                        {isExpired && ' (만료)'}
                      </span>
                    ) : (
                      <span>{format(new Date(plan.created_at), 'yyyy.MM.dd', { locale: ko })}</span>
                    )}
                    {wpType?.hasRiggingPlan && (
                      <Badge variant="outline" className="text-[9px] h-4">리깅플랜</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>작업계획서 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}"을(를) 삭제하시겠습니까?<br />
              <strong className="text-destructive">삭제 후 복구가 불가합니다.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Title Dialog */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>제목 수정</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} />
          </div>
          <DialogFooter>
            <Button onClick={handleEditTitle} disabled={!editTitle.trim()}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WorkPlans;
