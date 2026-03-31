import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ListTodo, CalendarDays, Sparkles, RefreshCw, CheckCircle2, Circle, Clock } from 'lucide-react';
import { format, isToday, isThisWeek, isThisMonth, startOfDay, addDays, endOfWeek, endOfMonth } from 'date-fns';
import { ko } from 'date-fns/locale';

const TodoDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [todos, setTodos] = useState<any[]>([]);
  const [duties, setDuties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProject && user) {
      loadTodos();
      loadDuties();
    }
  }, [selectedProject, user]);

  const loadProjects = async () => {
    const { data } = await supabase.from('projects').select('id, name').order('created_at', { ascending: false });
    if (data && data.length > 0) {
      setProjects(data);
      setSelectedProject(data[0].id);
    }
    setLoading(false);
  };

  const loadTodos = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('todo_items')
      .select('*')
      .eq('project_id', selectedProject)
      .eq('user_id', user.id)
      .gte('due_date', format(new Date(), 'yyyy-MM-dd'))
      .order('due_date', { ascending: true });
    setTodos(data || []);
  };

  const loadDuties = async () => {
    const { data } = await supabase
      .from('legal_duties')
      .select('*')
      .eq('project_id', selectedProject)
      .eq('is_active', true);
    setDuties(data || []);
  };

  const handleGenerateTodos = async () => {
    if (!selectedProject || !user || duties.length === 0) {
      toast({ title: '먼저 법적업무를 생성해주세요.', variant: 'destructive' });
      return;
    }
    setGenerating(true);

    const today = startOfDay(new Date());
    const monthEnd = endOfMonth(today);

    // Generate to-dos for this month based on active duties
    const existingTitles = new Set(todos.map(t => `${t.title}-${t.due_date}`));
    const newTodos: any[] = [];

    for (const duty of duties) {
      const dates = getNextDueDates(duty.frequency, today, monthEnd);
      for (const date of dates) {
        const key = `${duty.duty_name}-${format(date, 'yyyy-MM-dd')}`;
        if (!existingTitles.has(key)) {
          newTodos.push({
            project_id: selectedProject,
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

    if (newTodos.length === 0) {
      toast({ title: '이번 달 할 일이 모두 생성되어 있습니다.' });
      setGenerating(false);
      return;
    }

    const { error } = await supabase.from('todo_items').insert(newTodos);
    if (error) {
      toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `${newTodos.length}건의 할 일이 생성되었습니다.` });
      loadTodos();
    }
    setGenerating(false);
  };

  const getNextDueDates = (frequency: string, start: Date, end: Date): Date[] => {
    const dates: Date[] = [];
    const current = new Date(start);
    switch (frequency) {
      case 'daily':
        while (current <= end) {
          if (current.getDay() !== 0 && current.getDay() !== 6) dates.push(new Date(current));
          current.setDate(current.getDate() + 1);
        }
        break;
      case 'weekly':
        // Every Monday
        while (current.getDay() !== 1) current.setDate(current.getDate() + 1);
        while (current <= end) {
          dates.push(new Date(current));
          current.setDate(current.getDate() + 7);
        }
        break;
      case 'monthly':
        dates.push(new Date(start.getFullYear(), start.getMonth(), 1));
        break;
      case 'quarterly':
        if ([0, 3, 6, 9].includes(start.getMonth())) {
          dates.push(new Date(start));
        }
        break;
      default:
        break;
    }
    return dates;
  };

  const toggleTodo = async (id: string, current: string) => {
    const newStatus = current === '완료' ? '미완료' : '완료';
    const update: any = { status: newStatus };
    if (newStatus === '완료') {
      update.completed_at = new Date().toISOString();
      update.completed_by = user?.id;
    } else {
      update.completed_at = null;
      update.completed_by = null;
    }
    await supabase.from('todo_items').update(update).eq('id', id);
    setTodos(prev => prev.map(t => t.id === id ? { ...t, ...update } : t));
  };

  const todayTodos = useMemo(() => todos.filter(t => isToday(new Date(t.due_date))), [todos]);
  const weekTodos = useMemo(() => todos.filter(t => isThisWeek(new Date(t.due_date), { locale: ko })), [todos]);
  const monthTodos = useMemo(() => todos.filter(t => isThisMonth(new Date(t.due_date))), [todos]);

  const completedToday = todayTodos.filter(t => t.status === '완료').length;
  const completedWeek = weekTodos.filter(t => t.status === '완료').length;
  const completedMonth = monthTodos.filter(t => t.status === '완료').length;

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">로딩 중...</div>;

  const TodoItem = ({ todo }: { todo: any }) => (
    <div className={`flex items-center gap-3 p-2.5 rounded-lg border ${todo.status === '완료' ? 'bg-muted/30 border-muted' : 'bg-background'}`}>
      <Checkbox
        checked={todo.status === '완료'}
        onCheckedChange={() => toggleTodo(todo.id, todo.status)}
      />
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${todo.status === '완료' ? 'line-through text-muted-foreground' : ''}`}>
          {todo.title}
        </p>
        {todo.description && (
          <p className="text-[10px] text-muted-foreground truncate">{todo.description}</p>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground shrink-0">
        {format(new Date(todo.due_date), 'MM/dd (EEE)', { locale: ko })}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ListTodo className="h-5 w-5" /> 할 일
          </h1>
          <p className="text-xs text-muted-foreground mt-1">법적업무 기반 안전관리 체크리스트</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder="프로젝트 선택" />
            </SelectTrigger>
            <SelectContent>
              {projects.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={handleGenerateTodos} disabled={generating} className="gap-1">
            <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
            {generating ? '생성 중...' : '할 일 생성'}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-3 px-4 text-center">
            <p className="text-[10px] text-muted-foreground">오늘</p>
            <p className="text-2xl font-bold">{completedToday}/{todayTodos.length}</p>
            <div className="w-full h-1.5 rounded-full bg-muted mt-1">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${todayTodos.length ? (completedToday / todayTodos.length) * 100 : 0}%` }}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4 text-center">
            <p className="text-[10px] text-muted-foreground">이번 주</p>
            <p className="text-2xl font-bold">{completedWeek}/{weekTodos.length}</p>
            <div className="w-full h-1.5 rounded-full bg-muted mt-1">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${weekTodos.length ? (completedWeek / weekTodos.length) * 100 : 0}%` }}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4 text-center">
            <p className="text-[10px] text-muted-foreground">이번 달</p>
            <p className="text-2xl font-bold">{completedMonth}/{monthTodos.length}</p>
            <div className="w-full h-1.5 rounded-full bg-muted mt-1">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${monthTodos.length ? (completedMonth / monthTodos.length) * 100 : 0}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

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
            <TabsTrigger value="today" className="text-xs gap-1">
              오늘 <Badge variant="secondary" className="text-[9px] h-4 ml-1">{todayTodos.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="week" className="text-xs gap-1">
              이번 주 <Badge variant="secondary" className="text-[9px] h-4 ml-1">{weekTodos.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="month" className="text-xs gap-1">
              이번 달 <Badge variant="secondary" className="text-[9px] h-4 ml-1">{monthTodos.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="today" className="space-y-2 mt-4">
            {todayTodos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">오늘 할 일이 없습니다.</p>
            ) : (
              todayTodos.map(t => <TodoItem key={t.id} todo={t} />)
            )}
          </TabsContent>
          <TabsContent value="week" className="space-y-2 mt-4">
            {weekTodos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">이번 주 할 일이 없습니다.</p>
            ) : (
              weekTodos.map(t => <TodoItem key={t.id} todo={t} />)
            )}
          </TabsContent>
          <TabsContent value="month" className="space-y-2 mt-4">
            {monthTodos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">이번 달 할 일이 없습니다.</p>
            ) : (
              monthTodos.map(t => <TodoItem key={t.id} todo={t} />)
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default TodoDashboard;
