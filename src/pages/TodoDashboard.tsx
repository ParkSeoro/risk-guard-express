import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ListTodo, RefreshCw, Trash2, Pencil, Plus, PieChart, Search } from 'lucide-react';
import { useAuditLog } from '@/hooks/useAuditLog';
import { format, isToday, isThisWeek, isThisMonth, startOfDay, endOfMonth, differenceInCalendarDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { PieChart as RPieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';

type StatusFilter = 'all' | 'pending' | 'done' | 'overdue';

const dueBadge = (dueStr: string, status: string) => {
  if (status === '완료') return null;
  const diff = differenceInCalendarDays(new Date(dueStr), startOfDay(new Date()));
  if (diff < 0) return <Badge variant="destructive" className="text-[9px] h-4">D+{Math.abs(diff)} 초과</Badge>;
  if (diff === 0) return <Badge className="text-[9px] h-4 bg-orange-500 hover:bg-orange-500">D-Day</Badge>;
  if (diff <= 3) return <Badge variant="outline" className="text-[9px] h-4 text-orange-600 border-orange-300">D-{diff}</Badge>;
  return null;
};

const CHART_COLORS = ['hsl(var(--primary))', 'hsl(var(--muted))'];

const TodoDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const access = useGlobalProjectAccess();
  const { log } = useAuditLog();
  const [todos, setTodos] = useState<any[]>([]);
  const [duties, setDuties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editTodo, setEditTodo] = useState<any>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', due_date: '' });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ title: '', description: '', due_date: format(new Date(), 'yyyy-MM-dd') });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    if (access.selectedProject && user) { loadTodos(); loadDuties(); }
  }, [access.selectedProject, user, access.userCompanyId]);

  const loadTodos = async () => {
    if (!user) return;
    setLoading(true);
    let query = supabase.from('todo_items').select('*')
      .eq('project_id', access.selectedProject)
      .eq('user_id', user.id)
      .eq('is_deleted', false)
      .order('due_date', { ascending: true });
    
    query = access.applyCompanyFilter(query);
    const { data } = await query;
    setTodos(data || []);
    setLoading(false);
  };

  const loadDuties = async () => {
    let query = supabase.from('legal_duties').select('*')
      .eq('project_id', access.selectedProject)
      .eq('is_active', true)
      .eq('is_deleted', false);
    query = access.applyCompanyFilter(query);
    const { data } = await query;
    setDuties(data || []);
  };

  const handleGenerateTodos = async () => {
    if (!access.selectedProject || !user || duties.length === 0) {
      toast({ title: '먼저 법적업무를 생성해주세요.', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    const today = startOfDay(new Date());
    const monthEnd = endOfMonth(today);
    const existingTitles = new Set(todos.map(t => `${t.title}-${t.due_date}`));
    const newTodos: any[] = [];

    for (const duty of duties) {
      const dates = getNextDueDates(duty.frequency, today, monthEnd);
      for (const date of dates) {
        const key = `${duty.duty_name}-${format(date, 'yyyy-MM-dd')}`;
        if (!existingTitles.has(key)) {
          newTodos.push({
            project_id: access.selectedProject,
            company_id: access.userCompanyId,
            user_id: user.id,
            legal_duty_id: duty.id,
            title: duty.duty_name,
            description: duty.description || '',
            due_date: format(date, 'yyyy-MM-dd'),
            frequency: duty.frequency,
            status: '미완료',
          });
        }
      }
    }

    if (newTodos.length === 0) { toast({ title: '이번 달 할 일이 모두 생성되어 있습니다.' }); setGenerating(false); return; }
    const { error } = await supabase.from('todo_items').insert(newTodos);
    if (error) { toast({ title: '생성 실패', description: error.message, variant: 'destructive' }); }
    else { toast({ title: `${newTodos.length}건의 할 일이 생성되었습니다.` }); loadTodos(); }
    setGenerating(false);
  };

  const getNextDueDates = (frequency: string, start: Date, end: Date): Date[] => {
    const dates: Date[] = [];
    const current = new Date(start);
    switch (frequency) {
      case 'daily':
        while (current <= end) { if (current.getDay() !== 0 && current.getDay() !== 6) dates.push(new Date(current)); current.setDate(current.getDate() + 1); }
        break;
      case 'weekly':
        while (current.getDay() !== 1) current.setDate(current.getDate() + 1);
        while (current <= end) { dates.push(new Date(current)); current.setDate(current.getDate() + 7); }
        break;
      case 'monthly': dates.push(new Date(start.getFullYear(), start.getMonth(), 1)); break;
      case 'quarterly': if ([0, 3, 6, 9].includes(start.getMonth())) dates.push(new Date(start)); break;
    }
    return dates;
  };

  const toggleTodo = async (id: string, current: string) => {
    const newStatus = current === '완료' ? '미완료' : '완료';
    const update: any = { status: newStatus };
    if (newStatus === '완료') { update.completed_at = new Date().toISOString(); update.completed_by = user?.id; }
    else { update.completed_at = null; update.completed_by = null; }
    await supabase.from('todo_items').update(update).eq('id', id);
    setTodos(prev => prev.map(t => t.id === id ? { ...t, ...update } : t));
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const reason = prompt('삭제 사유를 입력하세요. (필수)');
    if (!reason || !reason.trim()) return;
    const { error } = await supabase.from('todo_items').update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_reason: reason,
      deleted_by: user?.id || null,
    } as any).eq('id', deleteTarget.id);
    if (error) { toast({ title: '삭제 실패', description: error.message, variant: 'destructive' }); return; }
    await log('삭제', 'todo_item', deleteTarget.id, access.selectedProject || undefined, { reason, title: deleteTarget.title });
    setTodos(prev => prev.filter(t => t.id !== deleteTarget.id));
    setDeleteTarget(null);
    toast({ title: '삭제되었습니다.' });
  };

  const openEdit = (todo: any) => {
    setEditTodo(todo);
    setEditForm({ title: todo.title, description: todo.description || '', due_date: todo.due_date });
  };

  const handleEditSave = async () => {
    if (!editTodo) return;
    await supabase.from('todo_items').update({
      title: editForm.title, description: editForm.description, due_date: editForm.due_date,
    }).eq('id', editTodo.id);
    setTodos(prev => prev.map(t => t.id === editTodo.id ? { ...t, ...editForm } : t));
    setEditTodo(null);
    toast({ title: '수정되었습니다.' });
  };

  const handleAddTodo = async () => {
    if (!addForm.title.trim() || !access.selectedProject || !user) return;
    const { error } = await supabase.from('todo_items').insert({
      project_id: access.selectedProject,
      company_id: access.userCompanyId,
      user_id: user.id,
      title: addForm.title,
      description: addForm.description,
      due_date: addForm.due_date,
      frequency: 'event',
      status: '미완료',
    });
    if (error) { toast({ title: '추가 실패', variant: 'destructive' }); return; }
    toast({ title: '할 일이 추가되었습니다.' });
    setAddOpen(false);
    setAddForm({ title: '', description: '', due_date: format(new Date(), 'yyyy-MM-dd') });
    loadTodos();
  };

  const todayTodos = useMemo(() => todos.filter(t => isToday(new Date(t.due_date))), [todos]);
  const weekTodos = useMemo(() => todos.filter(t => isThisWeek(new Date(t.due_date), { locale: ko })), [todos]);
  const monthTodos = useMemo(() => todos.filter(t => isThisMonth(new Date(t.due_date))), [todos]);

  const completedToday = todayTodos.filter(t => t.status === '완료').length;
  const completedWeek = weekTodos.filter(t => t.status === '완료').length;
  const completedMonth = monthTodos.filter(t => t.status === '완료').length;

  const totalAll = todos.length;
  const completedAll = todos.filter(t => t.status === '완료').length;
  const completionRate = totalAll > 0 ? Math.round((completedAll / totalAll) * 100) : 0;

  const pieData = [
    { name: '완료', value: completedAll },
    { name: '미완료', value: totalAll - completedAll },
  ];

  const barData = [
    { name: '오늘', 완료: completedToday, 미완료: todayTodos.length - completedToday },
    { name: '이번 주', 완료: completedWeek, 미완료: weekTodos.length - completedWeek },
    { name: '이번 달', 완료: completedMonth, 미완료: monthTodos.length - completedMonth },
  ];

  if (access.loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">로딩 중...</div>;

  const TodoItem = ({ todo }: { todo: any }) => (
    <div className={`flex items-center gap-3 p-2.5 rounded-lg border ${todo.status === '완료' ? 'bg-muted/30 border-muted' : 'bg-background'}`}>
      <Checkbox checked={todo.status === '완료'} onCheckedChange={() => toggleTodo(todo.id, todo.status)} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${todo.status === '완료' ? 'line-through text-muted-foreground' : ''}`}>{todo.title}</p>
        {todo.description && <p className="text-[10px] text-muted-foreground truncate">{todo.description}</p>}
      </div>
      <div className="text-[10px] text-muted-foreground shrink-0">{format(new Date(todo.due_date), 'MM/dd (EEE)', { locale: ko })}</div>
      {access.canEdit('todo') && (
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => openEdit(todo)}>
          <Pencil className="h-3 w-3" />
        </Button>
      )}
      {access.canDelete('todo') && (
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={() => setDeleteTarget(todo)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><ListTodo className="h-5 w-5" /> 할 일</h1>
          <p className="text-xs text-muted-foreground mt-1">법적업무 기반 안전관리 체크리스트</p>
        </div>
        <div className="flex items-center gap-2">
          {access.canCreate('todo') && (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> 직접 추가
            </Button>
          )}
          <Button size="sm" onClick={handleGenerateTodos} disabled={generating} className="gap-1">
            <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
            {generating ? '생성 중...' : '할 일 생성'}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        {[{ label: '오늘', done: completedToday, total: todayTodos.length },
          { label: '이번 주', done: completedWeek, total: weekTodos.length },
          { label: '이번 달', done: completedMonth, total: monthTodos.length }].map(s => (
          <Card key={s.label}>
            <CardContent className="py-3 px-4 text-center">
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold">{s.done}/{s.total}</p>
              <Progress value={s.total ? (s.done / s.total) * 100 : 0} className="h-1.5 mt-1" />
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {s.total ? Math.round((s.done / s.total) * 100) : 0}%
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      {totalAll > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <PieChart className="h-4 w-4" /> 전체 완료율
              </CardTitle>
            </CardHeader>
            <CardContent className="h-48 flex items-center justify-center">
              <div className="relative w-40 h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <RPieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} dataKey="value" strokeWidth={0}>
                      {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
                    </Pie>
                  </RPieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-bold">{completionRate}%</span>
                </div>
              </div>
              <div className="ml-4 space-y-1 text-xs">
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm" style={{ background: CHART_COLORS[0] }} /> 완료 ({completedAll})</div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm" style={{ background: CHART_COLORS[1] }} /> 미완료 ({totalAll - completedAll})</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">기간별 현황</CardTitle>
            </CardHeader>
            <CardContent className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="완료" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="미완료" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {todos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ListTodo className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">할 일이 없습니다.</p>
            <p className="text-xs mt-1">"할 일 생성" 버튼을 눌러 법적업무 기반 할 일을 생성하세요.</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="today">
          <TabsList>
            <TabsTrigger value="today" className="text-xs gap-1">오늘 <Badge variant="secondary" className="text-[9px] h-4 ml-1">{todayTodos.length}</Badge></TabsTrigger>
            <TabsTrigger value="week" className="text-xs gap-1">이번 주 <Badge variant="secondary" className="text-[9px] h-4 ml-1">{weekTodos.length}</Badge></TabsTrigger>
            <TabsTrigger value="month" className="text-xs gap-1">이번 달 <Badge variant="secondary" className="text-[9px] h-4 ml-1">{monthTodos.length}</Badge></TabsTrigger>
          </TabsList>
          {[{ key: 'today', items: todayTodos, empty: '오늘 할 일이 없습니다.' },
            { key: 'week', items: weekTodos, empty: '이번 주 할 일이 없습니다.' },
            { key: 'month', items: monthTodos, empty: '이번 달 할 일이 없습니다.' }].map(tab => (
            <TabsContent key={tab.key} value={tab.key} className="space-y-2 mt-4">
              {tab.items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">{tab.empty}</p>
              ) : tab.items.map(t => <TodoItem key={t.id} todo={t} />)}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Add Todo Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>할 일 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">제목 *</Label>
              <Input value={addForm.title} onChange={e => setAddForm(p => ({ ...p, title: e.target.value }))} placeholder="할 일 입력" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">설명</Label>
              <Textarea value={addForm.description} onChange={e => setAddForm(p => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">마감일</Label>
              <Input type="date" value={addForm.due_date} onChange={e => setAddForm(p => ({ ...p, due_date: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddTodo} disabled={!addForm.title.trim()}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTodo} onOpenChange={open => { if (!open) setEditTodo(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>할 일 수정</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">제목</Label>
              <Input value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">설명</Label>
              <Textarea value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} rows={3} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">마감일</Label>
              <Input type="date" value={editForm.due_date} onChange={e => setEditForm(p => ({ ...p, due_date: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleEditSave}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>할 일 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}"을(를) 삭제하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TodoDashboard;
