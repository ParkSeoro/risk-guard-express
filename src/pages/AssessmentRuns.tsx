import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, ShieldAlert, Calendar, Filter, Search } from 'lucide-react';
import { format } from 'date-fns';

const typeLabels: Record<string, string> = { '최초': '최초', '정기': '정기', '수시': '수시', '상시': '상시' };
const statusColors: Record<string, string> = {
  '작성중': 'bg-muted text-muted-foreground',
  '검증대기': 'bg-warning/10 text-warning border-warning/30',
  '검증완료': 'bg-accent/10 text-accent border-accent/30',
  '결재진행': 'bg-primary/10 text-primary border-primary/30',
  '승인완료': 'bg-success/10 text-success border-success/30',
};

const AssessmentRuns = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    type: '정기',
    period_label: '',
    target_processes: '',
    target_contractors: '',
    notes: '',
  });

  // Stats per run
  const [runStats, setRunStats] = useState<Record<string, { total: number; high: number; med: number; low: number }>>({});

  useEffect(() => {
    supabase.from('projects').select('id, name').then(({ data }) => {
      if (data && data.length > 0) {
        setProjects(data);
        setSelectedProject(data[0].id);
      }
    });
  }, []);

  const fetchRuns = async () => {
    if (!selectedProject) return;
    setLoading(true);
    const { data } = await supabase.from('assessment_runs')
      .select('*')
      .eq('project_id', selectedProject)
      .order('created_at', { ascending: false });
    setRuns(data || []);

    // Fetch stats for each run
    if (data && data.length > 0) {
      const runIds = data.map((r: any) => r.id);
      const { data: items } = await supabase.from('risk_items')
        .select('run_id, risk_grade')
        .in('run_id', runIds);
      const stats: Record<string, { total: number; high: number; med: number; low: number }> = {};
      (items || []).forEach((item: any) => {
        if (!item.run_id) return;
        if (!stats[item.run_id]) stats[item.run_id] = { total: 0, high: 0, med: 0, low: 0 };
        stats[item.run_id].total++;
        if (item.risk_grade === '상') stats[item.run_id].high++;
        else if (item.risk_grade === '중') stats[item.run_id].med++;
        else stats[item.run_id].low++;
      });
      setRunStats(stats);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRuns(); }, [selectedProject]);

  const handleCreate = async () => {
    if (!user || !selectedProject) return;
    const { data, error } = await supabase.from('assessment_runs').insert([{
      project_id: selectedProject,
      type: form.type,
      period_label: form.period_label,
      target_processes: form.target_processes.split(',').map(s => s.trim()).filter(Boolean),
      target_contractors: form.target_contractors.split(',').map(s => s.trim()).filter(Boolean),
      notes: form.notes,
      status: '작성중',
      created_by: user.id,
    }]).select().single();
    if (error) {
      toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '평가 회차가 생성되었습니다.' });
    setShowCreate(false);
    setForm({ type: '정기', period_label: '', target_processes: '', target_contractors: '', notes: '' });
    fetchRuns();
    if (data) navigate(`/assessment-run/${data.id}`);
  };

  const filtered = runs.filter(r => {
    if (filterType !== 'all' && r.type !== filterType) return false;
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (search) {
      const term = search.toLowerCase();
      return r.period_label?.toLowerCase().includes(term) || r.notes?.toLowerCase().includes(term);
    }
    return true;
  });

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldAlert className="h-6 w-6" /> 위험성평가</h1>
          <p className="text-sm text-muted-foreground mt-1">평가 회차(최초/정기/수시/상시) 목록 · 회차 단위로 작성/검증/결재</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="h-8 w-60 text-xs"><SelectValue placeholder="프로젝트" /></SelectTrigger>
            <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" /> 회차 생성
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">종류 전체</SelectItem>
                <SelectItem value="최초">최초</SelectItem>
                <SelectItem value="정기">정기</SelectItem>
                <SelectItem value="수시">수시</SelectItem>
                <SelectItem value="상시">상시</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">상태 전체</SelectItem>
                <SelectItem value="작성중">작성중</SelectItem>
                <SelectItem value="검증대기">검증대기</SelectItem>
                <SelectItem value="검증완료">검증완료</SelectItem>
                <SelectItem value="결재진행">결재진행</SelectItem>
                <SelectItem value="승인완료">승인완료</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="기간, 메모 검색..." className="h-8 pl-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <span className="text-xs text-muted-foreground">{filtered.length}건</span>
          </div>
        </CardContent>
      </Card>

      {/* Run List */}
      {loading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">로딩 중...</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          평가 회차가 없습니다. '회차 생성'을 눌러 시작하세요.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(run => {
            const stats = runStats[run.id] || { total: 0, high: 0, med: 0, low: 0 };
            return (
              <Card key={run.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/assessment-run/${run.id}`)}>
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{typeLabels[run.type] || run.type}</Badge>
                        <h3 className="font-semibold">{run.period_label || '(기간 미지정)'}</h3>
                        <Badge variant="outline" className={`text-[10px] ${statusColors[run.status] || ''}`}>
                          {run.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(run.created_at), 'yyyy-MM-dd')}</span>
                        <span>항목 {stats.total}건</span>
                        {stats.high > 0 && <span className="text-destructive font-medium">상 {stats.high}</span>}
                        {stats.med > 0 && <span className="text-warning font-medium">중 {stats.med}</span>}
                        {stats.low > 0 && <span className="text-success font-medium">하 {stats.low}</span>}
                        {run.validation_verdict && (
                          <Badge variant="outline" className="text-[10px]">검증: {run.validation_verdict} ({run.validation_score}점)</Badge>
                        )}
                      </div>
                      {run.notes && <p className="text-xs text-muted-foreground">{run.notes}</p>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>평가 회차 생성</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>종류 *</Label>
                <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="최초">최초평가</SelectItem>
                    <SelectItem value="정기">정기평가</SelectItem>
                    <SelectItem value="수시">수시평가</SelectItem>
                    <SelectItem value="상시">상시평가</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>적용기간 *</Label>
                <Input value={form.period_label} onChange={e => setForm(p => ({ ...p, period_label: e.target.value }))} placeholder="예: 2026년 3월 1주차" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>대상 공정 (쉼표 구분)</Label>
              <Input value={form.target_processes} onChange={e => setForm(p => ({ ...p, target_processes: e.target.value }))} placeholder="배관, 철골, 용접" />
            </div>
            <div className="space-y-1">
              <Label>대상 협력사 (쉼표 구분)</Label>
              <Input value={form.target_contractors} onChange={e => setForm(p => ({ ...p, target_contractors: e.target.value }))} placeholder="(주)대한배관, (주)우리용접" />
            </div>
            <div className="space-y-1">
              <Label>비고</Label>
              <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="특이사항, 메모..." rows={2} />
            </div>
            <Button onClick={handleCreate} disabled={!form.period_label} className="w-full">회차 생성</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AssessmentRuns;
