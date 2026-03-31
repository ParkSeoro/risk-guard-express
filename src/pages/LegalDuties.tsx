import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { LEGAL_DUTY_TEMPLATES, getDutiesForConstructionType, type LegalDutyTemplate } from '@/lib/legalDutyTemplates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Scale, Sparkles, Lock, Plus, Pencil, Trash2 } from 'lucide-react';

const categoryLabels: Record<string, string> = {
  daily: '일일 업무',
  weekly: '주간 업무',
  monthly: '월간 업무',
  event: '수시/법적 필수',
};

const categoryIcons: Record<string, string> = {
  daily: '📋',
  weekly: '📅',
  monthly: '📆',
  event: '⚡',
};

const frequencyOptions = [
  { value: 'daily', label: '매일' },
  { value: 'weekly', label: '매주' },
  { value: 'monthly', label: '매월' },
  { value: 'quarterly', label: '분기' },
  { value: 'event', label: '수시' },
];

const LegalDuties = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [duties, setDuties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editDuty, setEditDuty] = useState<any>(null);
  const [form, setForm] = useState({ duty_name: '', description: '', duty_category: 'daily', frequency: 'daily', legal_basis: '' });

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { if (selectedProject) loadDuties(); }, [selectedProject]);

  const loadProjects = async () => {
    const { data } = await supabase.from('projects').select('id, name').order('created_at', { ascending: false });
    if (data && data.length > 0) { setProjects(data); setSelectedProject(data[0].id); }
    setLoading(false);
  };

  const loadDuties = async () => {
    const { data } = await supabase
      .from('legal_duties')
      .select('*')
      .eq('project_id', selectedProject)
      .order('duty_category', { ascending: true });
    setDuties(data || []);
  };

  const handleAutoGenerate = async () => {
    if (!selectedProject || !user) return;
    setGenerating(true);

    const { data: constructionInfo } = await supabase
      .from('company_construction_info')
      .select('construction_type')
      .eq('project_id', selectedProject);

    const constructionType = constructionInfo?.[0]?.construction_type || '일반';
    const applicableDuties = getDutiesForConstructionType(constructionType);

    const existingNames = duties.map(d => d.duty_name);
    const newDuties = applicableDuties.filter(d => !existingNames.includes(d.name));

    if (newDuties.length === 0) {
      toast({ title: '이미 모든 법적업무가 등록되어 있습니다.' });
      setGenerating(false);
      return;
    }

    const inserts = newDuties.map(d => ({
      project_id: selectedProject,
      duty_name: d.name,
      duty_category: d.category,
      legal_basis: d.legalBasis,
      frequency: d.frequency,
      description: d.description,
      is_active: true,
    }));

    const { error } = await supabase.from('legal_duties').insert(inserts);
    if (error) {
      toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `${newDuties.length}건의 법적업무가 생성되었습니다.` });
      loadDuties();
    }
    setGenerating(false);
  };

  const isSystemDuty = (duty: any) => {
    return LEGAL_DUTY_TEMPLATES.some(t => t.name === duty.duty_name);
  };

  const handleFrequencyChange = async (id: string, newFreq: string) => {
    await supabase.from('legal_duties').update({ frequency: newFreq }).eq('id', id);
    setDuties(prev => prev.map(d => d.id === id ? { ...d, frequency: newFreq } : d));
    toast({ title: '주기가 변경되었습니다.' });
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from('legal_duties').update({ is_active: !current }).eq('id', id);
    setDuties(prev => prev.map(d => d.id === id ? { ...d, is_active: !current } : d));
  };

  // User custom duty CRUD
  const openAdd = () => {
    setForm({ duty_name: '', description: '', duty_category: 'daily', frequency: 'daily', legal_basis: '' });
    setAddOpen(true);
  };

  const handleAddSave = async () => {
    if (!form.duty_name.trim() || !selectedProject) return;
    const { error } = await supabase.from('legal_duties').insert({
      project_id: selectedProject,
      duty_name: form.duty_name,
      description: form.description,
      duty_category: form.duty_category,
      frequency: form.frequency,
      legal_basis: form.legal_basis,
      is_active: true,
    });
    if (error) { toast({ title: '추가 실패', variant: 'destructive' }); return; }
    toast({ title: '업무가 추가되었습니다.' });
    setAddOpen(false);
    loadDuties();
  };

  const openEdit = (duty: any) => {
    setEditDuty(duty);
    setForm({ duty_name: duty.duty_name, description: duty.description || '', duty_category: duty.duty_category, frequency: duty.frequency, legal_basis: duty.legal_basis || '' });
  };

  const handleEditSave = async () => {
    if (!editDuty) return;
    await supabase.from('legal_duties').update({
      duty_name: form.duty_name,
      description: form.description,
      duty_category: form.duty_category,
      frequency: form.frequency,
      legal_basis: form.legal_basis,
    }).eq('id', editDuty.id);
    toast({ title: '수정되었습니다.' });
    setEditDuty(null);
    loadDuties();
  };

  const handleDeleteDuty = async (id: string) => {
    if (!confirm('이 업무를 삭제하시겠습니까?')) return;
    await supabase.from('legal_duties').delete().eq('id', id);
    toast({ title: '삭제되었습니다.' });
    setDuties(prev => prev.filter(d => d.id !== id));
  };

  const categories = ['daily', 'weekly', 'monthly', 'event'];

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">로딩 중...</div>;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Scale className="h-5 w-5" /> 법적업무 관리
          </h1>
          <p className="text-xs text-muted-foreground mt-1">산업안전보건법 + KOSHA 기준 안전관리자 법정 업무</p>
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
          <Button size="sm" variant="outline" onClick={openAdd} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> 업무 추가
          </Button>
          <Button size="sm" onClick={handleAutoGenerate} disabled={generating} className="gap-1">
            <Sparkles className="h-3.5 w-3.5" /> {generating ? '생성 중...' : '자동 생성'}
          </Button>
        </div>
      </div>

      {duties.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Scale className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">등록된 법적업무가 없습니다.</p>
            <p className="text-xs mt-1">"자동 생성" 버튼을 눌러 법정 업무를 생성하세요.</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="daily">
          <TabsList className="flex-wrap">
            {categories.map(cat => {
              const count = duties.filter(d => d.duty_category === cat).length;
              if (count === 0) return null;
              return (
                <TabsTrigger key={cat} value={cat} className="text-xs gap-1">
                  <span>{categoryIcons[cat]}</span> {categoryLabels[cat]}
                  <Badge variant="secondary" className="text-[9px] h-4 ml-1">{count}</Badge>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {categories.map(cat => (
            <TabsContent key={cat} value={cat} className="space-y-2 mt-4">
              {duties.filter(d => d.duty_category === cat).map(duty => {
                const isSys = isSystemDuty(duty);
                return (
                  <Card key={duty.id} className={!duty.is_active ? 'opacity-50' : ''}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-medium">{duty.duty_name}</h3>
                            {isSys && (
                              <Badge variant="outline" className="text-[9px] h-4 gap-0.5">
                                <Lock className="h-2.5 w-2.5" /> 법정
                              </Badge>
                            )}
                            {duty.is_active ? (
                              <Badge variant="outline" className="text-[9px] h-4 text-green-600 border-green-300">활성</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] h-4 text-muted-foreground">비활성</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{duty.description}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">📜 {duty.legal_basis}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Frequency selector - always editable */}
                          <Select value={duty.frequency} onValueChange={v => handleFrequencyChange(duty.id, v)}>
                            <SelectTrigger className="h-7 w-20 text-[10px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {frequencyOptions.map(f => (
                                <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggleActive(duty.id, duty.is_active)}>
                            {duty.is_active ? '비활성화' : '활성화'}
                          </Button>
                          {/* Custom duties can be edited/deleted */}
                          {!isSys && (
                            <>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(duty)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteDuty(duty.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>업무 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">업무명 *</Label>
              <Input value={form.duty_name} onChange={e => setForm(p => ({ ...p, duty_name: e.target.value }))} placeholder="업무명 입력" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">설명</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">분류</Label>
                <Select value={form.duty_category} onValueChange={v => setForm(p => ({ ...p, duty_category: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c} value={c}>{categoryLabels[c]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">주기</Label>
                <Select value={form.frequency} onValueChange={v => setForm(p => ({ ...p, frequency: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {frequencyOptions.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">법적 근거</Label>
              <Input value={form.legal_basis} onChange={e => setForm(p => ({ ...p, legal_basis: e.target.value }))} placeholder="선택 입력" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddSave} disabled={!form.duty_name.trim()}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog (custom duties only) */}
      <Dialog open={!!editDuty} onOpenChange={open => { if (!open) setEditDuty(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>업무 수정</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">업무명 *</Label>
              <Input value={form.duty_name} onChange={e => setForm(p => ({ ...p, duty_name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">설명</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">분류</Label>
                <Select value={form.duty_category} onValueChange={v => setForm(p => ({ ...p, duty_category: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c} value={c}>{categoryLabels[c]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">주기</Label>
                <Select value={form.frequency} onValueChange={v => setForm(p => ({ ...p, frequency: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {frequencyOptions.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">법적 근거</Label>
              <Input value={form.legal_basis} onChange={e => setForm(p => ({ ...p, legal_basis: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleEditSave}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LegalDuties;
