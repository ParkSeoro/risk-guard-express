import React, { useState, useMemo, useEffect } from 'react';
import { PeriodicTask, PeriodicCycle } from './types';
import { INITIAL_PERIODIC_TASKS } from './sampleData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  Search,
  Trash2,
  Edit2,
  Check,
  RotateCcw,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';

const STORAGE_KEY = 'safenex_owner_periodic_tasks';

const CYCLE_CONFIG: Record<PeriodicCycle, { label: string; desc: string; color: string }> = {
  daily: { label: '매일 (Daily)', desc: '출역 확인, 위험작업허가 대조, 아침 TBM 점검 등 당일 필수 점검', color: 'text-blue-600' },
  weekly: { label: '매주 (Weekly)', desc: '주간 안전공정회의 주관, 안전점검 시정조치 독촉, 중장비 스마트안전 점검', color: 'text-indigo-600' },
  monthly: { label: '매월 (Monthly)', desc: '월간 안전보건관리비 실적 대조, 안전보건협의체 주관, 협력사 성적표 산출', color: 'text-purple-600' },
  quarterly: { label: '분기/반기 (Quarterly)', desc: '에어리퀴드 안전의 날(Safety Day), 경영진 합동점검, 비상대피훈련', color: 'text-amber-600' },
};

export function TeamPeriodicTasks() {
  const [tasks, setTasks] = useState<PeriodicTask[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      /* ignore */
    }
    return INITIAL_PERIODIC_TASKS;
  });

  const [activeCycle, setActiveCycle] = useState<PeriodicCycle>('daily');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<PeriodicTask | null>(null);

  const [form, setForm] = useState({
    title: '',
    category: '현장순회/점검',
    description: '',
    assignee: '박서로 차장',
    due_rule: '매일 09:30',
    due_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      /* ignore */
    }
  }, [tasks]);

  const openCreateModal = () => {
    setEditingTask(null);
    setForm({
      title: '',
      category: '현장순회/점검',
      description: '',
      assignee: '박서로 차장',
      due_rule: activeCycle === 'daily' ? '매일 09:30' : activeCycle === 'weekly' ? '매주 금요일' : '매월 말일',
      due_date: new Date().toISOString().slice(0, 10),
      notes: '',
    });
    setModalOpen(true);
  };

  const openEditModal = (task: PeriodicTask) => {
    setEditingTask(task);
    setForm({
      title: task.title,
      category: task.category,
      description: task.description,
      assignee: task.assignee,
      due_rule: task.due_rule,
      due_date: task.due_date,
      notes: task.notes || '',
    });
    setModalOpen(true);
  };

  const handleSaveModal = () => {
    if (!form.title.trim()) {
      toast.error('업무명을 입력해주세요.');
      return;
    }

    if (editingTask) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === editingTask.id
            ? {
                ...t,
                title: form.title.trim(),
                category: form.category,
                description: form.description,
                assignee: form.assignee,
                due_rule: form.due_rule,
                due_date: form.due_date,
                notes: form.notes,
              }
            : t
        )
      );
      toast.success('업무가 수정되었습니다.');
    } else {
      const newTask: PeriodicTask = {
        id: `task-${Date.now()}`,
        cycle: activeCycle,
        title: form.title.trim(),
        category: form.category,
        description: form.description,
        assignee: form.assignee,
        due_rule: form.due_rule,
        due_date: form.due_date,
        status: 'pending',
        notes: form.notes,
      };
      setTasks((prev) => [newTask, ...prev]);
      toast.success('새 업무가 등록되었습니다.');
    }

    setModalOpen(false);
  };

  const toggleStatus = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const nextStatus =
          t.status === 'pending' ? 'in_progress' : t.status === 'in_progress' ? 'completed' : 'pending';
        return {
          ...t,
          status: nextStatus,
          completed_at: nextStatus === 'completed' ? new Date().toISOString() : undefined,
        };
      })
    );
  };

  const handleDelete = (id: string, title: string) => {
    if (!window.confirm(`[${title}] 업무를 삭제하시겠습니까?`)) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    toast.success('업무가 삭제되었습니다.');
  };

  const currentCycleTasks = useMemo(() => {
    return tasks.filter((t) => t.cycle === activeCycle);
  }, [tasks, activeCycle]);

  const completedCount = useMemo(() => {
    return currentCycleTasks.filter((t) => t.status === 'completed').length;
  }, [currentCycleTasks]);

  const progressPercent = currentCycleTasks.length > 0 ? Math.round((completedCount / currentCycleTasks.length) * 100) : 0;

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return currentCycleTasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (q && !`${t.title} ${t.description} ${t.assignee} ${t.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [currentCycleTasks, search, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Cycle Selector & Progress Header */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <Tabs value={activeCycle} onValueChange={(v) => setActiveCycle(v as PeriodicCycle)}>
                <TabsList className="grid grid-cols-4 w-full sm:w-[480px]">
                  <TabsTrigger value="daily" className="text-xs">매일 (Daily)</TabsTrigger>
                  <TabsTrigger value="weekly" className="text-xs">매주 (Weekly)</TabsTrigger>
                  <TabsTrigger value="monthly" className="text-xs">매월 (Monthly)</TabsTrigger>
                  <TabsTrigger value="quarterly" className="text-xs">분기 (Quarterly)</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="text-xs text-muted-foreground mt-2">
                {CYCLE_CONFIG[activeCycle].desc}
              </p>
            </div>

            <Button onClick={openCreateModal} size="sm" className="h-8 text-xs gap-1.5 shrink-0">
              <Plus className="h-3.5 w-3.5" /> 업무 항목 추가
            </Button>
          </div>

          {/* Progress bar */}
          <div className="pt-2 border-t space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {CYCLE_CONFIG[activeCycle].label} 업무 이행률
              </span>
              <span className="font-bold text-primary">
                {completedCount} / {currentCycleTasks.length} 항목 완료 ({progressPercent}%)
              </span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Task List Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
          <Input
            placeholder="업무명, 세부 내용, 담당자 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="진행 상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            <SelectItem value="pending">대기중</SelectItem>
            <SelectItem value="in_progress">진행중</SelectItem>
            <SelectItem value="completed">완료</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Task Cards Grid */}
      <div className="space-y-2.5">
        {filteredTasks.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground text-sm">
              등록된 업무 항목이 없습니다. 상단 '업무 항목 추가'를 눌러 등록해보세요.
            </CardContent>
          </Card>
        ) : (
          filteredTasks.map((task) => {
            const isDone = task.status === 'completed';
            const inProgress = task.status === 'in_progress';
            return (
              <Card
                key={task.id}
                className={`transition-all border-l-4 ${
                  isDone
                    ? 'border-l-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/10'
                    : inProgress
                    ? 'border-l-blue-500 bg-blue-50/20 dark:bg-blue-950/10'
                    : 'border-l-slate-300'
                }`}
              >
                <CardContent className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleStatus(task.id)}
                      className={`mt-0.5 h-6 w-6 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                        isDone
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : inProgress
                          ? 'bg-blue-100 border-blue-400 text-blue-700'
                          : 'border-slate-300 hover:border-primary'
                      }`}
                      title="클릭하여 상태 변경 (대기 → 진행 → 완료)"
                    >
                      {isDone && <Check className="h-3.5 w-3.5" />}
                      {inProgress && <Clock className="h-3 w-3" />}
                    </button>

                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-[10px] py-0">
                          {task.category}
                        </Badge>
                        <h4
                          className={`font-semibold text-sm leading-snug ${
                            isDone ? 'line-through text-muted-foreground' : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {task.title}
                        </h4>
                      </div>

                      {task.description && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{task.description}</p>
                      )}

                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground pt-0.5">
                        <span className="flex items-center gap-1">
                          <UserCheck className="h-3 w-3" /> {task.assignee}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> 기준: {task.due_rule}
                        </span>
                        {task.notes && (
                          <span className="text-slate-600 dark:text-slate-400 italic">
                            비고: {task.notes}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <Button
                      variant={isDone ? 'outline' : inProgress ? 'default' : 'secondary'}
                      size="sm"
                      onClick={() => toggleStatus(task.id)}
                      className="h-7 text-xs px-2.5"
                    >
                      {isDone ? '완료됨' : inProgress ? '진행중' : '시작하기'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditModal(task)}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(task.id, task.title)}
                      className="h-7 w-7 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Add / Edit Task Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {editingTask ? '주기별 업무 수정' : '새 주기별 업무 등록'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3.5 py-1">
            <div className="space-y-1">
              <Label className="text-xs">업무명 *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="예: 당일 고위험 작업허가서(PTW) 현장 대조"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">카테고리</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="현장순회/점검">현장순회/점검</SelectItem>
                    <SelectItem value="TBM/출역">TBM/출역</SelectItem>
                    <SelectItem value="안전회의">안전회의</SelectItem>
                    <SelectItem value="안전보건관리비">안전보건관리비</SelectItem>
                    <SelectItem value="법정협의체">법정협의체</SelectItem>
                    <SelectItem value="스마트안전">스마트안전</SelectItem>
                    <SelectItem value="안전의날">안전의날</SelectItem>
                    <SelectItem value="기타">기타</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">담당자</Label>
                <Input
                  value={form.assignee}
                  onChange={(e) => setForm({ ...form, assignee: e.target.value })}
                  placeholder="예: 박서로 차장"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">수행 주기/시간 기준</Label>
                <Input
                  value={form.due_rule}
                  onChange={(e) => setForm({ ...form, due_rule: e.target.value })}
                  placeholder="예: 매일 09:30 또는 매월 25일"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">목표일자</Label>
                <Input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">세부 업무 설명</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="점검 체크리스트 또는 업무 상세 내용"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">비고 / 참고사항</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="첨부 문서 위치 또는 특이사항"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              취소
            </Button>
            <Button onClick={handleSaveModal}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TeamPeriodicTasks;
