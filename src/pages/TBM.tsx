import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, ClipboardList, Calendar, Users } from 'lucide-react';
import { format } from 'date-fns';
import { getGradeClassName } from '@/lib/riskGrade';

// TBM records are stored as audit_logs with action='TBM' for now
// In production, a dedicated table would be better

const TBM = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [riskItems, setRiskItems] = useState<any[]>([]);
  const [tbmRecords, setTbmRecords] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    location: '',
    supervisor: '',
    attendees: '',
    content: '',
    linkedItems: [] as string[],
  });

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
    supabase.from('risk_items').select('id, process, sub_task, hazard, risk_grade')
      .eq('project_id', selectedProject).then(({ data }) => setRiskItems(data || []));
    supabase.from('audit_logs').select('*')
      .eq('project_id', selectedProject).eq('action', 'TBM')
      .order('created_at', { ascending: false })
      .then(({ data }) => setTbmRecords(data || []));
  }, [selectedProject]);

  const handleCreate = async () => {
    if (!user || !selectedProject) return;
    await supabase.from('audit_logs').insert([{
      user_id: user.id,
      user_name: profile?.display_name || '',
      action: 'TBM',
      target_type: 'tbm_record',
      target_id: selectedProject,
      project_id: selectedProject,
      details: {
        date: form.date,
        location: form.location,
        supervisor: form.supervisor,
        attendees: form.attendees.split(',').map(s => s.trim()).filter(Boolean),
        content: form.content,
        linked_risk_items: form.linkedItems,
      } as any,
    }]);
    toast({ title: 'TBM 기록이 저장되었습니다.' });
    setShowCreate(false);
    setForm({ date: format(new Date(), 'yyyy-MM-dd'), location: '', supervisor: '', attendees: '', content: '', linkedItems: [] });
    // Refresh
    const { data } = await supabase.from('audit_logs').select('*')
      .eq('project_id', selectedProject).eq('action', 'TBM')
      .order('created_at', { ascending: false });
    setTbmRecords(data || []);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6" /> TBM 기록</h1>
          <p className="text-sm text-muted-foreground mt-1">작업 전 안전미팅(Tool Box Meeting) 기록 관리</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-48 text-xs"><SelectValue placeholder="프로젝트" /></SelectTrigger>
            <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" /> TBM 작성
          </Button>
        </div>
      </div>

      {tbmRecords.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">TBM 기록이 없습니다. 'TBM 작성'을 눌러 새 기록을 추가하세요.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {tbmRecords.map(record => {
            const d = record.details || {};
            return (
              <Card key={record.id}>
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{d.date || format(new Date(record.created_at), 'yyyy-MM-dd')}</span>
                        <Badge variant="secondary" className="text-[10px]">{d.location || '—'}</Badge>
                      </div>
                      <p className="text-sm">{d.content || '내용 없음'}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        <span>감독: {d.supervisor || record.user_name} · 참석: {(d.attendees || []).join(', ') || '—'}</span>
                      </div>
                      {(d.linked_risk_items || []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {(d.linked_risk_items as string[]).map((riId: string) => {
                            const ri = riskItems.find(r => r.id === riId);
                            return ri ? (
                              <Badge key={riId} variant="outline" className="text-[10px] gap-1">
                                <span className={`inline-block w-2 h-2 rounded-full ${ri.risk_grade === '상' ? 'bg-destructive' : ri.risk_grade === '중' ? 'bg-warning' : 'bg-success'}`} />
                                {ri.process} - {ri.sub_task || ri.hazard}
                              </Badge>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>TBM 기록 작성</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>일자</Label><Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} /></div>
              <div className="space-y-1"><Label>작업 위치</Label><Input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="A구역 3층" /></div>
            </div>
            <div className="space-y-1"><Label>감독자</Label><Input value={form.supervisor} onChange={e => setForm(p => ({ ...p, supervisor: e.target.value }))} placeholder={profile?.display_name || ''} /></div>
            <div className="space-y-1"><Label>참석자 (쉼표 구분)</Label><Input value={form.attendees} onChange={e => setForm(p => ({ ...p, attendees: e.target.value }))} placeholder="홍길동, 김철수, 이영희" /></div>
            <div className="space-y-1"><Label>안전 교육 내용</Label><Textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} placeholder="오늘 작업의 주요 위험요인 및 안전 대책..." rows={3} /></div>
            <div className="space-y-1">
              <Label>연결 위험성평가 항목 (선택)</Label>
              <div className="max-h-40 overflow-y-auto space-y-1 border rounded-md p-2">
                {riskItems.slice(0, 20).map(ri => (
                  <label key={ri.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 p-1 rounded">
                    <input type="checkbox" checked={form.linkedItems.includes(ri.id)}
                      onChange={e => setForm(p => ({ ...p, linkedItems: e.target.checked ? [...p.linkedItems, ri.id] : p.linkedItems.filter(x => x !== ri.id) }))} />
                    <span className={`inline-block w-2 h-2 rounded-full ${ri.risk_grade === '상' ? 'bg-destructive' : ri.risk_grade === '중' ? 'bg-warning' : 'bg-success'}`} />
                    {ri.process} - {ri.sub_task || ri.hazard}
                  </label>
                ))}
              </div>
            </div>
            <Button onClick={handleCreate} className="w-full">저장</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TBM;
