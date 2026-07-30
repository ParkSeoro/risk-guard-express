/**
 * 작업허가서 상세 — 필요 종류 동적 선택, 단일 작업 묶음 결재, AI 브리핑, 연속 PDF 인쇄.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Printer, Save, FileSignature, ShieldCheck, Clock } from 'lucide-react';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import DigPermitForm, { PermitFormData, PermitSignatures, PermitType } from '@/components/permits/DigPermitForm';
import StandardPermitSheet from '@/components/permits/StandardPermitSheet';
import type { StandardStyle, StandardLabels } from '@/lib/permitStandardStyle';
import OverlayFillForm from '@/components/permits/OverlayFillForm';
import SubmitApprovalDialog from '@/components/approval/SubmitApprovalDialog';
import PermitKindSelector from '@/components/permits/PermitKindSelector';
import PermitAiBriefingCard from '@/components/permits/PermitAiBriefingCard';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { printOverlay } from '@/lib/permitOverlayPrint';
import {
  normalizePermitKinds,
  primaryPermitKind,
  PERMIT_KIND_LABEL,
  type PermitKindId,
} from '@/lib/permitKinds';
import type { PermitAiBriefing } from '@/lib/permitBriefing';
import { syncPermitAssessmentLinks } from '@/lib/safetyWorkBundle';
import { mergeApprovalSignatures } from '@/lib/permitApprovalSignatures';
import { syncPermitDateFromWorkStart, resolvePermitWorkDate } from '@/lib/permitWorkDate';

const STANDARD_FORM_VALUE = '__standard__';

function hasStandardStyle(t: any) {
  return !!(t?.layout_json && typeof t.layout_json === 'object' && (t.layout_json as any).standard_style);
}

function pickStandardStyleHolder(list: any[], permitType: PermitType) {
  const candidates = list.filter((t) => t?.is_active !== false && hasStandardStyle(t));
  return (
    candidates.find((t) => t.permit_type === permitType && t.is_default) ||
    candidates.find((t) => t.permit_type === permitType) ||
    candidates.find((t) => t.permit_type === 'general' && t.is_default) ||
    candidates.find((t) => t.permit_type === 'general') ||
    candidates.find((t) => t.is_default) ||
    candidates[0]
  );
}

function toDbTimestamp(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toLocalInput(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EDITABLE_PERMIT_STATUSES = new Set(['작성중', '반려', '임시저장']);
const APPROVED_PERMIT_STATUSES = new Set(['승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED']);
const CLOSURE_PENDING_STATUSES = new Set(['종료대기', 'CLOSURE_PENDING']);
const CLOSED_PERMIT_STATUSES = new Set(['종료완료', 'CLOSED', '마감']);
const IN_APPROVAL_PERMIT_STATUSES = new Set(['결재중', '결재진행', '검토대기', '검토완료']);

function isPermitEditable(status?: string | null) {
  return EDITABLE_PERMIT_STATUSES.has(status || '');
}
function isPermitApproved(status?: string | null) {
  return APPROVED_PERMIT_STATUSES.has(status || '') || CLOSURE_PENDING_STATUSES.has(status || '') || CLOSED_PERMIT_STATUSES.has(status || '');
}
function permitStatusLabel(status?: string | null) {
  if (CLOSED_PERMIT_STATUSES.has(status || '')) return '종료 완료';
  if (CLOSURE_PENDING_STATUSES.has(status || '')) return '작업 완료 확인 대기';
  if (APPROVED_PERMIT_STATUSES.has(status || '')) return '발행 완료';
  if (status === '결재중' || status === '결재진행') return '결재 진행중';
  return status || '-';
}

export default function WorkPermitDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { userCompanyId } = useGlobalProjectAccess();

  const [permit, setPermit] = useState<any>(null);
  const [projectName, setProjectName] = useState('');
  const [selectedKinds, setSelectedKinds] = useState<PermitKindId[]>(['general']);
  const [activeKind, setActiveKind] = useState<PermitKindId>('general');
  const [data, setData] = useState<PermitFormData>({});
  const [signatures, setSignatures] = useState<PermitSignatures>({});
  const [linkedRuns, setLinkedRuns] = useState<any[]>([]);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendUntil, setExtendUntil] = useState('');
  const [extending, setExtending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState<string>(STANDARD_FORM_VALUE);
  const [standardStyle, setStandardStyle] = useState<Partial<StandardStyle> | null>(null);
  const [standardLabels, setStandardLabels] = useState<Partial<StandardLabels> | null>(null);
  const [autoCtx, setAutoCtx] = useState<any>({});
  const [aiBriefing, setAiBriefing] = useState<PermitAiBriefing | null>(null);

  const template = useMemo(
    () => (templateId && templateId !== STANDARD_FORM_VALUE ? templates.find((t) => t.id === templateId) || null : null),
    [templates, templateId],
  );

  const load = async () => {
    if (!id) return;
    const { data: p, error } = await supabase.from('work_permits' as any).select('*').eq('id', id).single();
    if (error || !p) { toast({ title: '허가서를 불러오지 못했습니다.', variant: 'destructive' }); return; }
    setPermit(p);

    const kinds = normalizePermitKinds(
      (p as any).permit_kinds,
      ((p as any).permit_type || 'general') as PermitKindId,
    );
    setSelectedKinds(kinds);
    setActiveKind(kinds.includes(((p as any).permit_type as PermitKindId)) ? (p as any).permit_type : kinds[0]);

    setData({
      ...((p as any).form_data || {}),
      contractor_company: ((p as any).form_data || {}).contractor_company || (p as any).contractor_company || '',
      applicant_company: ((p as any).form_data || {}).applicant_company || (p as any).contractor_company || '',
      work_name: ((p as any).form_data || {}).work_name || (p as any).work_name || '',
      work_description: ((p as any).form_data || {}).work_description || (p as any).work_description || '',
      work_location: ((p as any).form_data || {}).work_location || (p as any).location || '',
      personnel_count: ((p as any).form_data || {}).personnel_count ?? (p as any).personnel_count ?? 0,
      work_start: ((p as any).form_data || {}).work_start || toLocalInput((p as any).work_start_at),
      work_end: ((p as any).form_data || {}).work_end || toLocalInput((p as any).work_end_at),
    });

    const briefing = (p as any).ai_briefing || ((p as any).form_data || {}).ai_briefing || null;
    setAiBriefing(briefing);

    const baseSig: PermitSignatures = (p as any).signatures || {};

    if ((p as any).project_id) {
      const { data: proj } = await supabase.from('projects').select('name').eq('id', (p as any).project_id).single();
      setProjectName((proj as any)?.name || '');
    }

    if ((p as any).project_id && (p as any).permit_date) {
      const { data: runs } = await supabase
        .from('assessment_runs')
        .select('id, period_label, status, start_date, end_date')
        .eq('project_id', (p as any).project_id)
        .eq('is_deleted', false)
        .eq('status', '승인완료')
        .lte('start_date', (p as any).permit_date)
        .gte('end_date', (p as any).permit_date);
      setLinkedRuns(runs || []);
    }

    // Latest approval version rows for this permit
    const { data: aps } = await supabase
      .from('approvals')
      .select('position, approver_name, status, approved_at, step_order, approval_version')
      .eq('entity_type', 'work_permit')
      .eq('entity_id', id)
      .order('approval_version', { ascending: false })
      .order('step_order', { ascending: true });

    let versioned = aps || [];
    if (versioned.length > 0) {
      const latestVersion = versioned[0].approval_version;
      versioned = versioned.filter((a: any) => a.approval_version === latestVersion);
    }
    setSignatures(mergeApprovalSignatures(baseSig, versioned as any[]));

    try {
      const companyId = (p as any).company_id || userCompanyId;
      const [{ data: prof }, { data: comp }, { data: proj2 }] = await Promise.all([
        user?.id ? supabase.from('profiles').select('full_name, position, phone').eq('id', user.id).maybeSingle() : Promise.resolve({ data: null } as any),
        companyId ? supabase.from('companies').select('name, representative, business_no, address').eq('id', companyId).maybeSingle() : Promise.resolve({ data: null } as any),
        (p as any).project_id ? supabase.from('projects').select('name, site_address').eq('id', (p as any).project_id).maybeSingle() : Promise.resolve({ data: null } as any),
      ]);
      setAutoCtx({
        company: comp || undefined,
        author: prof ? { name: (prof as any).full_name, position: (prof as any).position, phone: (prof as any).phone } : undefined,
        project: proj2 || undefined,
        permit: {
          date: (p as any).permit_date,
          work_description: (p as any).work_description,
          work_location: (p as any).work_location,
          work_period: (p as any).work_period,
        },
      });
      const companyName = (comp as any)?.name || '';
      if (companyName) {
        setData((current) => ({
          ...current,
          contractor_company: current.contractor_company || companyName,
          applicant_company: current.applicant_company || companyName,
        }));
      }
    } catch (e) { console.warn('autoCtx build failed', e); }
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (!selectedKinds.includes(activeKind)) {
      setActiveKind(selectedKinds[0] || 'general');
    }
  }, [selectedKinds, activeKind]);

  useEffect(() => {
    (async () => {
      try {
        const { data: tpls } = await supabase
          .from('permit_form_templates')
          .select('id, name, code, version, layout_json, print_overlay, original_pdf_url, is_default, permit_type')
          .eq('is_deleted', false)
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .order('updated_at', { ascending: false });
        const list = (tpls || []) as any[];
        const usable = list.filter((t) => {
          const typeOk = !t.permit_type || t.permit_type === activeKind || t.permit_type === 'general';
          const hasOverlay = t.original_pdf_url && (t.print_overlay?.pages?.length || 0) > 0;
          return typeOk && hasOverlay;
        });
        setTemplates(usable);
        const styleHolder = pickStandardStyleHolder(list, activeKind);
        setStandardStyle((styleHolder?.layout_json as any)?.standard_style ?? null);
        setStandardLabels((styleHolder?.layout_json as any)?.standard_labels ?? null);
        const saved = (permit as any)?.form_template_id;
        const matched = saved ? usable.find((t) => t.id === saved) : null;
        setTemplateId(matched?.id || STANDARD_FORM_VALUE);
      } catch (e) {
        console.warn('template lookup failed', e);
        setTemplates([]);
        setStandardStyle(null);
        setStandardLabels(null);
        setTemplateId(STANDARD_FORM_VALUE);
      }
    })();
  }, [activeKind, permit?.id]);

  const save = async () => {
    if (!permit) return;
    if (!isPermitEditable(permit.status)) {
      toast({ title: '수정 불가', description: '결재 진행중/완료 문서는 수정할 수 없습니다.', variant: 'destructive' });
      return;
    }
    if (selectedKinds.length === 0) {
      toast({ title: '허가서 종류를 1개 이상 선택하세요.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const syncedData: PermitFormData = { ...data };
    const workDescription = syncedData.work_description || permit.work_description || '';
    const workLocation = syncedData.work_location || permit.location || permit.work_location || '';
    const contractorCompany = syncedData.contractor_company || permit.contractor_company || '';
    const primary = primaryPermitKind(selectedKinds);
    const linkedIds = linkedRuns.map((r) => r.id);
    const primaryRunId = linkedIds[0] || permit.assessment_run_id || null;
    const { error } = await supabase.from('work_permits' as any).update({
      permit_type: primary,
      permit_kinds: selectedKinds,
      form_data: syncedData,
      signatures,
      assessment_run_id: primaryRunId,
      linked_assessment_run_ids: linkedIds,
      form_version: 'SF003-Rev1',
      form_template_id: templateId && templateId !== STANDARD_FORM_VALUE ? templateId : null,
      work_name: syncedData.work_name || permit.work_name || workDescription,
      work_description: workDescription,
      location: workLocation,
      contractor_company: contractorCompany,
      personnel_count: Number(syncedData.personnel_count || permit.personnel_count || 0),
      work_start_at: toDbTimestamp(syncedData.work_start) || permit.work_start_at || null,
      work_end_at: toDbTimestamp(syncedData.work_end) || permit.work_end_at || null,
      permit_date: syncPermitDateFromWorkStart(
        syncedData.work_start,
        permit.permit_date || undefined,
      ),
    }).eq('id', permit.id);
    setSaving(false);
    if (error) return toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    try {
      await syncPermitAssessmentLinks(permit.id, primaryRunId, linkedIds);
    } catch (e) {
      console.warn('syncPermitAssessmentLinks failed', e);
    }
    toast({ title: '허가서가 저장되었습니다.', description: `${selectedKinds.map((k) => PERMIT_KIND_LABEL[k]).join(' · ')} 묶음` });
    setPermit((prev: any) => prev ? {
      ...prev,
      permit_kinds: selectedKinds,
      permit_type: primary,
      assessment_run_id: primaryRunId,
      linked_assessment_run_ids: linkedIds,
      permit_date: syncPermitDateFromWorkStart(syncedData.work_start, prev.permit_date),
      work_start_at: toDbTimestamp(syncedData.work_start) || prev.work_start_at || null,
      work_end_at: toDbTimestamp(syncedData.work_end) || prev.work_end_at || null,
      form_data: syncedData,
    } : prev);
  };

  const isApproved = isPermitApproved(permit?.status);
  const isAuthor = !permit?.created_by || permit?.created_by === user?.id;
  const readOnly = !isPermitEditable(permit?.status);
  const canSave = !readOnly && isAuthor;
  const canSubmit = !readOnly && isAuthor;
  // 발행 완료면 날짜 제한 없이 인쇄 가능
  const canPrint = isApproved;
  const canRequestExtend =
    !!permit &&
    APPROVED_PERMIT_STATUSES.has(permit.status || '') &&
    !data.work_extend_requested_until;

  const requestExtend = async () => {
    if (!id || !extendUntil) {
      toast({ title: '연장 종료 시각을 선택하세요.', variant: 'destructive' });
      return;
    }
    const iso = toDbTimestamp(extendUntil);
    if (!iso) {
      toast({ title: '연장 시각 형식이 올바르지 않습니다.', variant: 'destructive' });
      return;
    }
    setExtending(true);
    try {
      const { data: res, error } = await supabase.rpc('request_work_permit_extension' as any, {
        _permit_id: id,
        _extend_until: iso,
      });
      const r = res as any;
      if (error || r?.error) {
        const code = r?.error || error?.message || '';
        const msg =
          code === 'MUST_BE_AFTER_CURRENT_END' ? '현재 종료 시각보다 이후여야 합니다.'
          : code === 'MUST_BE_FUTURE' ? '현재 시각보다 이후여야 합니다.'
          : code === 'PENDING_POST_APPROVAL' ? '이미 종료/연장 결재가 진행 중입니다.'
          : code === 'NO_SM' ? '발주처 SM을 찾을 수 없습니다.'
          : code === 'NOT_APPROVED' ? '승인된 허가서만 연장할 수 있습니다.'
          : String(code);
        toast({ title: '연장 신청 실패', description: msg, variant: 'destructive' });
        return;
      }
      toast({ title: '연장 신청 완료', description: '발주처 SM에게 결재 요청이 전달되었습니다.' });
      setExtendOpen(false);
      setExtendUntil('');
      await load();
    } finally {
      setExtending(false);
    }
  };

  const print = async () => {
    if (!canPrint) {
      toast({
        title: '인쇄 불가',
        description: '결재 승인(발행 완료) 후 인쇄할 수 있습니다.',
        variant: 'destructive',
      });
      return;
    }
    document.title = `안전작업허가서_${permit?.work_description || permit?.id || ''}`;
    try {
      await (document as any).fonts?.load?.('16px "Noto Sans KR"');
      await (document as any).fonts?.ready;
    } catch { /* ignore */ }

    // Overlay path: only when a single overlay template is explicitly chosen
    try {
      let tpl: any = template && template.original_pdf_url ? template : null;
      if (tpl && selectedKinds.length === 1) {
        const { data: full } = await supabase
          .from('permit_form_templates')
          .select('signature_slots')
          .eq('id', tpl.id)
          .maybeSingle();
        tpl.signature_slots = full?.signature_slots || [];
        const path = (tpl.original_pdf_url as string).replace(/^.*permit-form-assets\//, '');
        const { data: signed } = await supabase.storage.from('permit-form-assets').createSignedUrl(path, 600);
        if (signed?.signedUrl) {
          const sigMap: Record<string, { signature?: string; name?: string }> = {};
          Object.entries(signatures || {}).forEach(([role, val]: [string, any]) => {
            if (val && typeof val === 'object') sigMap[role] = { signature: val.signature, name: val.name };
          });
          const approvedSigners = Object.entries(signatures || {})
            .filter(([, v]) => v && typeof v === 'object' && ((v as any).name || (v as any).signature))
            .map(([role, v]: [string, any]) => ({
              role,
              name: v.name || '',
              position: v.position || '',
              signatureImage: v.signature || '',
              approvedAt: v.signed_at || '',
              status: 'approved' as const,
            }));
          await printOverlay({
            pdfUrl: signed.signedUrl,
            overlay: tpl.print_overlay,
            values: { ...data, permit_date: permit.permit_date, work_description: permit.work_description },
            signatures: sigMap,
            signatureSlots: tpl.signature_slots || [],
            approvedSigners,
            title: document.title,
          });
          return;
        }
      }
    } catch (e) {
      console.warn('overlay print fallback', e);
    }

    // Standard path: selected kinds render as consecutive pages (print CSS page-break)
    window.print();
  };

  if (!permit) return <div className="p-6 text-sm text-muted-foreground">불러오는 중...</div>;

  const showBriefing = !!aiBriefing && (isApproved || IN_APPROVAL_PERMIT_STATUSES.has(permit.status));

  return (
    <div className="p-3 md:p-6 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/work-permits')}><ArrowLeft className="h-4 w-4 mr-1" />목록</Button>
          <h1 className="text-lg md:text-xl font-bold flex items-center gap-2"><FileSignature className="h-5 w-5" />안전작업허가서</h1>
          <Badge variant="outline">{permitStatusLabel(permit.status)}</Badge>
          <Badge variant="outline">{resolvePermitWorkDate(permit) || permit.permit_date}</Badge>
          <Badge variant="secondary" className="text-[10px]">{selectedKinds.length}종 묶음</Badge>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canSave && (
            <Button size="sm" variant="outline" onClick={save} disabled={saving}><Save className="h-4 w-4 mr-1" />저장</Button>
          )}
          {canSubmit && (
            <Button size="sm" variant="outline" onClick={async () => {
              await save();
              setApprovalOpen(true);
            }}><ShieldCheck className="h-4 w-4 mr-1" />결재상신</Button>
          )}
          <Button
            size="sm"
            onClick={print}
            disabled={!canPrint}
            title={!isApproved ? '결재 승인 후 인쇄 가능' : '선택된 허가서 종류를 연속 페이지로 출력'}
          >
            <Printer className="h-4 w-4 mr-1" />{canPrint ? '인쇄 / PDF' : '인쇄 불가'}
          </Button>
          {canRequestExtend && (
            <Button size="sm" variant="outline" onClick={() => setExtendOpen(true)}>
              <Clock className="h-4 w-4 mr-1" />연장 신청
            </Button>
          )}
          {!!data.work_extend_requested_until && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-700">연장 승인 대기</Badge>
          )}
          {!!data.work_extend_until && !data.work_extend_requested_until && (
            <Badge variant="secondary">연장됨</Badge>
          )}
        </div>
      </div>

      {showBriefing && (
        <div className="print:hidden">
          <PermitAiBriefingCard briefing={aiBriefing} />
        </div>
      )}

      <Card className="print:hidden">
        <CardContent className="p-3 text-sm">
          <span className="font-semibold mr-2">발행일 유효 위험성평가:</span>
          {linkedRuns.length === 0
            ? <span className="text-muted-foreground">해당 일자({permit.permit_date})에 유효한 승인완료 위험성평가가 없습니다.</span>
            : linkedRuns.map((r) => <Badge key={r.id} className="mr-1">{r.period_label}</Badge>)}
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardContent className="p-3">
          <PermitKindSelector
            value={selectedKinds}
            onChange={setSelectedKinds}
            disabled={readOnly}
          />
        </CardContent>
      </Card>

      <Tabs
        value={activeKind}
        onValueChange={(v) => setActiveKind(v as PermitKindId)}
        className="print:hidden"
      >
        <TabsList>
          {selectedKinds.map((k) => (
            <TabsTrigger key={k} value={k}>{PERMIT_KIND_LABEL[k]}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="print:hidden">
        <CardContent className="p-3 flex items-center gap-2 text-sm flex-wrap">
          <FileSignature className="h-4 w-4" />
          <span className="font-semibold">허가서 양식:</span>
          <Select value={templateId} onValueChange={setTemplateId} disabled={readOnly}>
            <SelectTrigger className="h-8 max-w-[460px]"><SelectValue placeholder="양식 선택" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={STANDARD_FORM_VALUE}>표준 SF003 양식 — 표준양식 스타일 적용</SelectItem>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  원본 PDF 오버레이 · {t.name} · {t.version}
                  {t.is_default ? ' (기본)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {readOnly && (
            <span className="text-xs text-muted-foreground">
              {isApproved ? '발행 완료 — 수정 불가' : IN_APPROVAL_PERMIT_STATUSES.has(permit.status) ? '결재 진행중 — 수정 불가' : '수정 잠금'}
            </span>
          )}
        </CardContent>
      </Card>

      {/* Screen edit: active kind only */}
      <div className="bg-white border rounded shadow-sm p-3 md:p-6 print:hidden">
        {template && template.original_pdf_url ? (
          <OverlayFillForm
            pdfUrl={template.original_pdf_url}
            layout={template.layout_json}
            overlay={template.print_overlay}
            values={data}
            signatures={signatures as any}
            autoFillContext={autoCtx}
            onChange={(v) => { if (!readOnly) setData(v); }}
            onSign={(role, sig) => { if (!readOnly) setSignatures({ ...signatures, [role]: sig } as any); }}
            readOnly={readOnly}
          />
        ) : (
          <StandardPermitSheet>
            <DigPermitForm
              permitType={activeKind}
              data={data}
              signatures={signatures}
              projectName={projectName}
              standardStyle={standardStyle}
              standardLabels={standardLabels}
              readOnly={readOnly}
              onChange={(d) => { if (!readOnly) setData(d); }}
              onSign={(k, v) => { if (!readOnly) setSignatures({ ...signatures, [k]: v }); }}
            />
          </StandardPermitSheet>
        )}
      </div>

      {/* Print-only: consecutive pages for each selected kind, same signatures stamped */}
      <div className="hidden print:block">
        {selectedKinds.map((kind, idx) => (
          <div key={kind} className={idx < selectedKinds.length - 1 ? 'page-break' : ''} style={idx < selectedKinds.length - 1 ? { pageBreakAfter: 'always' } : undefined}>
            <StandardPermitSheet>
              <DigPermitForm
                permitType={kind}
                data={data}
                signatures={signatures}
                projectName={projectName}
                standardStyle={standardStyle}
                standardLabels={standardLabels}
                readOnly
                printMode
              />
            </StandardPermitSheet>
          </div>
        ))}
      </div>

      {approvalOpen && (
        <SubmitApprovalDialog
          open={approvalOpen}
          onOpenChange={setApprovalOpen}
          entityType="work_permit"
          entityId={permit.id}
          projectId={permit.project_id}
          submitterCompanyId={permit.company_id || userCompanyId || null}
          permitBriefingContext={{
            permitKinds: selectedKinds,
            formData: data as Record<string, unknown>,
            workName: data.work_name || permit.work_name,
            workDescription: data.work_description || permit.work_description,
            workLocation: data.work_location || permit.location,
            permitDate: permit.permit_date,
          }}
          onSubmitted={() => { setApprovalOpen(false); load(); }}
        />
      )}

      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>작업허가 연장 신청</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              연장 종료 시각을 고른 뒤 신청하면 발주처 SM에게 결재가 갑니다. 승인되면 양식에 시간이 찍힙니다.
            </p>
            <div>
              <Label>연장 종료 시각</Label>
              <DateTimePicker
                className="w-full mt-1"
                value={extendUntil}
                onChange={setExtendUntil}
                placeholder="연장 종료 일시 선택"
              />
            </div>
            <Button className="w-full" onClick={requestExtend} disabled={extending || !extendUntil}>
              {extending ? '신청 중…' : '발주처 SM에게 연장 결재 요청'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
