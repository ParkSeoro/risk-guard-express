import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { isForceDesktop } from '@/components/MobileRedirectGuard';
import MobileWorkPlanViewer from '@/pages/MobileWorkPlanViewer';
import { WORK_PLAN_TYPES } from '@/lib/workPlanTemplates';
import RiggingPlanForm from '@/components/rigging/RiggingPlanForm';
import { generateAttachments, type AttachmentItem } from '@/lib/attachmentTemplates';
import StructuredSectionForm, { validateSection } from '@/components/work-plan/StructuredSectionForm';
import {
  fetchLatestApprovedRun,
  syncRaToWp,
  cloneAttachmentFiles,
  getApprovalBlockers,
  getAttachmentProgress,
  type LatestApprovedRun,
  type AttachmentProgress,
} from '@/lib/workPlanAttachments';
import {
  fetchWorkPlanTbmNoticeStatus,
  type WorkPlanNoticeStatus,
} from '@/lib/workPlanTbmNotice';
import AttachmentChecklist from '@/components/work-plan/AttachmentChecklist';
import AttachmentReviewPanel from '@/components/work-plan/AttachmentReviewPanel';
import LegalCalculatorPanel from '@/components/work-plan/LegalCalculatorPanel';
import { uploadAttachmentFile, formatBytes } from '@/lib/compressUploadFile';
import { formatSectionContent } from '@/lib/formatSectionContent';
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
import { Switch } from '@/components/ui/switch';
import {
  ArrowLeft, Save, FileText, Upload, Calculator, CheckCircle2, AlertTriangle,
  Sparkles, Printer, Download, SendHorizontal, Loader2, Wrench, Copy, Eye,
  CalendarDays, MapPin, User, Shield, ClipboardList
} from 'lucide-react';
import SubmitApprovalDialog from '@/components/approval/SubmitApprovalDialog';
import { format, parseISO } from 'date-fns';
import {
  buildRiggingPlanPayload,
  isRiggingPlanReady,
  summarizeRiggingPlan,
} from '@/lib/riggingPlanPersist';
import { refreshRiggingDerivedFields } from '@/lib/riggingDerived';
import { appendTextToMethodSection } from '@/lib/workPlanMethodSection';
import { approvalsBackOr } from '@/lib/approvalInboxPreview';

const EDITABLE_PLAN_STATUSES = new Set(['작성중', '반려']);
const LOCKED_PREVIEW_STATUSES = new Set(['결재중', '승인', '승인완료', '완료']);

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

