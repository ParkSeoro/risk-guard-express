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
import { Separator } from '@/components/ui/separator';
import { Scale, Calendar, Sparkles, Check, Clock } from 'lucide-react';

const categoryLabels: Record<string, string> = {
  daily: '일일 업무',
  weekly: '주간 업무',
  monthly: '월간 업무',
  quarterly: '분기 업무',
  annually: '연간 업무',
  event: '수시 업무',
};

const categoryIcons: Record<string, string> = {
  daily: '📋',
  weekly: '📅',
  monthly: '📆',
  quarterly: '📊',
  annually: '📁',
  event: '⚡',
};

const LegalDuties = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [duties, setDuties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) loadDuties();
  }, [selectedProject]);

  const loadProjects = async () => {
    const { data } = await supabase.from('projects').select('id, name').order('created_at', { ascending: false });
    if (data && data.length > 0) {
      setProjects(data);
      setSelectedProject(data[0].id);
    }
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

    // Get construction info for the project
    const { data: constructionInfo } = await supabase
      .from('company_construction_info')
      .select('construction_type')
      .eq('project_id', selectedProject);

    const constructionType = constructionInfo?.[0]?.construction_type || '일반';
    const applicableDuties = getDutiesForConstructionType(constructionType);

    // Check existing duties to avoid duplicates
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

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from('legal_duties').update({ is_active: !current }).eq('id', id);
    setDuties(prev => prev.map(d => d.id === id ? { ...d, is_active: !current } : d));
  };

  const categories = ['daily', 'weekly', 'monthly', 'quarterly', 'annually', 'event'];

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">로딩 중...</div>;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Scale className="h-5 w-5" /> 법적업무 관리
          </h1>
          <p className="text-xs text-muted-foreground mt-1">산업안전보건법 기준 안전관리자 법정 업무</p>
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
              {duties.filter(d => d.duty_category === cat).map(duty => (
                <Card key={duty.id} className={!duty.is_active ? 'opacity-50' : ''}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-medium">{duty.duty_name}</h3>
                          {duty.is_active ? (
                            <Badge variant="outline" className="text-[9px] h-4 text-green-600 border-green-300">활성</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] h-4 text-muted-foreground">비활성</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{duty.description}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">📜 {duty.legal_basis}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => toggleActive(duty.id, duty.is_active)}
                      >
                        {duty.is_active ? '비활성화' : '활성화'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
};

export default LegalDuties;
