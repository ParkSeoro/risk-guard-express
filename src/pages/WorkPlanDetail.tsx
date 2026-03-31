import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { WORK_PLAN_TYPES, COMMON_CRANES, calculateRigging } from '@/lib/workPlanTemplates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Save, FileText, Upload, Calculator, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';

const WorkPlanDetail = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [plan, setPlan] = useState<any>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [rigging, setRigging] = useState<any>(null);
  const [riggingCalc, setRiggingCalc] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (planId) loadPlan();
  }, [planId]);

  const loadPlan = async () => {
    const { data, error } = await supabase.from('work_plans').select('*').eq('id', planId).single();
    if (error || !data) {
      toast({ title: '작업계획서를 찾을 수 없습니다.', variant: 'destructive' });
      navigate('/work-plans');
      return;
    }
    setPlan(data);
    setSections(Array.isArray(data.sections) ? data.sections : []);
    setAttachments(Array.isArray(data.attachments) ? data.attachments : []);

    // Load rigging plan if applicable
    const wpType = WORK_PLAN_TYPES.find(t => t.id === data.work_type);
    if (wpType?.hasRiggingPlan) {
      const { data: rp } = await supabase.from('rigging_plans').select('*').eq('work_plan_id', planId).maybeSingle();
      if (rp) {
        setRigging(rp);
        recalcRigging(rp);
      }
    }
    setLoading(false);
  };

  const recalcRigging = (rp: any) => {
    if (rp?.load_weight && rp?.working_radius && rp?.crane_model) {
      const result = calculateRigging({
        loadWeight: Number(rp.load_weight),
        workingRadius: Number(rp.working_radius),
        craneModel: rp.crane_model,
      });
      setRiggingCalc(result);
    }
  };

  const handleSectionChange = (idx: number, content: string) => {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, content } : s));
  };

  const handleSave = async () => {
    if (!planId) return;
    setSaving(true);
    const { error } = await supabase.from('work_plans').update({
      sections,
      attachments,
      updated_at: new Date().toISOString(),
    }).eq('id', planId);

    if (error) {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '저장되었습니다.' });
    }
    setSaving(false);
  };

  const handleSaveRigging = async () => {
    if (!planId || !rigging) return;
    setSaving(true);
    const payload = {
      work_plan_id: planId,
      load_weight: Number(rigging.load_weight) || 0,
      load_description: rigging.load_description || '',
      crane_model: rigging.crane_model || '',
      crane_capacity: Number(rigging.crane_capacity) || 0,
      working_radius: Number(rigging.working_radius) || 0,
      boom_length: Number(rigging.boom_length) || 0,
      lifting_method: rigging.lifting_method || '',
      sling_type: rigging.sling_type || '',
      sling_capacity: Number(rigging.sling_capacity) || 0,
      ground_bearing_capacity: Number(rigging.ground_bearing_capacity) || 0,
      outrigger_setup: rigging.outrigger_setup || '',
      safety_factor: riggingCalc?.safetyFactor || 0,
      calculated_utilization: riggingCalc?.utilization || 0,
      notes: rigging.notes || '',
    };

    if (rigging.id) {
      await supabase.from('rigging_plans').update(payload).eq('id', rigging.id);
    } else {
      const { data } = await supabase.from('rigging_plans').insert(payload).select().single();
      if (data) setRigging(data);
    }
    toast({ title: '리깅플랜이 저장되었습니다.' });
    setSaving(false);
  };

  const handleRiggingChange = (field: string, value: string) => {
    const updated = { ...rigging, [field]: value };
    setRigging(updated);
    recalcRigging(updated);
  };

  const handleAiGenerate = async (sectionIdx: number) => {
    const section = sections[sectionIdx];
    const wpType = WORK_PLAN_TYPES.find(t => t.id === plan?.work_type);
    if (!wpType) return;

    const templateSection = wpType.templateSections.find(ts => ts.key === section.key);
    if (!templateSection?.aiPrompt) {
      toast({ title: 'AI 생성을 지원하지 않는 섹션입니다.', variant: 'destructive' });
      return;
    }

    toast({ title: 'AI 작성 중...', description: '잠시 기다려주세요.' });

    try {
      const { data, error } = await supabase.functions.invoke('generate-risk-ai', {
        body: {
          processName: wpType.name,
          equipment: '',
          workDescription: templateSection.aiPrompt,
          workLocation: '현장',
          workEnvironment: [],
          mode: 'work_plan_section',
          sectionTitle: section.title,
        },
      });

      if (error) throw error;
      
      if (data?.content) {
        handleSectionChange(sectionIdx, data.content);
        toast({ title: 'AI 작성 완료' });
      } else if (data?.items) {
        // Format risk items as text
        const text = (data.items as any[]).map((item: any, i: number) => 
          `${i + 1}. ${item.위험요인 || item.hazard || ''}\n   - 상황: ${item.발생상황 || item.hazard_situation || ''}\n   - 대책: ${item.개선대책 || item.improvement_measure || ''}`
        ).join('\n\n');
        handleSectionChange(sectionIdx, text);
        toast({ title: 'AI 작성 완료' });
      }
    } catch (err: any) {
      toast({ title: 'AI 생성 실패', description: err.message, variant: 'destructive' });
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">로딩 중...</div>;
  if (!plan) return null;

  const wpType = WORK_PLAN_TYPES.find(t => t.id === plan.work_type);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/work-plans')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>작업계획서</span><span>/</span><span>{wpType?.name}</span>
          </div>
          <h1 className="text-lg font-bold">{plan.title}</h1>
        </div>
        <Badge variant="outline" className="text-xs">{plan.status}</Badge>
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1">
          <Save className="h-3.5 w-3.5" /> {saving ? '저장 중...' : '저장'}
        </Button>
      </div>

      {/* Legal Basis */}
      {wpType && (
        <Card className="bg-muted/30">
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">
              <strong>법적근거:</strong> {wpType.legalBasis}
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="sections">
        <TabsList>
          <TabsTrigger value="sections" className="text-xs">내용 작성</TabsTrigger>
          {wpType?.hasRiggingPlan && (
            <TabsTrigger value="rigging" className="text-xs">리깅플랜</TabsTrigger>
          )}
          <TabsTrigger value="attachments" className="text-xs">첨부자료</TabsTrigger>
        </TabsList>

        {/* Sections Tab */}
        <TabsContent value="sections" className="space-y-4 mt-4">
          {sections.map((section, idx) => {
            if (section.type === 'rigging') return null; // Shown in rigging tab
            const templateSection = wpType?.templateSections.find(ts => ts.key === section.key);
            return (
              <Card key={section.key}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{section.title}</CardTitle>
                    {templateSection?.aiPrompt && (
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleAiGenerate(idx)}>
                        <Sparkles className="h-3 w-3" /> AI 작성
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={section.content || ''}
                    onChange={e => handleSectionChange(idx, e.target.value)}
                    placeholder={section.placeholder}
                    rows={6}
                    className="text-sm"
                  />
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Rigging Tab */}
        {wpType?.hasRiggingPlan && (
          <TabsContent value="rigging" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Calculator className="h-4 w-4" /> 리깅플랜 (양중계획)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">인양물 중량 (톤)</Label>
                    <Input
                      type="number"
                      value={rigging?.load_weight || ''}
                      onChange={e => handleRiggingChange('load_weight', e.target.value)}
                      placeholder="예: 5.0"
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">인양물 설명</Label>
                    <Input
                      value={rigging?.load_description || ''}
                      onChange={e => handleRiggingChange('load_description', e.target.value)}
                      placeholder="예: 철골 기둥 H-400"
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">크레인 기종</Label>
                    <Select
                      value={rigging?.crane_model || ''}
                      onValueChange={v => handleRiggingChange('crane_model', v)}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="선택" /></SelectTrigger>
                      <SelectContent>
                        {COMMON_CRANES.map(c => (
                          <SelectItem key={c.model} value={c.model}>
                            {c.model} (최대 {c.maxCapacity}t)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">작업 반경 (m)</Label>
                    <Input
                      type="number"
                      value={rigging?.working_radius || ''}
                      onChange={e => handleRiggingChange('working_radius', e.target.value)}
                      placeholder="예: 15"
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">붐 길이 (m)</Label>
                    <Input
                      type="number"
                      value={rigging?.boom_length || ''}
                      onChange={e => handleRiggingChange('boom_length', e.target.value)}
                      placeholder="예: 30"
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">인양 방식</Label>
                    <Select
                      value={rigging?.lifting_method || ''}
                      onValueChange={v => handleRiggingChange('lifting_method', v)}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="선택" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="single">단일 인양</SelectItem>
                        <SelectItem value="tandem">합동 인양 (2대)</SelectItem>
                        <SelectItem value="tailing">테일링 인양</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">슬링 종류</Label>
                    <Select
                      value={rigging?.sling_type || ''}
                      onValueChange={v => handleRiggingChange('sling_type', v)}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="선택" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="wire_rope">와이어로프</SelectItem>
                        <SelectItem value="chain">체인 슬링</SelectItem>
                        <SelectItem value="web">웨빙 슬링</SelectItem>
                        <SelectItem value="round">라운드 슬링</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">지반 지지력 (t/㎡)</Label>
                    <Input
                      type="number"
                      value={rigging?.ground_bearing_capacity || ''}
                      onChange={e => handleRiggingChange('ground_bearing_capacity', e.target.value)}
                      placeholder="예: 10"
                      className="h-9"
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">아우트리거 설치</Label>
                    <Input
                      value={rigging?.outrigger_setup || ''}
                      onChange={e => handleRiggingChange('outrigger_setup', e.target.value)}
                      placeholder="예: 4본 완전 전개, 철판 깔기 1.5m×1.5m"
                      className="h-9"
                    />
                  </div>
                </div>

                {/* Calculation Result */}
                {riggingCalc && (
                  <>
                    <Separator />
                    <div className={`p-4 rounded-lg border-2 ${riggingCalc.isValid ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30' : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30'}`}>
                      <div className="flex items-center gap-2 mb-3">
                        {riggingCalc.isValid ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-red-600" />
                        )}
                        <span className="font-bold text-sm">{riggingCalc.message}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-3 text-xs">
                        <div>
                          <span className="text-muted-foreground">인양 하중</span>
                          <p className="font-bold">{riggingCalc.requiredCapacity} t</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">가용 정격하중</span>
                          <p className="font-bold">{riggingCalc.availableCapacity.toFixed(1)} t</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">가동률</span>
                          <p className="font-bold">{riggingCalc.utilization.toFixed(1)}%</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">안전율</span>
                          <p className="font-bold">{riggingCalc.safetyFactor.toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">비고</Label>
                  <Textarea
                    value={rigging?.notes || ''}
                    onChange={e => handleRiggingChange('notes', e.target.value)}
                    placeholder="추가 사항을 기재하세요"
                    rows={3}
                    className="text-sm"
                  />
                </div>

                <Button onClick={handleSaveRigging} disabled={saving} className="w-full gap-1">
                  <Save className="h-3.5 w-3.5" /> 리깅플랜 저장
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Attachments Tab */}
        <TabsContent value="attachments" className="space-y-3 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">필수 첨부자료</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {attachments.map((att, idx) => (
                <div key={att.id || idx} className="flex items-center gap-3 p-2 rounded border bg-muted/20">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{att.name}</p>
                    {att.uploaded ? (
                      <p className="text-[10px] text-green-600">✅ 업로드 완료</p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">미첨부</p>
                    )}
                  </div>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                    <Upload className="h-3 w-3" /> 업로드
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default WorkPlanDetail;