const WorkPlanDetail = () => {
  const { planId } = useParams<{ planId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const listBackPath = approvalsBackOr('/work-plans', searchParams.get('from'));
  const { user } = useAuth();
  const access = useGlobalProjectAccess();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [plan, setPlan] = useState<any>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [rigging, setRigging] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string[]>>({});
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  // Basic info fields
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [checklist, setChecklist] = useState<{ label: string; checked: boolean }[]>([]);
  const [latestApprovedRun, setLatestApprovedRun] = useState<LatestApprovedRun | null>(null);
  const [raSyncing, setRaSyncing] = useState(false);
  const [tbmNotice, setTbmNotice] = useState<WorkPlanNoticeStatus | null>(null);
  const [tbmNoticeLoading, setTbmNoticeLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [attProgress, setAttProgress] = useState<AttachmentProgress | null>(null);
  const authoringLockRef = useRef(false);
  if (!isMobile || isForceDesktop()) authoringLockRef.current = true;

  // Latest-state refs so autosave never persists a stale rigging snapshot.
  const riggingRef = useRef<any>(null);
  const sectionsRef = useRef<any[]>([]);
  const attachmentsRef = useRef<any[]>([]);
  const checklistRef = useRef<{ label: string; checked: boolean }[]>([]);
  const startDateRef = useRef('');
  const endDateRef = useRef('');
  const planRef = useRef<any>(null);
  const editEpochRef = useRef(0);
  const isDirtyRef = useRef(false);

  useEffect(() => { riggingRef.current = rigging; }, [rigging]);
  useEffect(() => { sectionsRef.current = sections; }, [sections]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => { checklistRef.current = checklist; }, [checklist]);
  useEffect(() => { startDateRef.current = startDate; }, [startDate]);
  useEffect(() => { endDateRef.current = endDate; }, [endDate]);
  useEffect(() => { planRef.current = plan; }, [plan]);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  const markDirty = () => {
    editEpochRef.current += 1;
    setIsDirty(true);
  };

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    setLoading(true);
    setIsDirty(false);
    (async () => {
      const { data, error } = await supabase.from('work_plans').select('*').eq('id', planId).single();
      if (cancelled) return;
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
      if (LOCKED_PREVIEW_STATUSES.has(data.status)) {
        setActiveTab('preview');
      }

      const existingChecklist = (data.sections as any[])?.find(s => s.key === '_checklist');
      if (existingChecklist?.content) {
        try { setChecklist(JSON.parse(existingChecklist.content)); } catch { setChecklist(getDefaultChecklist()); }
      } else {
        setChecklist(getDefaultChecklist());
      }

      const wpType = WORK_PLAN_TYPES.find(t => t.id === data.work_type);
      if (wpType?.hasRiggingPlan) {
        const { data: rp } = await supabase.from('rigging_plans').select('*').eq('work_plan_id', planId).maybeSingle();
        if (cancelled) return;
        if (rp) {
          setRigging(refreshRiggingDerivedFields(rp));
        } else {
          setRigging({ work_plan_id: planId });
        }
      } else {
        setRigging(null);
      }
      setLoading(false);

      if (planId) {
        getAttachmentProgress(planId).then((p) => { if (!cancelled) setAttProgress(p); }).catch(() => {});
      }
      if (data.project_id) {
        fetchLatestApprovedRun(data.project_id).then((r) => { if (!cancelled) setLatestApprovedRun(r); }).catch(() => {});
      }
      if (['승인완료', '승인', '완료'].includes(data.status) && planId) {
        setTbmNoticeLoading(true);
        fetchWorkPlanTbmNoticeStatus(planId)
          .then((st) => { if (!cancelled) setTbmNotice(st); })
          .catch(() => { if (!cancelled) setTbmNotice(null); })
          .finally(() => { if (!cancelled) setTbmNoticeLoading(false); });
      } else if (!cancelled) {
        setTbmNotice(null);
      }
    })();
    return () => { cancelled = true; };
  }, [planId]);

  useEffect(() => {
    if (isDirty && !saving) {
      const timer = setTimeout(() => { void handleSave(true); }, 30000);
      return () => clearTimeout(timer);
    }
    // rigging/checklist/dates included so the timer resets while editing (refs still hold latest on fire)
  }, [isDirty, sections, attachments, rigging, checklist, startDate, endDate, saving]);

  const mergeSectionsForSave = (secs = sectionsRef.current, checks = checklistRef.current) => [
    ...secs.filter(s => s.key !== '_checklist'),
    { key: '_checklist', title: '체크리스트', type: 'checklist', content: JSON.stringify(checks) },
  ];

  const handleSectionChange = (key: string, content: string) => {
    setSections(prev => prev.map((s) => (s.key === key ? { ...s, content } : s)));
    markDirty();
  };

  const persistRigging = async (current: any = riggingRef.current): Promise<{ ok: boolean; error?: string }> => {
    if (!planId || !current) return { ok: true };
    const refreshed = refreshRiggingDerivedFields(current);
    const payload = buildRiggingPlanPayload(planId, refreshed);
    const { data, error } = await supabase
      .from('rigging_plans')
      .upsert(payload, { onConflict: 'work_plan_id' })
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    if (data) {
      // Never wipe in-progress edits with a stale server row mid-autosave.
      setRigging((prev: any) => {
        if (isDirtyRef.current && prev) {
          return {
            ...prev,
            id: data.id,
            work_plan_id: data.work_plan_id,
            updated_at: data.updated_at,
            created_at: data.created_at,
          };
        }
        return data;
      });
    } else {
      setRigging(refreshed);
    }
    return { ok: true };
  };

  const handleSave = async (isAutoSave = false, riggingOverride?: any): Promise<boolean> => {
    if (!planId) return false;
    const currentPlan = planRef.current;
    if (currentPlan && !EDITABLE_PLAN_STATUSES.has(currentPlan.status)) {
      if (!isAutoSave) {
        toast({ title: '수정 불가', description: '결재 진행중/완료 문서는 수정할 수 없습니다.', variant: 'destructive' });
      }
      return false;
    }
    const epochAtStart = editEpochRef.current;
    setSaving(true);

    try {
      const mergedSections = mergeSectionsForSave();

      const { error } = await supabase.from('work_plans').update({
        sections: mergedSections,
        attachments: attachmentsRef.current,
        start_date: startDateRef.current || null,
        end_date: endDateRef.current || null,
        auto_education_enabled: currentPlan?.auto_education_enabled ?? true,
        updated_at: new Date().toISOString(),
      }).eq('id', planId);

      if (error) {
        if (!isAutoSave) toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
        return false;
      }

      const wpType = WORK_PLAN_TYPES.find(t => t.id === currentPlan?.work_type);
      const currentRigging = riggingOverride ?? riggingRef.current;
      if (wpType?.hasRiggingPlan && currentRigging) {
        const r = await persistRigging(currentRigging);
        if (!r.ok) {
          if (!isAutoSave) {
            toast({
              title: '리깅플랜 저장 실패',
              description: r.error || '작업계획서는 저장됐지만 리깅플랜은 반영되지 않았습니다.',
              variant: 'destructive',
            });
          }
          return false;
        }
      }

      // Only clear dirty if nothing was edited during the save round-trip.
      if (editEpochRef.current === epochAtStart) {
        setIsDirty(false);
        isDirtyRef.current = false;
      }
      if (!isAutoSave) toast({ title: '저장되었습니다.' });
      return true;
    } catch (err: any) {
      if (!isAutoSave) {
        toast({ title: '저장 실패', description: err?.message || '알 수 없는 오류', variant: 'destructive' });
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRigging = async () => {
    if (!planId) return;
    if (!riggingRef.current) {
      setRigging({ work_plan_id: planId });
    }
    setSaving(true);
    try {
      const r = await persistRigging(riggingRef.current || { work_plan_id: planId });
      if (!r.ok) {
        toast({ title: '리깅플랜 저장 실패', description: r.error, variant: 'destructive' });
      } else {
        toast({ title: '리깅플랜이 저장되었습니다.' });
        setIsDirty(false);
        isDirtyRef.current = false;
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRiggingChange = (field: string, value: any) => {
    setRigging((prev: any) => ({ ...(prev || { work_plan_id: planId }), [field]: value }));
    markDirty();
  };

  /** Derived calc fields (safety_factor etc.) — update state without marking dirty. */
  const handleRiggingDerivedPatch = (patch: Record<string, any>) => {
    setRigging((prev: any) => ({ ...(prev || { work_plan_id: planId }), ...patch }));
  };

  const handleAiGenerate = async (sectionKey: string) => {
    const section = sections.find(s => s.key === sectionKey);
    const wpType = WORK_PLAN_TYPES.find(t => t.id === plan?.work_type);
    if (!section || !wpType) return;
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
        handleSectionChange(section.key, JSON.stringify(data.structured));
        toast({ title: 'AI 작성 완료' });
      } else if (data?.content) {
        handleSectionChange(section.key, data.content);
        toast({ title: 'AI 작성 완료' });
      } else if (data?.items) {
        const risks = (data.items as any[]).map((item: any) => ({
          hazard: item.hazard || '', situation: item.hazard_situation || '',
          measure: item.improvement_measure || '', severity: item.likelihood_grade || '중',
        }));
        handleSectionChange(section.key, JSON.stringify(risks));
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
    const wpTypeNow = WORK_PLAN_TYPES.find(t => t.id === plan?.work_type);
    let readyRigging = rigging;
    if (wpTypeNow?.hasRiggingPlan) {
      readyRigging = refreshRiggingDerivedFields(rigging || { work_plan_id: planId });
      setRigging(readyRigging);
      if (!isRiggingPlanReady(readyRigging)) {
        setActiveTab('rigging');
        toast({
          title: '리깅플랜이 필요합니다',
          description: '인양 중량·작업 반경·크레인·정격하중을 입력하고 안전율이 계산된 뒤 상신하세요.',
          variant: 'destructive',
        });
        return;
      }
    }
    // 필수 첨부(SSOT: work_plan_attachments.is_mandatory) — 누락 시 결재 차단
    const blockers = await getApprovalBlockers(planId!, plan.work_type);
    if (blockers.length > 0) {
      const names = blockers.slice(0, 5).map(b => b.name).join(', ');
      const more = blockers.length > 5 ? ` 외 ${blockers.length - 5}건` : '';
      setActiveTab('attachments');
      toast({
        title: '결재 상신이 차단되었습니다',
        description: `필수 첨부 누락: ${names}${more}. 첨부 후 다시 상신해주세요.`,
        variant: 'destructive',
      });
      return;
    }
    await handleSave(false, readyRigging);
    setApprovalDialogOpen(true);
  };

  const handleApprovalSubmitted = async () => {
    await supabase.from('work_plans').update({ status: '결재중' }).eq('id', planId);
    setPlan((prev: any) => ({ ...prev, status: '결재중' }));
    toast({ title: '결재 상신이 완료되었습니다.' });
  };


  const handlePdfDownload = async () => {
    if (!planId || pdfBusy) return;
    setPdfBusy(true);
    try {
      const { fetchWorkPlanPrintHtml } = await import('@/lib/approvalDocPreview');
      const html = await fetchWorkPlanPrintHtml(planId);
      if (html) {
        const desiredTitle = plan?.title || '작업계획서';
        const prevTitle = document.title;
        document.title = desiredTitle;
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
          doc.write(html);
          doc.close();
          const triggerPrint = () => {
            try { (iframe.contentDocument || iframe.contentWindow?.document)!.title = desiredTitle; } catch {}
            setTimeout(() => {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
              setTimeout(() => {
                document.body.removeChild(iframe);
                document.title = prevTitle;
              }, 1500);
            }, 500);
          };
          iframe.onload = triggerPrint;
          if (doc.readyState === 'complete') triggerPrint();
        }
        toast({ title: 'PDF 인쇄 대화상자가 열립니다. "PDF로 저장"을 선택하세요.' });
      }
    } catch (err: any) {
      toast({ title: 'PDF 생성 실패', description: err?.message, variant: 'destructive' });
    } finally {
      setPdfBusy(false);
    }
  };


  const handleClone = async () => {
    if (!plan || !user) return;
    if (EDITABLE_PLAN_STATUSES.has(plan.status) && isDirty) {
      const saved = await handleSave(true);
      if (saved === false) {
        toast({ title: '복사 전 저장에 실패했습니다.', variant: 'destructive' });
        return;
      }
    }
    const merged = mergeSectionsForSave();
    const { data, error } = await supabase.from('work_plans').insert({
      project_id: plan.project_id,
      company_id: plan.company_id,
      work_type: plan.work_type,
      title: `${plan.title} (v${(plan.version || 1) + 1})`,
      sections: merged,
      attachments: [],
      created_by: user.id,
      parent_id: plan.id,
      version: (plan.version || 1) + 1,
      status: '작성중',
      start_date: startDate || null,
      end_date: endDate || null,
    }).select().single();
    if (error) {
      toast({ title: '복사 실패', description: error.message, variant: 'destructive' });
      return;
    }
    if (data) {
      try {
        await cloneAttachmentFiles({
          fromPlanId: plan.id,
          toPlanId: data.id,
          projectId: plan.project_id,
          companyId: plan.company_id,
          workType: plan.work_type,
        });
      } catch (e: any) {
        console.warn('clone attachments failed', e);
      }
      try {
        const { data: srcRig } = await supabase
          .from('rigging_plans')
          .select('*')
          .eq('work_plan_id', plan.id)
          .maybeSingle();
        if (srcRig) {
          const { id: _id, created_at: _c, updated_at: _u, ...rest } = srcRig as any;
          await supabase.from('rigging_plans').insert({
            ...rest,
            work_plan_id: data.id,
          });
        }
      } catch (e: any) {
        console.warn('clone rigging failed', e);
      }
      toast({ title: '새 회차가 생성되었습니다.' });
      navigate(`/work-plan/${data.id}`);
    }
  };

  const handleFileUpload = async (attIdx: number, file: File) => {
    if (!planId || !user || !plan?.project_id) return;
    const safeName = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${plan.project_id}/work-plans/${planId}/${attIdx}_${Date.now()}_${safeName}`;
    try {
      const uploaded = await uploadAttachmentFile(path, file);
      const updated = attachments.map((a, i) => i === attIdx ? { ...a, uploaded: true, fileUrl: uploaded.publicUrl } : a);
      setAttachments(updated);
      markDirty();
      toast({
        title: '업로드 완료',
        description: uploaded.compressed
          ? `이미지 압축 ${formatBytes(uploaded.originalBytes)} → ${formatBytes(uploaded.finalBytes)}`
          : undefined,
      });
    } catch (e: any) {
      toast({ title: '업로드 실패', description: e?.message || String(e), variant: 'destructive' });
    }
  };


  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">로딩 중...</div>;
  if (!plan) return null;

  // Mobile: never render authoring UI — read-only print preview + summary.
  // Once authoring started (desktop / force-desktop), keep the editor even if
  // the viewport dips below 768px (keyboard / rotate) so drafts are not wiped.
  if (isMobile && !isForceDesktop() && !authoringLockRef.current) {
    return <MobileWorkPlanViewer planId={planId} />;
  }

  const wpType = WORK_PLAN_TYPES.find(t => t.id === plan.work_type);
  const statusColor = {
    '작성중': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    '결재중': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    '승인': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    '승인완료': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    '완료': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    '만료': 'bg-muted text-muted-foreground',
    '반려': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  }[plan.status] || '';

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(listBackPath)}>
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

      {plan.status === '반려' && (
        <Card className="border-red-500/40 bg-red-50/50 dark:bg-red-950/20">
          <CardContent className="p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-red-800 dark:text-red-300">결재 반려됨</div>
              <div className="text-xs text-muted-foreground">
                내용을 수정한 뒤 <b>재상신</b>하세요. 전자결재에서 반려 사유(코멘트)를 확인할 수 있습니다.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          onClick={() => handleSave()}
          disabled={saving || !EDITABLE_PLAN_STATUSES.has(plan.status)}
          className="gap-1"
        >
          <Save className="h-3.5 w-3.5" /> {saving ? '저장 중...' : '저장'}
        </Button>
        <Button size="sm" variant="outline" onClick={handlePdfDownload} disabled={pdfBusy} className="gap-1">
          <Download className="h-3.5 w-3.5" /> {pdfBusy ? '준비 중...' : 'PDF'}
        </Button>
        <Button size="sm" variant="outline" onClick={handlePdfDownload} disabled={pdfBusy} className="gap-1">
          <Printer className="h-3.5 w-3.5" /> {pdfBusy ? '준비 중...' : '인쇄'}
        </Button>
        {access.canCreate('work_plan') && (
          <Button size="sm" variant="outline" onClick={handleClone} className="gap-1">
            <Copy className="h-3.5 w-3.5" /> 이 계획서로 새로 만들기
          </Button>
        )}
        {attProgress && (
          <Badge
            variant={attProgress.mandatoryMissing > 0 ? 'destructive' : 'outline'}
            className="text-[10px] cursor-pointer"
            onClick={() => setActiveTab('attachments')}
          >
            첨부 {attProgress.uploaded}/{attProgress.total}
            {attProgress.mandatoryMissing > 0 ? ` · 필수 미첨부 ${attProgress.mandatoryMissing}` : ' · 필수 완료'}
          </Badge>
        )}
        {['승인완료', '승인', '완료'].includes(plan.status) && (
          <>
            <Button size="sm" variant="outline" className="gap-1" onClick={async () => {
              const { data, error } = await supabase.rpc('derive_permit_from_work_plan', { _work_plan_id: planId });
              if (error) { toast({ title: '작업허가서 생성 실패', description: error.message, variant: 'destructive' }); return; }
              const d: any = data;
              if (d?.permit_id) { toast({ title: d.reused ? '기존 허가서로 이동' : '작업허가서가 생성되었습니다.' }); navigate(`/work-permits`); }
            }}>
              <FileText className="h-3.5 w-3.5" /> 작업허가서 자동생성
            </Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={async () => {
              const { data, error } = await supabase.rpc('derive_tbm_from_work_plan', { _work_plan_id: planId });
              if (error) { toast({ title: 'TBM 생성 실패', description: error.message, variant: 'destructive' }); return; }
              const d: any = data;
              if (d?.tbm_id) {
                toast({ title: d.reused ? '기존 TBM으로 이동' : 'TBM 세션이 생성되었습니다. 참석=근로자 주지' });
                if (planId) {
                  fetchWorkPlanTbmNoticeStatus(planId).then(setTbmNotice).catch(() => {});
                }
                navigate(`/app/admin/tbm-logs`);
              }
            }}>
              <ClipboardList className="h-3.5 w-3.5" /> TBM 자동생성(주지)
            </Button>
          </>
        )}
        {EDITABLE_PLAN_STATUSES.has(plan.status) && (
          <Button
            size="sm"
            variant="default"
            onClick={handleSubmitApproval}
            className="gap-1 ml-auto"
            disabled={(attProgress?.mandatoryMissing ?? 0) > 0}
            title={
              (attProgress?.mandatoryMissing ?? 0) > 0
                ? `필수 첨부 ${attProgress!.mandatoryMissing}건 누락`
                : undefined
            }
          >
            <SendHorizontal className="h-3.5 w-3.5" />
            {plan.status === '반려' ? '재상신' : '결재 상신'}
          </Button>
        )}
      </div>

      {/* 근로자 주지 — TBM 참석 증빙 (안전기준규칙 제38조②) */}
      {['승인완료', '승인', '완료'].includes(plan.status) && (
        <Card className={tbmNotice?.notified ? 'border-emerald-500/40' : 'border-amber-500/50'}>
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <ClipboardList className={`h-4 w-4 ${tbmNotice?.notified ? 'text-emerald-600' : 'text-amber-600'}`} />
            <div className="flex-1 min-w-[240px]">
              <div className="text-sm font-semibold">근로자 주지 (TBM 참석)</div>
              <div className="text-xs text-muted-foreground">
                {tbmNoticeLoading
                  ? '확인 중…'
                  : (tbmNotice?.label || 'TBM 연계 상태를 확인할 수 없습니다.')}
              </div>
            </div>
            {!tbmNotice?.tbmSessionId ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const { data, error } = await supabase.rpc('derive_tbm_from_work_plan', { _work_plan_id: planId });
                  if (error) {
                    toast({ title: 'TBM 생성 실패', description: error.message, variant: 'destructive' });
                    return;
                  }
                  const d: any = data;
                  if (d?.tbm_id && planId) {
                    const st = await fetchWorkPlanTbmNoticeStatus(planId);
                    setTbmNotice(st);
                    toast({ title: d.reused ? '기존 TBM이 있습니다' : 'TBM이 생성되었습니다' });
                    navigate('/app/admin/tbm-logs');
                  }
                }}
              >
                TBM 만들어 주지하기
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => navigate('/app/admin/tbm-logs')}>
                TBM 보기
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* 위험성평가 연계 (권장 · 결재 절대조건 아님) */}
      <Card className="border-primary/40">
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <Shield className="h-4 w-4 text-primary" />
          <div className="flex-1 min-w-[240px]">
            <div className="text-sm font-semibold">위험성평가 연계 <span className="text-[10px] font-normal text-muted-foreground">(권장)</span></div>
            {latestApprovedRun ? (
              <div className="text-xs text-muted-foreground">
                최신 승인완료 회차: <b>{latestApprovedRun.period_label}</b>
                {latestApprovedRun.start_date && (
                  <> ({latestApprovedRun.start_date} ~ {latestApprovedRun.end_date || '-'})</>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                승인완료 회차가 없어도 결재는 가능합니다. 있으면 상위위험 항목을 불러올 수 있습니다.
              </div>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!latestApprovedRun || raSyncing || !planId}
            onClick={async () => {
              if (!latestApprovedRun || !planId) return;
              setRaSyncing(true);
              try {
                const { imported, sections: next } = await syncRaToWp({
                  runId: latestApprovedRun.id,
                  workPlanId: planId,
                  existingSections: sections,
                });
                setSections(next);
                toast({ title: `위험도 상 ${imported}건을 불러왔습니다.` });
              } catch (e: any) {
                toast({ title: '연계 실패', description: e?.message || '오류', variant: 'destructive' });
              } finally {
                setRaSyncing(false);
              }
            }}
          >
            {raSyncing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
            위험도 상 항목 불러오기
          </Button>
        </CardContent>
      </Card>


      {/* AI Education Material Auto-Generation Toggle */}
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <div>
            <Label htmlFor="auto-edu-toggle" className="text-sm font-medium cursor-pointer">
              교육자료 AI 자동 생성
            </Label>
            <p className="text-[11px] text-muted-foreground">
              결재 승인 시 위험성평가 기반 안전교육 자료를 자동으로 생성합니다.
            </p>
          </div>
        </div>
        <Switch
          id="auto-edu-toggle"
          checked={plan?.auto_education_enabled ?? true}
          onCheckedChange={(v) => {
            setPlan((prev: any) => ({ ...prev, auto_education_enabled: v }));
            markDirty();
          }}
        />
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="basic" className="text-xs gap-1"><ClipboardList className="h-3 w-3" />기본정보</TabsTrigger>
          <TabsTrigger value="sections" className="text-xs">내용 작성</TabsTrigger>
          {wpType?.hasRiggingPlan && (
            <TabsTrigger value="rigging" className="text-xs">리깅플랜</TabsTrigger>
          )}
          <TabsTrigger value="equipment" className="text-xs gap-1"><Wrench className="h-3 w-3" />장비</TabsTrigger>
          <TabsTrigger value="checklist" className="text-xs gap-1"><CheckCircle2 className="h-3 w-3" />체크리스트</TabsTrigger>
          <TabsTrigger value="calculator" className="text-xs gap-1"><Calculator className="h-3 w-3" />법정계산</TabsTrigger>
          <TabsTrigger value="attachments" className="text-xs gap-1">
            첨부파일
            {(attProgress?.mandatoryMissing ?? 0) > 0 && (
              <Badge variant="destructive" className="text-[9px] h-4 px-1">{attProgress!.mandatoryMissing}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="preview" className="text-xs gap-1">
            <Eye className="h-3 w-3" />미리보기
            {(attProgress?.uploaded ?? 0) > 0 && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1">{attProgress!.uploaded}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Basic Info Tab */}
        <TabsContent value="basic" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="h-4 w-4" />작업기간</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">시작일 *</Label>
                  <Input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); markDirty(); }} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">종료일 *</Label>
                  <Input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); markDirty(); }} className="h-9" />
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
          {sections.filter(s => s.key !== '_checklist').map((section) => {
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
                        onClick={() => handleAiGenerate(section.key)} disabled={aiLoading === section.key}>
                        {aiLoading === section.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        AI 작성
                      </Button>
                    )}
                  </div>
                  {sectionErrors?.map((e, i) => <p key={i} className="text-[10px] text-destructive">{e}</p>)}
                </CardHeader>
                <CardContent>
                  <StructuredSectionForm key={`${planId}-${section.key}`} sectionKey={section.key} workType={plan.work_type}
                    value={section.content || ''} onChange={content => handleSectionChange(section.key, content)} />
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Rigging Tab */}
        {wpType?.hasRiggingPlan && (
          <TabsContent value="rigging" className="space-y-4 mt-4">
            <RiggingPlanForm
              rigging={rigging || {}}
              onChange={handleRiggingChange}
              onDerivedPatch={handleRiggingDerivedPatch}
              onSave={handleSaveRigging}
              saving={saving}
            />
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
                    markDirty();
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

        {/* Legal Calculator Tab */}
        <TabsContent value="calculator" className="space-y-4 mt-4">
          <LegalCalculatorPanel
            workType={plan.work_type}
            onAppendToMethod={(text) => {
              const idx = sections.findIndex(s => s.key === 'method');
              if (idx < 0) {
                toast({ title: '작업방법 섹션을 찾을 수 없습니다', variant: 'destructive' });
                return;
              }
              handleSectionChange('method', appendTextToMethodSection(sections[idx].content || '', text));
            }}
          />
        </TabsContent>


        {/* Attachments Tab */}
        <TabsContent value="attachments" className="space-y-3 mt-4">
          {planId && <AttachmentReviewPanel workPlanId={planId} />}
          {plan?.project_id && (
            <AttachmentChecklist
              workPlanId={plan.id}
              projectId={plan.project_id}
              companyId={plan.company_id}
              workType={plan.work_type}
              readOnly={!EDITABLE_PLAN_STATUSES.has(plan.status)}
              onChange={() => markDirty()}
              onProgress={setAttProgress}
            />
          )}
        </TabsContent>

        {/* Preview Tab — attachments first (SSOT work_plan_attachments; legacy JSON is empty) */}
        <TabsContent value="preview" className="space-y-4 mt-4">
          {planId && <AttachmentReviewPanel workPlanId={planId} />}
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Eye className="h-4 w-4" />본문 미리보기</CardTitle></CardHeader>
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
                    {formatSectionContent(section.content)}
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

              {/* Rigging preview — same SSOT as PDF */}
              {wpType?.hasRiggingPlan && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">리깅플랜 (양중계획)</h3>
                  {summarizeRiggingPlan(rigging).length > 0 ? (
                    <ul className="text-xs text-muted-foreground space-y-1 bg-muted/30 p-3 rounded list-disc pl-5">
                      {summarizeRiggingPlan(rigging).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 rounded">
                      리깅플랜이 아직 저장되지 않았습니다. 리깅플랜 탭에서 입력·저장하세요.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {plan && (
        <SubmitApprovalDialog
          open={approvalDialogOpen}
          onOpenChange={setApprovalDialogOpen}
          entityType="work_plan"
          entityId={plan.id}
          projectId={plan.project_id}
          submitterCompanyId={plan.company_id || access.userCompanyId || null}
          onSubmitted={handleApprovalSubmitted}
        />
      )}
    </div>
  );
};

export default WorkPlanDetail;
