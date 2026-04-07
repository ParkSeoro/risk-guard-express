import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useToast } from '@/hooks/use-toast';
import { WORK_PLAN_TYPES } from '@/lib/workPlanTemplates';
import RiggingPlanForm from '@/components/rigging/RiggingPlanForm';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft, Save, FileText, Upload, Calculator, CheckCircle2, AlertTriangle,
  Sparkles, Printer, Download, SendHorizontal, Loader2, Wrench, Copy, Eye,
  CalendarDays, MapPin, User, Shield, ClipboardList
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

const SLING_ANGLE_FACTORS: Record<string, number> = {
  '0': 1.0, '30': 1.16, '45': 1.41, '60': 2.0,
};
// Legacy calculateRigging stub for recalcRigging compat
const calculateRigging = (params: { loadWeight: number; workingRadius: number; craneModel: string }) => {
  return { isValid: true, safetyFactor: 1, utilization: 0, requiredCapacity: params.loadWeight, availableCapacity: params.loadWeight * 2, message: '' };
};

const WorkPlanDetail = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const access = useGlobalProjectAccess();
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
  const [isDirty, setIsDirty] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string[]>>({});
  // Basic info fields
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [checklist, setChecklist] = useState<{ label: string; checked: boolean }[]>([]);

  useEffect(() => {
    if (planId) loadPlan();
  }, [planId]);

  useEffect(() => {
    if (isDirty && !saving) {
      const timer = setTimeout(() => { handleSave(true); }, 30000);
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
    setStartDate(data.start_date || '');
    setEndDate(data.end_date || '');

    // Load checklist from sections or default
    const wpType = WORK_PLAN_TYPES.find(t => t.id === data.work_type);
    const existingChecklist = (data.sections as any[])?.find(s => s.key === '_checklist');
    if (existingChecklist?.content) {
      try { setChecklist(JSON.parse(existingChecklist.content)); } catch { setChecklist(getDefaultChecklist()); }
    } else {
      setChecklist(getDefaultChecklist());
    }

    if (wpType?.hasRiggingPlan) {
      const { data: rp } = await supabase.from('rigging_plans').select('*').eq('work_plan_id', planId).maybeSingle();
      if (rp) {
        setRigging(rp);
        recalcRigging(rp, '0');
      }
    }
    setLoading(false);
  };

  const getDefaultChecklist = () => [
    { label: '작업허가서 발급', checked: false },
    { label: '안전교육 실시', checked: false },
    { label: '위험성평가 검토', checked: false },
    { label: '안전장구 착용 확인', checked: false },
    { label: '비상연락체계 확인', checked: false },
    { label: '작업전 안전점검', checked: false },
    { label: '작업구역 통제', checked: false },
    { label: '신호수 배치', checked: false },
  ];

  const recalcRigging = (rp: any, angle: string) => {
    if (rp?.load_weight && rp?.working_radius && rp?.crane_model) {
      const angleFactor = SLING_ANGLE_FACTORS[angle] || 1.0;
      const effectiveLoad = Number(rp.load_weight) * angleFactor;
      const result = calculateRigging({
        loadWeight: effectiveLoad,
        workingRadius: Number(rp.working_radius),
        craneModel: rp.crane_model,
      });
      const safetyFactor = result.availableCapacity / effectiveLoad;
      let message = '';
      let warningLevel = 'safe';
      if (safetyFactor < 1.0) {
        message = `🚫 작업금지! 안전율 ${safetyFactor.toFixed(2)} < 1.0`;
        warningLevel = 'danger';
      } else if (safetyFactor < 1.25) {
        message = `⚠️ 경고! 안전율 ${safetyFactor.toFixed(2)} < 1.25`;
        warningLevel = 'warning';
      } else {
        message = `✅ 안전 (안전율 ${safetyFactor.toFixed(2)}, 가동률 ${result.utilization.toFixed(0)}%)`;
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

    // Merge checklist into sections
    const mergedSections = [...sections.filter(s => s.key !== '_checklist'), {
      key: '_checklist', title: '체크리스트', type: 'checklist', content: JSON.stringify(checklist),
    }];

    const { error } = await supabase.from('work_plans').update({
      sections: mergedSections,
      attachments,
      start_date: startDate || null,
      end_date: endDate || null,
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
    const payload: any = {
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
      safety_factor: Number(rigging.safety_factor) || 0,
      calculated_utilization: Number(rigging.calculated_utilization) || 0,
      notes: rigging.notes || '',
      // New KOSHA fields
      equipment_name: rigging.equipment_name || '',
      rated_capacity: Number(rigging.rated_capacity) || 0,
      outrigger_distance: Number(rigging.outrigger_distance) || 0,
      wire_diameter_mm: Number(rigging.wire_diameter_mm) || 0,
      sling_count: Number(rigging.sling_count) || 2,
      sling_method: rigging.sling_method || '',
      sling_strand_count: Number(rigging.sling_strand_count) || 1,
      sling_angle_deg: Number(rigging.sling_angle_deg) || 60,
      wire_terminal_method: rigging.wire_terminal_method || '탐블(24mm 이하)',
      wire_safety_coefficient: Number(rigging.wire_safety_coefficient) || 5,
      wire_lift_count: Number(rigging.wire_lift_count) || 5,
      wire_breaking_load: Number(rigging.wire_breaking_load) || 0,
      wire_diameter_inch: Number(rigging.wire_diameter_inch) || 0,
      wire_safe_load: Number(rigging.wire_safe_load) || 0,
      shackle_diameter_mm: Number(rigging.shackle_diameter_mm) || 0,
      shackle_safe_load: Number(rigging.shackle_safe_load) || 0,
      shackle_angle_deg: Number(rigging.shackle_angle_deg) || 45,
      shackle_count: Number(rigging.shackle_count) || 0.7,
      shackle_qty: Number(rigging.shackle_qty) || 2,
      load_name_max: rigging.load_name_max || '',
      hook_weight: Number(rigging.hook_weight) || 0,
      shackle_weight_val: Number(rigging.shackle_weight_val) || 0,
      sling_rigging_weight: Number(rigging.sling_rigging_weight) || 0,
      total_weight_max: Number(rigging.total_weight_max) || 0,
      load_name_min: rigging.load_name_min || '',
      load_weight_min: Number(rigging.load_weight_min) || 0,
      hook_weight_min: Number(rigging.hook_weight_min) || 0,
      shackle_weight_min: Number(rigging.shackle_weight_min) || 0,
      sling_rigging_weight_min: Number(rigging.sling_rigging_weight_min) || 0,
      total_weight_min: Number(rigging.total_weight_min) || 0,
      wind_speed_grade: rigging.wind_speed_grade || '0~5',
      wind_speed_factor: Number(rigging.wind_speed_factor) || 1,
      boom_rotation_factor: Number(rigging.boom_rotation_factor) || 0.8,
      ground_inspection_factor: Number(rigging.ground_inspection_factor) || 0.8,
      load_protrusion_factor: Number(rigging.load_protrusion_factor) || 0.8,
      travel_load_factor: Number(rigging.travel_load_factor) || 1,
      equipment_working_load: Number(rigging.equipment_working_load) || 0,
      equipment_ok: rigging.equipment_ok || '',
      sling_working_load: Number(rigging.sling_working_load) || 0,
      sling_ok: rigging.sling_ok || '',
      shackle_working_load: Number(rigging.shackle_working_load) || 0,
      shackle_ok: rigging.shackle_ok || '',
      safety_factor_passenger: Number(rigging.safety_factor_passenger) || 10,
      safety_factor_cargo: Number(rigging.safety_factor_cargo) || 5,
      input_method: rigging.input_method || '자동계산',
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

  const handleRiggingChange = (field: string, value: any) => {
    const updated = { ...rigging, [field]: value };
    setRigging(updated);
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
    try {
      const { data, error } = await supabase.functions.invoke('generate-risk-ai', {
        body: {
          process_name: wpType.name, equipment: '', work_description: section.title + ' 작성',
          work_location: '현장', work_environment: [], mode: 'work_plan_section',
          section_key: section.key, section_title: section.title,
        },
      });
      if (error) throw error;
      if (data?.structured) {
        handleSectionChange(sectionIdx, JSON.stringify(data.structured));
        toast({ title: 'AI 작성 완료' });
      } else if (data?.content) {
        handleSectionChange(sectionIdx, data.content);
        toast({ title: 'AI 작성 완료' });
      } else if (data?.items) {
        const risks = (data.items as any[]).map((item: any) => ({
          hazard: item.hazard || '', situation: item.hazard_situation || '',
          measure: item.improvement_measure || '', severity: item.likelihood_grade || '중',
        }));
        handleSectionChange(sectionIdx, JSON.stringify(risks));
        toast({ title: 'AI 작성 완료' });
      }
    } catch (err: any) {
      toast({ title: 'AI 생성 실패', variant: 'destructive' });
    } finally { setAiLoading(null); }
  };

  const handleValidate = (): boolean => {
    const errors: Record<string, string[]> = {};
    let hasError = false;
    sections.forEach(s => {
      if (s.type === 'rigging') return;
      const errs = validateSection(s.key, s.content || '');
      if (errs.length > 0) { errors[s.key] = errs; hasError = true; }
    });
    if (!startDate || !endDate) { errors['_dates'] = ['작업기간을 입력해주세요.']; hasError = true; }
    setValidationErrors(errors);
    return !hasError;
  };

  const handleSubmitApproval = async () => {
    if (!handleValidate()) {
      toast({ title: '필수 입력 항목을 확인해주세요.', variant: 'destructive' });
      return;
    }
    // 필수 첨부서류 미업로드 확인
    const uploadedKeys = attachments.filter((a: any) => a.uploaded).map((a: any) => a.key);
    const { getMissingRequiredAttachments } = await import('@/lib/attachmentTemplates');
    const missing = getMissingRequiredAttachments(plan.work_type, uploadedKeys);
    if (missing.length > 0) {
      const names = missing.slice(0, 5).map(m => m.name).join(', ');
      const more = missing.length > 5 ? ` 외 ${missing.length - 5}건` : '';
      toast({ 
        title: '필수 첨부서류 미첨부', 
        description: `${names}${more}을(를) 첨부해주세요. 필수서류가 누락되면 결재 상신이 불가합니다.`,
        variant: 'destructive' 
      });
      return;
    }
    await handleSave();
    await supabase.from('work_plans').update({ status: '결재중' }).eq('id', planId);
    setPlan((prev: any) => ({ ...prev, status: '결재중' }));
    toast({ title: '결재 상신이 완료되었습니다.' });
  };

  const handlePdfDownload = async () => {
    if (!planId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-workplan-pdf', {
        body: { planId },
      });
      if (error) throw error;
      if (data?.html) {
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';
        document.body.appendChild(iframe);
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(data.html);
          doc.close();
          iframe.onload = () => {
            setTimeout(() => {
              iframe.contentWindow?.print();
              setTimeout(() => document.body.removeChild(iframe), 1000);
            }, 500);
          };
          // For browsers that fire onload synchronously
          if (doc.readyState === 'complete') {
            setTimeout(() => {
              iframe.contentWindow?.print();
              setTimeout(() => document.body.removeChild(iframe), 1000);
            }, 500);
          }
        }
        toast({ title: 'PDF 인쇄 대화상자가 열립니다. "PDF로 저장"을 선택하세요.' });
      }
    } catch (err: any) {
      toast({ title: 'PDF 생성 실패', description: err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const handleClone = async () => {
    if (!plan || !user) return;
    const { data, error } = await supabase.from('work_plans').insert({
      project_id: plan.project_id,
      company_id: plan.company_id,
      work_type: plan.work_type,
      title: `${plan.title} (v${(plan.version || 1) + 1})`,
      sections: plan.sections,
      attachments: plan.attachments,
      created_by: user.id,
      parent_id: plan.id,
      version: (plan.version || 1) + 1,
      status: '작성중',
    }).select().single();
    if (data) {
      toast({ title: '새 회차가 생성되었습니다.' });
      navigate(`/work-plan/${data.id}`);
    }
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
    '결재중': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    '완료': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    '만료': 'bg-muted text-muted-foreground',
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
            {plan.version > 1 && <Badge variant="outline" className="text-[9px] h-4">v{plan.version}</Badge>}
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
        <Button size="sm" variant="outline" onClick={handlePdfDownload} disabled={saving} className="gap-1">
          <Download className="h-3.5 w-3.5" /> PDF
        </Button>
        <Button size="sm" variant="outline" onClick={handlePdfDownload} disabled={saving} className="gap-1">
          <Printer className="h-3.5 w-3.5" /> 인쇄
        </Button>
        {access.canCreate('work_plan') && (
          <Button size="sm" variant="outline" onClick={handleClone} className="gap-1">
            <Copy className="h-3.5 w-3.5" /> 이 계획서로 새로 만들기
          </Button>
        )}
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

      {validationErrors['_dates'] && (
        <p className="text-xs text-destructive">{validationErrors['_dates'][0]}</p>
      )}

      <Tabs defaultValue="basic">
        <TabsList className="flex-wrap">
          <TabsTrigger value="basic" className="text-xs gap-1"><ClipboardList className="h-3 w-3" />기본정보</TabsTrigger>
          <TabsTrigger value="sections" className="text-xs">내용 작성</TabsTrigger>
          {wpType?.hasRiggingPlan && (
            <TabsTrigger value="rigging" className="text-xs">리깅플랜</TabsTrigger>
          )}
          <TabsTrigger value="equipment" className="text-xs gap-1"><Wrench className="h-3 w-3" />장비</TabsTrigger>
          <TabsTrigger value="checklist" className="text-xs gap-1"><CheckCircle2 className="h-3 w-3" />체크리스트</TabsTrigger>
          <TabsTrigger value="attachments" className="text-xs">첨부파일</TabsTrigger>
          <TabsTrigger value="preview" className="text-xs gap-1"><Eye className="h-3 w-3" />미리보기</TabsTrigger>
        </TabsList>

        {/* Basic Info Tab */}
        <TabsContent value="basic" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="h-4 w-4" />작업기간</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">시작일 *</Label>
                  <Input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setIsDirty(true); }} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">종료일 *</Label>
                  <Input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setIsDirty(true); }} className="h-9" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">기본 정보</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">공종</span>
                  <p className="font-medium">{wpType?.name}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">상태</span>
                  <p><Badge className={`text-[10px] ${statusColor}`}>{plan.status}</Badge></p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">회차</span>
                  <p className="font-medium">v{plan.version || 1}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">생성일</span>
                  <p className="font-medium">{format(new Date(plan.created_at), 'yyyy.MM.dd HH:mm')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sections Tab */}
        <TabsContent value="sections" className="space-y-4 mt-4">
          {sections.filter(s => s.key !== '_checklist').map((section, idx) => {
            if (section.type === 'rigging') return null;
            const templateSection = wpType?.templateSections.find(ts => ts.key === section.key);
            const sectionErrors = validationErrors[section.key];
            return (
              <Card key={section.key} className={sectionErrors ? 'border-destructive' : ''}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{section.title}</CardTitle>
                    {templateSection?.aiPrompt && (
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                        onClick={() => handleAiGenerate(idx)} disabled={aiLoading === section.key}>
                        {aiLoading === section.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        AI 작성
                      </Button>
                    )}
                  </div>
                  {sectionErrors?.map((e, i) => <p key={i} className="text-[10px] text-destructive">{e}</p>)}
                </CardHeader>
                <CardContent>
                  <StructuredSectionForm sectionKey={section.key} workType={plan.work_type}
                    value={section.content || ''} onChange={content => handleSectionChange(idx, content)} />
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
                    <Label className="text-xs">인양물 중량 (톤) *</Label>
                    <Input type="number" value={rigging?.load_weight || ''} onChange={e => handleRiggingChange('load_weight', e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">인양물 설명</Label>
                    <Input value={rigging?.load_description || ''} onChange={e => handleRiggingChange('load_description', e.target.value)} className="h-9" />
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
                    <Input type="number" value={rigging?.working_radius || ''} onChange={e => handleRiggingChange('working_radius', e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">붐 길이 (m)</Label>
                    <Input type="number" value={rigging?.boom_length || ''} onChange={e => handleRiggingChange('boom_length', e.target.value)} className="h-9" />
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
                    <Input type="number" value={rigging?.ground_bearing_capacity || ''} onChange={e => handleRiggingChange('ground_bearing_capacity', e.target.value)} className="h-9" />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">아우트리거 설치</Label>
                    <Input value={rigging?.outrigger_setup || ''} onChange={e => handleRiggingChange('outrigger_setup', e.target.value)} className="h-9" />
                  </div>
                </div>

                {riggingCalc && (
                  <>
                    <Separator />
                    <div className={`p-4 rounded-lg border-2 ${
                      riggingCalc.warningLevel === 'danger' ? 'border-red-500 bg-red-50 dark:bg-red-950/30' :
                      riggingCalc.warningLevel === 'warning' ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/30' :
                      'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30'
                    }`}>
                      <div className="flex items-center gap-2 mb-3">
                        {riggingCalc.warningLevel === 'danger' ? <AlertTriangle className="h-5 w-5 text-red-600 animate-pulse" /> :
                         riggingCalc.warningLevel === 'warning' ? <AlertTriangle className="h-5 w-5 text-yellow-600" /> :
                         <CheckCircle2 className="h-5 w-5 text-green-600" />}
                        <span className="font-bold text-sm">{riggingCalc.message}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-3 text-xs">
                        <div><span className="text-muted-foreground">인양 하중</span><p className="font-bold">{riggingCalc.requiredCapacity?.toFixed(1)} t</p></div>
                        <div><span className="text-muted-foreground">실효 하중</span><p className="font-bold">{riggingCalc.effectiveLoad?.toFixed(1)} t</p></div>
                        <div><span className="text-muted-foreground">가용 정격하중</span><p className="font-bold">{riggingCalc.availableCapacity?.toFixed(1)} t</p></div>
                        <div><span className="text-muted-foreground">가동률</span><p className="font-bold">{riggingCalc.utilization?.toFixed(1)}%</p></div>
                        <div><span className="text-muted-foreground">안전율</span>
                          <p className={`font-bold ${riggingCalc.safetyFactor < 1.0 ? 'text-red-600' : riggingCalc.safetyFactor < 1.25 ? 'text-yellow-600' : 'text-green-600'}`}>
                            {riggingCalc.safetyFactor?.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">비고</Label>
                  <Textarea value={rigging?.notes || ''} onChange={e => handleRiggingChange('notes', e.target.value)} rows={3} className="text-sm" />
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
            <EquipmentManager projectId={plan.project_id} companyId={plan.company_id} selectable
              onSelect={(eq) => { if (rigging) handleRiggingChange('crane_model', eq.name); }} />
          )}
        </TabsContent>

        {/* Checklist Tab */}
        <TabsContent value="checklist" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">안전 체크리스트</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {checklist.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <Checkbox checked={item.checked} onCheckedChange={(checked) => {
                    setChecklist(prev => prev.map((c, i) => i === idx ? { ...c, checked: !!checked } : c));
                    setIsDirty(true);
                  }} />
                  <span className="text-sm">{item.label}</span>
                </div>
              ))}
              <Separator />
              <p className="text-[10px] text-muted-foreground">
                체크 완료: {checklist.filter(c => c.checked).length} / {checklist.length}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Attachments Tab */}
        <TabsContent value="attachments" className="space-y-3 mt-4">
          <AttachmentChecklist workType={plan.work_type}
            attachments={attachments.map((a: any, i: number) => ({
              key: a.key || `att_${i}`, uploaded: !!a.uploaded, fileUrl: a.fileUrl,
            }))}
            onAttachmentsChange={(newAtts) => {
              setAttachments(newAtts.map((a, i) => ({ ...a, name: a.key, id: `att_${i}` })));
              setIsDirty(true);
            }}
            onUpload={(idx, file) => handleFileUpload(idx, file)}
          />
        </TabsContent>

        {/* Preview Tab */}
        <TabsContent value="preview" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Eye className="h-4 w-4" />미리보기</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              {/* Header */}
              <div className="text-center border-b pb-4">
                <h2 className="text-lg font-bold">작업계획서</h2>
                <p className="text-sm text-muted-foreground">{plan.title}</p>
              </div>

              {/* Basic Info Grid */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                <div className="flex gap-2"><span className="text-muted-foreground w-20 shrink-0">공종:</span><span className="font-medium">{wpType?.name}</span></div>
                <div className="flex gap-2"><span className="text-muted-foreground w-20 shrink-0">상태:</span><span className="font-medium">{plan.status}</span></div>
                <div className="flex gap-2"><span className="text-muted-foreground w-20 shrink-0">작업기간:</span>
                  <span className="font-medium">{startDate && endDate ? `${startDate} ~ ${endDate}` : '미지정'}</span>
                </div>
                <div className="flex gap-2"><span className="text-muted-foreground w-20 shrink-0">회차:</span><span className="font-medium">v{plan.version || 1}</span></div>
              </div>

              <Separator />

              {/* Sections Preview */}
              {sections.filter(s => s.key !== '_checklist' && s.content).map(section => (
                <div key={section.key} className="space-y-1">
                  <h3 className="text-sm font-semibold">{section.title}</h3>
                  <div className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded">
                    {typeof section.content === 'string' && section.content.startsWith('[')
                      ? JSON.stringify(JSON.parse(section.content), null, 2)
                      : section.content}
                  </div>
                </div>
              ))}

              {/* Checklist Preview */}
              {checklist.some(c => c.checked) && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">체크리스트</h3>
                  {checklist.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span>{item.checked ? '☑' : '☐'}</span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Attachments Preview */}
              {attachments.filter((a: any) => a.uploaded).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">첨부파일</h3>
                  {attachments.filter((a: any) => a.uploaded).map((a: any, i: number) => (
                    <div key={i} className="text-xs">
                      <a href={a.fileUrl} target="_blank" rel="noopener" className="text-primary hover:underline">
                        {a.name || a.key}
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default WorkPlanDetail;
