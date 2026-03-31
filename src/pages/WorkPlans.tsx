import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useToast } from '@/hooks/use-toast';
import { WORK_PLAN_TYPES } from '@/lib/workPlanTemplates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, FileText, Clock, CheckCircle2, AlertTriangle, Trash2, Pencil, MoreVertical } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

const statusColors: Record<string, string> = {
  '작성중': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  '검토중': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  '승인완료': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  '반려': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const WorkPlans = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const access = useProjectAccess();
  const [plans, setPlans] = useState<any[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newPlan, setNewPlan] = useState({ workType: '', title: '' });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [editTitle, setEditTitle] = useState('');
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompany, setSelectedCompany] = useState('');

  useEffect(() => {
    if (access.selectedProject) {
      loadPlans();
      loadCompanies();
    }
  }, [access.selectedProject, access.userCompanyId]);

  const loadCompanies = async () => {
    if (!access.selectedProject) return;
    const { data } = await supabase.from('companies').select('id, name, type').eq('project_id', access.selectedProject).order('name');
    setCompanies(data || []);
  };

  const loadPlans = async () => {
    let query = supabase
      .from('work_plans')
      .select('*')
      .eq('project_id', access.selectedProject)
      .order('created_at', { ascending: false });
    
    // Apply company filter for non-admin roles
    query = access.applyCompanyFilter(query);
    
    const { data } = await query;
    setPlans(data || []);
  };

  const handleCreate = async () => {
    if (!newPlan.workType || !access.selectedProject) return;
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
    }).select().single();

    if (error) {
      toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '작업계획서가 생성되었습니다.' });
      setDialogOpen(false);
      setNewPlan({ workType: '', title: '' });
      setSelectedCompany('');
      if (data) navigate(`/work-plan/${data.id}`);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from('work_plans').delete().eq('id', deleteTarget.id);
    if (error) {
      toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '삭제되었습니다.' });
      setPlans(prev => prev.filter(p => p.id !== deleteTarget.id));
    }
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
      case '승인완료': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case '반려': return <AlertTriangle className="h-4 w-4 text-red-500" />;
      default: return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

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
          <Select value={access.selectedProject} onValueChange={access.setSelectedProject}>
            <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
            <SelectContent>{access.projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
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
                  {/* Company selector for admins */}
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
                  <Button onClick={handleCreate} disabled={!newPlan.workType} className="w-full">생성</Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {plans.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">작업계획서가 없습니다.</p>
            <p className="text-xs mt-1">새 작업계획서를 생성하세요.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {plans.map(plan => {
            const wpType = WORK_PLAN_TYPES.find(t => t.id === plan.work_type);
            const company = companies.find(c => c.id === plan.company_id);
            return (
              <Card key={plan.id} className="hover:border-primary/40 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle
                      className="text-sm leading-tight cursor-pointer hover:underline"
                      onClick={() => navigate(`/work-plan/${plan.id}`)}
                    >
                      {plan.title}
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
                    <span>{format(new Date(plan.created_at), 'yyyy.MM.dd', { locale: ko })}</span>
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
