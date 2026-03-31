import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { WORK_PLAN_TYPES, COMMON_CRANES, calculateRigging } from '@/lib/workPlanTemplates';
import { generateAttachments, type AttachmentItem } from '@/lib/attachmentTemplates';
import StructuredSectionForm, { validateSection } from '@/components/work-plan/StructuredSectionForm';
import AttachmentChecklist from '@/components/work-plan/AttachmentChecklist';
import EquipmentManager from '@/components/equipment/EquipmentManager';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Save, FileText, Upload, Calculator, CheckCircle2, AlertTriangle, Sparkles, Printer, Download, SendHorizontal, Loader2, Wrench } from 'lucide-react';

const SLING_ANGLE_FACTORS: Record<string, number> = {
  '0': 1.0, '30': 1.16, '45': 1.41, '60': 2.0,
};

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
  const [slingAngle, setSlingAngle] = useState('0');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [autoSaveTimer, setAutoSaveTimer] = useState<NodeJS.Timeout | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (planId) loadPlan();
  }, [planId]);

  // Auto-save every 30 seconds if dirty
  useEffect(() => {
    if (isDirty && !saving) {
      const timer = setTimeout(() => {
        handleSave(true);
      }, 30000);
      setAutoSaveTimer(timer);
      return () => clearTimeout(timer);
    }
  }, [isDirty, sections, attachments]);

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

    const wpType = WORK_PLAN_TYPES.find(t => t.id === data.work_type);
    if (wpType?.hasRiggingPlan) {
      const { data: rp } = await supabase.from('rigging_plans').select('*').eq('work_plan_id', planId).maybeSingle();
      if (rp) {
        setRigging(rp);
        recalcRigging(rp, '0');
      }
    }
    setLoading(false);
  };

  const recalcRigging = (rp: any, angle: string) => {
    if (rp?.load_weight && rp?.working_radius && rp?.crane_model) {
      const angleFactor = SLING_ANGLE_FACTORS[angle] || 1.0;
      const effectiveLoad = Number(rp.load_weight) * angleFactor;
      const result = calculateRigging({
        loadWeight: effectiveLoad,
        workingRadius: Number(rp.working_radius),
        craneModel: rp.crane_model,
      });
      // Override with angle-adjusted values
      const safetyFactor = result.availableCapacity / effectiveLoad;
      let message = result.message;
      let warningLevel = 'safe';
      if (safetyFactor < 1.0) {
        message = `🚫 작업금지! 안전율 ${safetyFactor.toFixed(2)} < 1.0 (정격하중 초과)`;
        warningLevel = 'danger';
      } else if (safetyFactor < 1.25) {
        message = `⚠️ 경고! 안전율 ${safetyFactor.toFixed(2)} < 1.25 (위험 범위)`;
        warningLevel = 'warning';
      } else {
        message = `✅ 안전 (안전율 ${safetyFactor.toFixed(2)}, 가동률 ${result.utilization.toFixed(0)}%)`;
        warningLevel = 'safe';
      }
      setRiggingCalc({ ...result, safetyFactor, effectiveLoad, angleFactor, message, warningLevel });
    }
  };

  const handleSectionChange = (idx: number, content: string) => {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, content } : s));
    setIsDirty(true);
  };

  const handleSave = async (isAutoSave = false) => {
    if (!planId) return;
    setSaving(true);
    const { error } = await supabase.from('work_plans').update({
      sections,
      attachments,
      updated_at: new Date().toISOString(),
    }).eq('id', planId);

    if (error) {
      if (!isAutoSave) toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    } else {
      setIsDirty(false);
      if (!isAutoSave) toast({ title: '저장되었습니다.' });
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
    recalcRigging(updated, slingAngle);
  };

  const handleSlingAngleChange = (angle: string) => {
    setSlingAngle(angle);
    if (rigging) recalcRigging(rigging, angle);
  };

  const handleAiGenerate = async (sectionIdx: number) => {
    const section = sections[sectionIdx];
    const wpType = WORK_PLAN_TYPES.find(t => t.id === plan?.work_type);
    if (!wpType) return;

    setAiLoading(section.key);
    console.log('[WorkPlan AI] 요청 시작:', section.key, section.title);

    try {
      const { data, error } = await supabase.functions.invoke('generate-risk-ai', {
        body: {
          process_name: wpType.name,
          equipment: '',
          work_description: section.title + ' 작성',
          work_location: '현장',
          work_environment: [],
          mode: 'work_plan_section',
          section_key: section.key,
          section_title: section.title,
        },
      });

      console.log('[WorkPlan AI] 응답:', data);

      if (error) {
        console.error('[WorkPlan AI] Error:', error);
        throw error;
      }

      if (data?.structured) {
        // Structured data from AI
        handleSectionChange(sectionIdx, JSON.stringify(data.structured));
        toast({ title: 'AI 작성 완료 (구조화 데이터)' });
      } else if (data?.content) {
        handleSectionChange(sectionIdx, data.content);
        toast({ title: 'AI 작성 완료' });
      } else if (data?.items) {
        // Convert risk items to structured risk format
        const risks = (data.items as any[]).map((item: any) => ({
          hazard: item.hazard || item['위험요인'] || '',
          situation: item.hazard_situation || item['발생상황'] || '',
          measure: item.improvement_measure || item['개선대책'] || '',
          severity: item.likelihood_grade || item['위험도'] || '중',
        }));
        handleSectionChange(sectionIdx, JSON.stringify(risks));
        toast({ title: 'AI 작성 완료 (위험요인)' });
      } else {
        toast({ title: 'AI 응답이 비어있습니다. 다시 시도해주세요.', variant: 'destructive' });
      }
    } catch (err: any) {
      console.error('[WorkPlan AI] 실패:', err);
      toast({ title: 'AI 생성 실패', description: '다시 시도해주세요. ' + (err?.message || ''), variant: 'destructive' });
    } finally {
      setAiLoading(null);
    }
  };

  const handleValidate = (): boolean => {
    const errors: Record<string, string[]> = {};
    let hasError = false;
    sections.forEach(s => {
      if (s.type === 'rigging') return;
      const errs = validateSection(s.key, s.content || '');
      if (errs.length > 0) {
        errors[s.key] = errs;
        hasError = true;
      }
    });
    setValidationErrors(errors);
    return !hasError;
  };

  const handleSubmitApproval = async () => {
    if (!handleValidate()) {
      toast({ title: '필수 입력 항목을 확인해주세요.', variant: 'destructive' });
      return;
    }
    await handleSave();
    // Update status to 검토중
    await supabase.from('work_plans').update({ status: '검토중' }).eq('id', planId);
    setPlan((prev: any) => ({ ...prev, status: '검토중' }));
    toast({ title: '결재 상신이 완료되었습니다.' });
  };

  const handlePrint = () => window.print();

  const handleExportExcel = () => {
    toast({ title: '엑셀 내보내기 준비 중...', description: '곧 지원됩니다.' });
  };

  const handleFileUpload = async (attIdx: number, file: File) => {
    if (!planId || !user) return;
    const path = `work-plans/${planId}/${attIdx}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from('attachments').upload(path, file, { upsert: true });
    if (uploadError) {
      toast({ title: '업로드 실패', description: uploadError.message, variant: 'destructive' });
      return;
    }
    const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path);
    const updated = attachments.map((a, i) => i === attIdx ? { ...a, uploaded: true, fileUrl: urlData.publicUrl } : a);
    setAttachments(updated);
    setIsDirty(true);
    toast({ title: '업로드 완료' });
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">로딩 중...</div>;
  if (!plan) return null;

  const wpType = WORK_PLAN_TYPES.find(t => t.id === plan.work_type);
  const statusColor = {
    '작성중': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    '검토중': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    '승인완료': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    '반려': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  }[plan.status] || '';

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
        <div className="flex items-center gap-1.5">
          {isDirty && <span className="text-[10px] text-muted-foreground">미저장</span>}
          <Badge className={`text-[10px] ${statusColor}`}>{plan.status}</Badge>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => handleSave()} disabled={saving} className="gap-1">
          <Save className="h-3.5 w-3.5" /> {saving ? '저장 중...' : '저장'}
        </Button>
        <Button size="sm" variant="outline" onClick={handlePrint} className="gap-1">
          <Printer className="h-3.5 w-3.5" /> 인쇄
        </Button>
        <Button size="sm" variant="outline" onClick={handleExportExcel} className="gap-1">
          <Download className="h-3.5 w-3.5" /> 엑셀
        </Button>
        {plan.status === '작성중' && (
          <Button size="sm" variant="default" onClick={handleSubmitApproval} className="gap-1 ml-auto">
            <SendHorizontal className="h-3.5 w-3.5" /> 결재 상신
          </Button>
        )}
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
          <TabsTrigger value="equipment" className="text-xs gap-1"><Wrench className="h-3 w-3" />장비</TabsTrigger>
          <TabsTrigger value="attachments" className="text-xs">첨부자료</TabsTrigger>
        </TabsList>

        {/* Sections Tab */}
        <TabsContent value="sections" className="space-y-4 mt-4">
          {sections.map((section, idx) => {
            if (section.type === 'rigging') return null;
            const templateSection = wpType?.templateSections.find(ts => ts.key === section.key);
            const sectionErrors = validationErrors[section.key];
            return (
              <Card key={section.key} className={sectionErrors ? 'border-destructive' : ''}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{section.title}</CardTitle>
                    <div className="flex items-center gap-1">
                      {templateSection?.aiPrompt && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => handleAiGenerate(idx)}
                          disabled={aiLoading === section.key}
                        >
                          {aiLoading === section.key ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                          AI 작성
                        </Button>
                      )}
                    </div>
                  </div>
                  {sectionErrors && (
                    <div className="mt-1">
                      {sectionErrors.map((e, i) => (
                        <p key={i} className="text-[10px] text-destructive">{e}</p>
                      ))}
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <StructuredSectionForm
                    sectionKey={section.key}
                    workType={plan.work_type}
                    value={section.content || ''}
                    onChange={content => handleSectionChange(idx, content)}
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
                  <Calculator className="h-4 w-4" /> 리깅플랜 (양중계획) - 자동 안전율 계산
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">인양물 중량 (톤) *</Label>
                    <Input type="number" value={rigging?.load_weight || ''} onChange={e => handleRiggingChange('load_weight', e.target.value)} placeholder="예: 5.0" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">인양물 설명</Label>
                    <Input value={rigging?.load_description || ''} onChange={e => handleRiggingChange('load_description', e.target.value)} placeholder="예: 철골 기둥 H-400" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">크레인 기종 *</Label>
                    <Select value={rigging?.crane_model || ''} onValueChange={v => handleRiggingChange('crane_model', v)}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="선택" /></SelectTrigger>
                      <SelectContent>
                        {COMMON_CRANES.map(c => (
                          <SelectItem key={c.model} value={c.model}>{c.model} (최대 {c.maxCapacity}t)</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">작업 반경 (m) *</Label>
                    <Input type="number" value={rigging?.working_radius || ''} onChange={e => handleRiggingChange('working_radius', e.target.value)} placeholder="예: 15" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">붐 길이 (m)</Label>
                    <Input type="number" value={rigging?.boom_length || ''} onChange={e => handleRiggingChange('boom_length', e.target.value)} placeholder="예: 30" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">인양 방식</Label>
                    <Select value={rigging?.lifting_method || ''} onValueChange={v => handleRiggingChange('lifting_method', v)}>
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
                    <Select value={rigging?.sling_type || ''} onValueChange={v => handleRiggingChange('sling_type', v)}>
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
                    <Label className="text-xs">줄걸이 각도 (°)</Label>
                    <Select value={slingAngle} onValueChange={handleSlingAngleChange}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">0° (수직)</SelectItem>
                        <SelectItem value="30">30° (계수 1.16)</SelectItem>
                        <SelectItem value="45">45° (계수 1.41)</SelectItem>
                        <SelectItem value="60">60° (계수 2.0) ⚠️</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">지반 지지력 (t/㎡)</Label>
                    <Input type="number" value={rigging?.ground_bearing_capacity || ''} onChange={e => handleRiggingChange('ground_bearing_capacity', e.target.value)} placeholder="예: 10" className="h-9" />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">아우트리거 설치</Label>
                    <Input value={rigging?.outrigger_setup || ''} onChange={e => handleRiggingChange('outrigger_setup', e.target.value)} placeholder="예: 4본 완전 전개, 철판 깔기 1.5m×1.5m" className="h-9" />
                  </div>
                </div>

                {/* Calculation Result */}
                {riggingCalc && (
                  <>
                    <Separator />
                    <div className={`p-4 rounded-lg border-2 ${
                      riggingCalc.warningLevel === 'danger' ? 'border-red-500 bg-red-50 dark:bg-red-950/30' :
                      riggingCalc.warningLevel === 'warning' ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/30' :
                      'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30'
                    }`}>
                      <div className="flex items-center gap-2 mb-3">
                        {riggingCalc.warningLevel === 'danger' ? (
                          <AlertTriangle className="h-5 w-5 text-red-600 animate-pulse" />
                        ) : riggingCalc.warningLevel === 'warning' ? (
                          <AlertTriangle className="h-5 w-5 text-yellow-600" />
                        ) : (
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                        )}
                        <span className="font-bold text-sm">{riggingCalc.message}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-3 text-xs">
                        <div>
                          <span className="text-muted-foreground">인양 하중</span>
                          <p className="font-bold">{riggingCalc.requiredCapacity?.toFixed(1)} t</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">실효 하중<br/>(각도 보정)</span>
                          <p className="font-bold">{riggingCalc.effectiveLoad?.toFixed(1)} t</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">가용 정격하중</span>
                          <p className="font-bold">{riggingCalc.availableCapacity?.toFixed(1)} t</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">가동률</span>
                          <p className="font-bold">{riggingCalc.utilization?.toFixed(1)}%</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">안전율</span>
                          <p className={`font-bold ${riggingCalc.safetyFactor < 1.0 ? 'text-red-600' : riggingCalc.safetyFactor < 1.25 ? 'text-yellow-600' : 'text-green-600'}`}>
                            {riggingCalc.safetyFactor?.toFixed(2)}
                          </p>
                        </div>
                      </div>
                      {Number(slingAngle) > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-2">
                          ※ 줄걸이 각도 {slingAngle}° 적용 (하중계수 ×{SLING_ANGLE_FACTORS[slingAngle]})
                        </p>
                      )}
                    </div>
                  </>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">비고</Label>
                  <Textarea value={rigging?.notes || ''} onChange={e => handleRiggingChange('notes', e.target.value)} placeholder="추가 사항을 기재하세요" rows={3} className="text-sm" />
                </div>

                <Button onClick={handleSaveRigging} disabled={saving} className="w-full gap-1">
                  <Save className="h-3.5 w-3.5" /> 리깅플랜 저장
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Equipment Tab */}
        <TabsContent value="equipment" className="space-y-3 mt-4">
          {plan?.project_id && (
            <EquipmentManager
              projectId={plan.project_id}
              companyId={plan.company_id}
              selectable
              onSelect={(eq) => {
                if (rigging) {
                  handleRiggingChange('crane_model', eq.name);
                }
              }}
            />
          )}
        </TabsContent>

        {/* Attachments Tab */}
        <TabsContent value="attachments" className="space-y-3 mt-4">
          <AttachmentChecklist
            workType={plan.work_type}
            attachments={attachments.map((a: any, i: number) => ({
              key: a.key || `att_${i}`,
              uploaded: !!a.uploaded,
              fileUrl: a.fileUrl,
            }))}
            onAttachmentsChange={(newAtts) => {
              setAttachments(newAtts.map((a, i) => ({
                ...a,
                name: a.key,
                id: `att_${i}`,
              })));
              setIsDirty(true);
            }}
            onUpload={(idx, file) => handleFileUpload(idx, file)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default WorkPlanDetail;
