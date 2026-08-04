/**
 * 작업허가서 상세 — 필요 종류 동적 선택, 단일 작업 묶음 결재, AI 브리핑, 연속 PDF 인쇄.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Printer, Save, FileSignature, ShieldCheck, Clock, Users, ClipboardList, UserCheck, Sparkles, CheckCircle2 } from 'lucide-react';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import DigPermitForm, { PermitFormData, PermitSignatures, PermitType } from '@/components/permits/DigPermitForm';
import StandardPermitSheet from '@/components/permits/StandardPermitSheet';
import WorkPermitWorkersDialog from '@/components/permits/WorkPermitWorkersDialog';
import PermitWorkersPrintPage, {
  type TbmParticipantPrint,
} from '@/components/permits/PermitWorkersPrintPage';
import type { PermitWorkerRow } from '@/lib/permitWorkers';
import { canManagePermitCrew, ensureTbmForPermit } from '@/lib/tbmFromPermit';
import { syncPermitCrewFromOnSite } from '@/lib/permitCrewSync';
import type { StandardStyle, StandardLabels } from '@/lib/permitStandardStyle';
import SubmitApprovalDialog from '@/components/approval/SubmitApprovalDialog';
import PermitKindSelector from '@/components/permits/PermitKindSelector';
import PermitAiBriefingCard from '@/components/permits/PermitAiBriefingCard';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import {
  normalizePermitKinds,
  primaryPermitKind,
  PERMIT_KIND_LABEL,
  type PermitKindId,
} from '@/lib/permitKinds';
import type { PermitAiBriefing } from '@/lib/permitBriefing';
import { syncPermitAssessmentLinks } from '@/lib/safetyWorkBundle';
import { contactPhonesFromApprovals, mergeApprovalSignatures } from '@/lib/permitApprovalSignatures';
import { syncPermitDateFromWorkStart, resolvePermitWorkDate } from '@/lib/permitWorkDate';
import {
  normalizeDisplayTemplate,
  parseLayoutJson,
  pickCompanyDisplayTemplate,
  pickGlobalStandardTemplate,
  resolveFormOwnerCompanyId,
  type PermitDisplayTemplate,
} from '@/lib/permitDisplayTemplate';
import {
  gasSaveErrorMessage,
  kindsNeedGasMeasurement,
  mergeGasReadingsIntoForm,
  pickGasReadings,
} from '@/lib/permitGasValidation';

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
  const { user, profile } = useAuth();
  const { userCompanyId, userRole, isMaster } = useGlobalProjectAccess();
  const canEditCrew = canManagePermitCrew(userRole, isMaster);

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
  const [requestingClosure, setRequestingClosure] = useState(false);
  const [saving, setSaving] = useState(false);
  const [standardStyle, setStandardStyle] = useState<Partial<StandardStyle> | null>(null);
  const [standardLabels, setStandardLabels] = useState<Partial<StandardLabels> | null>(null);
  const [displayTemplate, setDisplayTemplate] = useState<PermitDisplayTemplate | null>(null);
  const [displayTemplateId, setDisplayTemplateId] = useState<string | null>(null);
  const [displayTemplateName, setDisplayTemplateName] = useState<string | null>(null);
  const [aiBriefing, setAiBriefing] = useState<PermitAiBriefing | null>(null);
  const [assignedWorkers, setAssignedWorkers] = useState<PermitWorkerRow[]>([]);
  const [tbmTitle, setTbmTitle] = useState<string | null>(null);
  const [tbmParticipants, setTbmParticipants] = useState<TbmParticipantPrint[]>([]);
  const [workersDialogOpen, setWorkersDialogOpen] = useState(false);
  const [tbmBusy, setTbmBusy] = useState(false);
  const [crewBusy, setCrewBusy] = useState(false);

  const loadAssignedCrew = async (permitId: string, tbmSessionId?: string | null) => {
    const { data: links } = await supabase
      .from('work_permit_workers' as any)
      .select('worker_id')
      .eq('work_permit_id', permitId);
    const ids = ((links as any[]) || []).map((r) => r.worker_id).filter(Boolean);
    let rows: PermitWorkerRow[] = [];
    if (ids.length > 0) {
      const { data: ws } = await supabase
        .from('workers')
        .select('id, name, phone, company_name')
        .in('id', ids);
      const byId = new Map(((ws as any[]) || []).map((w) => [w.id, w]));
      rows = ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((w: any) => ({
          id: w.id,
          name: w.name || '-',
          phone: w.phone,
          company_name: w.company_name,
        }));
    }
    setAssignedWorkers(rows);

    if (tbmSessionId) {
      const [{ data: sess }, { data: parts }] = await Promise.all([
        supabase.from('tbm_sessions' as any).select('id, title').eq('id', tbmSessionId).maybeSingle(),
        supabase
          .from('tbm_participations' as any)
          .select('id, worker_name, company_name, worker_phone, participated_at, signature_data')
          .eq('tbm_session_id', tbmSessionId)
          .order('participated_at'),
      ]);
      setTbmTitle((sess as any)?.title || null);
      setTbmParticipants(((parts as any[]) || []) as TbmParticipantPrint[]);
    } else {
      setTbmTitle(null);
      setTbmParticipants([]);
    }
  };

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

    await loadAssignedCrew((p as any).id, (p as any).tbm_session_id);

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
      .select('position, approver_name, approver_id, status, approved_at, step_order, approval_version')
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

    // Autofill 안전관리자/관리감독자 연락처 from approver profiles (when empty)
    try {
      const ids = [...new Set(versioned.map((a: any) => a.approver_id).filter(Boolean))] as string[];
      if (ids.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, phone')
          .in('user_id', ids);
        const byUser: Record<string, string | null> = {};
        for (const row of profs || []) byUser[(row as any).user_id] = (row as any).phone;
        const phones = contactPhonesFromApprovals(versioned as any[], byUser);
        if (phones.safety_manager_phone || phones.supervisor_phone) {
          setData((cur) => ({
            ...cur,
            safety_manager_phone: cur.safety_manager_phone || phones.safety_manager_phone || '',
            supervisor_phone: cur.supervisor_phone || phones.supervisor_phone || '',
          }));
        }
      }
    } catch (e) {
      console.warn('approver phone autofill failed', e);
    }

    try {
      const companyId = (p as any).company_id || userCompanyId;
      const { data: comp } = companyId
        ? await supabase.from('companies').select('name').eq('id', companyId).maybeSingle()
        : { data: null };
      const companyName = (comp as any)?.name || '';
      if (companyName) {
        setData((current) => ({
          ...current,
          contractor_company: current.contractor_company || companyName,
          applicant_company: current.applicant_company || companyName,
        }));
      }
    } catch (e) { console.warn('company autofill failed', e); }
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
        const projectId = permit?.project_id as string | undefined;
        if (!projectId) {
          setStandardStyle(null);
          setStandardLabels(null);
          setDisplayTemplate(null);
          setDisplayTemplateId(null);
          setDisplayTemplateName(null);
          return;
        }
        const { data: proj } = await supabase
          .from('projects')
          .select('gc_company_id, gc_company_ids')
          .eq('id', projectId)
          .maybeSingle();
        const ownerCompanyId = resolveFormOwnerCompanyId(
          proj as any,
          (permit as any)?.company_id || null,
        );

        let holder: any = null;
        if (ownerCompanyId) {
          const { data: tpls } = await supabase
            .from('permit_form_templates')
            .select('id, name, code, version, layout_json, is_default, is_active, permit_type, project_id, company_id')
            .eq('is_deleted', false)
            .eq('is_active', true)
            .eq('company_id', ownerCompanyId)
            .order('is_default', { ascending: false })
            .order('updated_at', { ascending: false });
          holder = pickCompanyDisplayTemplate((tpls || []) as any[], ownerCompanyId, activeKind as PermitType);
        }

        // No company clone → shared global standard (company_id/project_id null)
        if (!holder) {
          const { data: globals } = await supabase
            .from('permit_form_templates')
            .select('id, name, code, version, layout_json, is_default, is_active, permit_type, project_id, company_id')
            .eq('is_deleted', false)
            .eq('is_active', true)
            .is('company_id', null)
            .is('project_id', null)
            .order('is_default', { ascending: false })
            .order('updated_at', { ascending: false });
          holder = pickGlobalStandardTemplate((globals || []) as any[], activeKind as PermitType);
        }

        if (!holder) {
          // No DB standard either → DigPermitForm code defaults
          setStandardStyle(null);
          setStandardLabels(null);
          setDisplayTemplate(null);
          setDisplayTemplateId(null);
          setDisplayTemplateName(null);
          return;
        }
        const layout = parseLayoutJson(holder.layout_json);
        setStandardStyle(layout.standard_style ?? null);
        setStandardLabels(layout.standard_labels ?? null);
        setDisplayTemplate(
          layout.display_template
            ? normalizeDisplayTemplate(layout.display_template)
            : null,
        );
        setDisplayTemplateId(holder.id);
        setDisplayTemplateName(holder.name);
      } catch (e) {
        console.warn('display template lookup failed', e);
        setStandardStyle(null);
        setStandardLabels(null);
        setDisplayTemplate(null);
        setDisplayTemplateId(null);
        setDisplayTemplateName(null);
      }
    })();
  }, [activeKind, permit?.id, permit?.project_id, permit?.company_id]);

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
      form_template_id: displayTemplateId || null,
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
  /** 발행·종료대기: 가스측정 입력/저장 (선택) */
  const gasFieldsEditable =
    !!permit &&
    (APPROVED_PERMIT_STATUSES.has(permit.status || '') ||
      CLOSURE_PENDING_STATUSES.has(permit.status || '')) &&
    !CLOSED_PERMIT_STATUSES.has(permit.status || '') &&
    kindsNeedGasMeasurement(selectedKinds);
  const canSaveGas = gasFieldsEditable;

  const scrollToGasFields = () => {
    if (typeof document === 'undefined') return;
    document.getElementById('permit-gas-fields')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  };

  const saveGasReadings = async () => {
    if (!id || !canSaveGas) return;
    const payload = pickGasReadings(data as Record<string, unknown>);
    if (Object.keys(payload).length === 0) {
      scrollToGasFields();
      toast({
        title: '가스측정 저장 실패',
        description: gasSaveErrorMessage('EMPTY_READINGS'),
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      const { data: res, error } = await (supabase as any).rpc('save_permit_gas_readings', {
        _permit_id: id,
        _readings: payload,
      });
      if (error || res?.error) {
        const code = res?.error || error?.message;
        if (code === 'EMPTY_READINGS') scrollToGasFields();
        toast({
          title: '가스측정 저장 실패',
          description: gasSaveErrorMessage(code),
          variant: 'destructive',
        });
        return;
      }
      setData((prev) => mergeGasReadingsIntoForm(prev as Record<string, unknown>, payload) as PermitFormData);
      toast({ title: '가스농도 측정값이 저장되었습니다.' });
    } finally {
      setSaving(false);
    }
  };
  // 발행 완료면 날짜 제한 없이 인쇄 가능
  const canPrint = isApproved;
  const canRequestExtend =
    !!permit &&
    APPROVED_PERMIT_STATUSES.has(permit.status || '') &&
    !CLOSED_PERMIT_STATUSES.has(permit.status || '') &&
    !CLOSURE_PENDING_STATUSES.has(permit.status || '') &&
    !data.work_extend_requested_until;

  /** 발행 완료: 관리감독자→SM 작업완료(종료) 결재 수동 요청 (가스측정 비필수) */
  const canRequestClosure =
    !!permit &&
    APPROVED_PERMIT_STATUSES.has(permit.status || '') &&
    !CLOSED_PERMIT_STATUSES.has(permit.status || '') &&
    !CLOSURE_PENDING_STATUSES.has(permit.status || '') &&
    !data.work_extend_requested_until;

  const requestClosure = async () => {
    if (!id || !canRequestClosure) return;
    setRequestingClosure(true);
    try {
      const { data: res, error } = await (supabase as any).rpc('request_work_permit_closure', {
        _permit_id: id,
      });
      const r = res as any;
      if (error || r?.error) {
        const code = r?.error || error?.message || '';
        const msg =
          code === 'PENDING_POST_APPROVAL' ? '이미 종료/연장 결재가 진행 중입니다.'
          : code === 'ALREADY_CLOSURE_PENDING' ? '이미 작업 완료 확인 대기 상태입니다.'
          : code === 'ALREADY_CLOSED' ? '이미 종료된 허가서입니다.'
          : code === 'NO_SM' ? '발주처 SM을 찾을 수 없습니다.'
          : code === 'NOT_APPROVED' ? '승인(발행)된 허가서만 요청할 수 있습니다.'
          : code === 'FORBIDDEN' ? '권한이 없습니다.'
          : code === 'GAS_MEASUREMENT_REQUIRED'
            ? '서버에 구 가스측정 필수 로직이 남아 있습니다. SQL(optional_permit_gas_closure)을 적용해 주세요.'
          : String(code);
        toast({ title: '작업완료 결재 요청 실패', description: msg, variant: 'destructive' });
        return;
      }
      toast({
        title: '작업완료 결재 요청 완료',
        description: '관리감독자·발주처 SM에게 완료 확인 결재가 전달되었습니다.',
      });
      await load();
    } finally {
      setRequestingClosure(false);
    }
  };

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

    // DigPermitForm 연속 페이지 인쇄만 사용 (PDF 오버레이 경로 제거)
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
          {canSaveGas && (
            <Button size="sm" variant="outline" onClick={saveGasReadings} disabled={saving}>
              <Save className="h-4 w-4 mr-1" />가스측정 저장
            </Button>
          )}
          {canRequestClosure && (
            <Button
              size="sm"
              onClick={requestClosure}
              disabled={requestingClosure || saving}
              title="작업 완료(종료) 결재를 요청합니다"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {requestingClosure ? '요청 중…' : '작업완료 결재 요청'}
            </Button>
          )}
          {canSubmit && (
            <Button size="sm" variant="outline" onClick={async () => {
              await save();
              setApprovalOpen(true);
            }}><ShieldCheck className="h-4 w-4 mr-1" />결재상신</Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setWorkersDialogOpen(true)}
            title="작업 인원 배정"
          >
            <Users className="h-4 w-4 mr-1" />인원 {assignedWorkers.length}
          </Button>
          <Button
            size="sm"
            onClick={print}
            disabled={!canPrint}
            title={!isApproved ? '결재 승인 후 인쇄 가능' : '허가서 + 인원 명단(뒷장) 연속 출력'}
          >
            <Printer className="h-4 w-4 mr-1" />{canPrint ? '인쇄 / PDF' : '인쇄 불가'}
          </Button>
          {canRequestExtend && (
            <Button size="sm" variant="outline" onClick={() => setExtendOpen(true)}>
              <Clock className="h-4 w-4 mr-1" />연장 작업
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

      <Card className="print:hidden" data-testid="permit-assigned-workers">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4" />
              작업 인원
              <Badge variant="secondary">{assignedWorkers.length}명</Badge>
              {Number(data.personnel_count || 0) !== assignedWorkers.length && assignedWorkers.length > 0 && (
                <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-400">
                  양식 인원 {data.personnel_count ?? 0}명 — 배정 저장 시 자동 맞춤
                </Badge>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setWorkersDialogOpen(true)}>
                예상 인원 배정
              </Button>
              {canEditCrew && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={crewBusy}
                  title="오늘 출근(미퇴근) 근로자로 명단을 갱신합니다"
                  onClick={async () => {
                    if (!permit) return;
                    setCrewBusy(true);
                    const res = await syncPermitCrewFromOnSite({
                      permitId: permit.id,
                      projectId: permit.project_id,
                      formData: data as any,
                    });
                    setCrewBusy(false);
                    if (!res.ok) {
                      toast({ title: '출근자 반영 실패', description: res.error, variant: 'destructive' });
                      return;
                    }
                    toast({ title: `실출근 ${res.count}명으로 명단 갱신` });
                    setData((d) => ({ ...d, personnel_count: res.count }));
                    await load();
                  }}
                >
                  <UserCheck className="h-4 w-4 mr-1" />
                  실출근으로 갱신
                </Button>
              )}
            </div>
          </div>
          {assignedWorkers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              전날: 예상 인원 배정 → 당일: 「실출근으로 갱신」으로 맞춥니다. 인쇄 뒷장(을지)에 명단이 나갑니다.
            </p>
          ) : (
            <ul className="text-xs grid sm:grid-cols-2 gap-1">
              {assignedWorkers.map((w) => (
                <li key={w.id} className="truncate border rounded px-2 py-1 bg-muted/40">
                  <span className="font-medium">{w.name}</span>
                  <span className="text-muted-foreground"> · {w.company_name || '-'}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="print:hidden" data-testid="permit-tbm-link">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="h-4 w-4" />
              당일 TBM
              {permit?.tbm_session_id ? (
                <Badge variant="secondary">연결됨</Badge>
              ) : (
                <Badge variant="outline">미연결</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {permit?.tbm_session_id ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('/app/admin/tbm-logs')}
                >
                  TBM 일지 열기
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={tbmBusy || !permit}
                  onClick={async () => {
                    if (!permit) return;
                    setTbmBusy(true);
                    const res = await ensureTbmForPermit({
                      permitId: permit.id,
                      projectId: permit.project_id,
                      leaderName: profile?.display_name || '',
                      companyId: permit.company_id || userCompanyId,
                      useAiDraft: true,
                    });
                    setTbmBusy(false);
                    if (!res.ok) {
                      toast({ title: 'TBM 생성 실패', description: res.error, variant: 'destructive' });
                      return;
                    }
                    toast({
                      title: res.reused ? '기존 TBM에 연결됨' : '당일 TBM 생성 · AI 초안 반영',
                      description: '브리핑 문장은 TBM 일지에서 수정할 수 있습니다.',
                    });
                    await load();
                  }}
                >
                  <Sparkles className="h-4 w-4 mr-1" />
                  {tbmBusy ? '생성 중…' : '당일 TBM 만들기'}
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            1허가서 = 1 TBM. 허가서 작업내용·위험요인을 가져와 일지를 만들고, AI는 브리핑 초안만 채웁니다.
            {permit?.tbm_session_id && tbmTitle
              ? ` 현재: 「${tbmTitle}」 · 참여자 ${tbmParticipants.length}명`
              : ''}
          </p>
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
          <span className="font-semibold">표시 양식:</span>
          <span className="text-muted-foreground">
            {displayTemplateName
              ? `${displayTemplateName}${
                  String(displayTemplateName || '').includes('기본 표준')
                    ? ' (공통 기본 표준)'
                    : ' (회사 표시양식 · 라벨/숨김만 적용)'
                }`
              : '코드 기본 양식 (DB 표준/회사 양식 없음)'}
          </span>
          {readOnly && (
            <span className="text-xs text-muted-foreground">
              {isApproved
                ? (gasFieldsEditable
                  ? '발행 완료 — 가스농도 측정은 선택 입력'
                  : '발행 완료 — 수정 불가')
                : IN_APPROVAL_PERMIT_STATUSES.has(permit.status)
                  ? '결재 진행중 — 수정 불가'
                  : '수정 잠금'}
            </span>
          )}
        </CardContent>
      </Card>

      {/* Screen edit: active kind only — always DigPermitForm */}
      <div className="bg-white border rounded shadow-sm p-3 md:p-6 print:hidden">
        <StandardPermitSheet>
          <DigPermitForm
            permitType={activeKind}
            data={data}
            signatures={signatures}
            projectName={projectName}
            standardStyle={standardStyle}
            standardLabels={standardLabels}
            displayTemplate={displayTemplate}
            readOnly={readOnly}
            gasFieldsEditable={gasFieldsEditable}
            onChange={(d) => {
              if (!readOnly) {
                setData(d);
                return;
              }
              if (gasFieldsEditable) {
                // 잠금 상태: 가스 키만 반영. 존재하는 키만 merge해 이전 입력 유실 방지.
                setData((prev) =>
                  mergeGasReadingsIntoForm(prev as Record<string, unknown>, d as Record<string, unknown>) as PermitFormData,
                );
              }
            }}
            onSign={(k, v) => { if (!readOnly) setSignatures({ ...signatures, [k]: v }); }}
          />
        </StandardPermitSheet>
      </div>

      {/* Print-only: consecutive kind pages + crew/TBM appendix (뒷장) */}
      <div className="hidden print:block">
        {selectedKinds.map((kind) => (
          <div key={kind} className="page-break" style={{ pageBreakAfter: 'always' }}>
            <StandardPermitSheet>
              <DigPermitForm
                permitType={kind}
                data={data}
                signatures={signatures}
                projectName={projectName}
                standardStyle={standardStyle}
                standardLabels={standardLabels}
                displayTemplate={displayTemplate}
                readOnly
                printMode
              />
            </StandardPermitSheet>
          </div>
        ))}
        <PermitWorkersPrintPage
          workTitle={data.work_name || data.work_description || permit.work_description}
          permitDate={resolvePermitWorkDate(permit) || permit.permit_date}
          projectName={projectName}
          workers={assignedWorkers}
          tbmTitle={tbmTitle}
          tbmParticipants={tbmParticipants}
        />
      </div>

      <WorkPermitWorkersDialog
        permit={permit}
        projectId={permit.project_id}
        open={workersDialogOpen}
        onClose={() => setWorkersDialogOpen(false)}
        onSaved={async (count) => {
          setData((d) => ({ ...d, personnel_count: count }));
          await load();
        }}
      />

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
            <DialogTitle>연장 작업</DialogTitle>
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
