/**
 * 작업허가서 상세 페이지 — 표준 SF003 양식(체크박스) + 결재서명 자동매핑.
 * - 작업계획서와 무관. permit_date에 해당하는 승인완료 위험성평가만 자동 연결.
 * - 결재(approvals) 통과 시 단계별 서명/이름/시간을 양식의 결재칸에 자동 표시.
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
import { ArrowLeft, Printer, Save, FileSignature, ShieldCheck } from 'lucide-react';
import DigPermitForm, { PermitFormData, PermitSignatures, PermitType } from '@/components/permits/DigPermitForm';
import StandardPermitSheet from '@/components/permits/StandardPermitSheet';
import type { StandardStyle, StandardLabels } from '@/lib/permitStandardStyle';
import OverlayFillForm from '@/components/permits/OverlayFillForm';
import SubmitApprovalDialog from '@/components/approval/SubmitApprovalDialog';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { printOverlay } from '@/lib/permitOverlayPrint';

const STANDARD_FORM_VALUE = '__standard__';

const PERMIT_TABS: { id: PermitType; label: string }[] = [
  { id: 'general', label: '일반' },
  { id: 'confined_space', label: '밀폐공간' },
  { id: 'hot_work', label: '화기' },
  { id: 'excavation', label: '굴착·중장비' },
];

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

// approvals.position / step 라벨 → DigPermitForm 서명 키
// SSOT(approvalRules) + 레거시 키 모두 수용
const ROLE_ALIAS_TO_SIG: Record<string, keyof PermitSignatures> = {
  // SSOT 5단계
  contractor_supervisor: 'contractor_pic',
  contractor_safety_manager: 'safety_pic',
  contractor_site_director: 'site_director',
  owner_cm: 'cm',
  owner_sm: 'sm',
  // 레거시 / 별칭
  contractor_pic: 'contractor_pic', applicant: 'contractor_pic', requester: 'contractor_pic',
  '담당자(시공)': 'contractor_pic', '시공담당': 'contractor_pic', '시공': 'contractor_pic',
  '협력사 관리감독자': 'contractor_pic', '관리감독자': 'contractor_pic',
  cm: 'cm', construction_manager: 'cm', '담당자(CM)': 'cm', CM: 'cm',
  '발주처 CM': 'cm', '공사관리': 'cm',
  safety_pic: 'safety_pic', safety_manager: 'safety_pic', safety: 'safety_pic',
  '담당자(안전)': 'safety_pic', '안전담당': 'safety_pic', '안전관리자': 'safety_pic',
  '협력사 안전관리자': 'safety_pic',
  sm: 'sm', safety_management: 'sm', '담당자(SM)': 'sm', SM: 'sm',
  '발주처 SM': 'sm',
  site_director: 'site_director', site_manager: 'site_director', director: 'site_director',
  '책임자(소장)': 'site_director', '소장': 'site_director', '현장소장': 'site_director',
  '협력사 현장소장': 'site_director',
  site_supervisor: 'site_supervisor', supervisor: 'site_supervisor', '현장감독자': 'site_supervisor',
};

function resolveSigKey(...hints: Array<string | null | undefined>): keyof PermitSignatures | null {
  for (const k of hints) {
    if (!k) continue;
    if (ROLE_ALIAS_TO_SIG[k]) return ROLE_ALIAS_TO_SIG[k];
    const lower = k.toLowerCase();
    if (ROLE_ALIAS_TO_SIG[lower]) return ROLE_ALIAS_TO_SIG[lower];
  }
  return null;
}

/** Asia/Seoul 기준 YYYY-MM-DD (UTC slice 오차 방지) */
function todayKst(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

type ApprovedStep = {
  position?: string | null;
  step?: string | null;
  step_order?: number | null;
  approver_name?: string | null;
  status: string;
  approved_at?: string | null;
};

/** 전자결재 approvals 행 → 양식 서명칸 / 오버레이 결재자 */
function mergeApprovalsIntoSignatures(
  base: PermitSignatures,
  steps: ApprovedStep[],
): { signatures: PermitSignatures; approvedSigners: Array<{
  role: string;
  name: string;
  position: string;
  signatureImage: string;
  approvedAt: string;
  status: 'approved' | 'pending' | 'rejected';
}> } {
  const merged: PermitSignatures = { ...base };
  const approvedSigners: Array<{
    role: string;
    name: string;
    position: string;
    signatureImage: string;
    approvedAt: string;
    status: 'approved' | 'pending' | 'rejected';
  }> = [];
  let lastApproved: string | undefined;

  for (const a of steps) {
    const done = a.status === '승인' || a.status === 'approved';
    const sigKey = resolveSigKey(a.position, a.step);
    const role = sigKey || a.position || a.step || `step_${a.step_order ?? approvedSigners.length + 1}`;
    const existing = sigKey ? (merged as any)[sigKey] : null;

    approvedSigners.push({
      role: String(role),
      name: a.approver_name || existing?.name || '',
      position: a.position || a.step || '',
      signatureImage: existing?.signature || '',
      approvedAt: a.approved_at || existing?.signed_at || '',
      status: done ? 'approved' : a.status === '반려' || a.status === 'rejected' ? 'rejected' : 'pending',
    });

    if (!done || !sigKey) continue;
    if (!existing?.signature) {
      (merged as any)[sigKey] = {
        name: a.approver_name || existing?.name || '',
        signature: existing?.signature || '',
        signed_at: a.approved_at || existing?.signed_at || '',
      };
    } else if (!existing.name && a.approver_name) {
      (merged as any)[sigKey] = { ...existing, name: a.approver_name, signed_at: a.approved_at || existing.signed_at };
    }
    if (a.approved_at) lastApproved = a.approved_at;
  }

  if (lastApproved) {
    merged.approved_at = lastApproved;
    merged.reviewed_at = new Date(new Date(lastApproved).getTime() - 86400000).toISOString();
  }
  return { signatures: merged, approvedSigners };
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


export default function WorkPermitDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { userCompanyId } = useGlobalProjectAccess();

  const [permit, setPermit] = useState<any>(null);
  const [projectName, setProjectName] = useState('');
  const [tab, setTab] = useState<PermitType>('general');
  const [data, setData] = useState<PermitFormData>({});
  const [signatures, setSignatures] = useState<PermitSignatures>({});
  const [linkedRuns, setLinkedRuns] = useState<any[]>([]);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState<string>(STANDARD_FORM_VALUE);
  const [standardStyle, setStandardStyle] = useState<Partial<StandardStyle> | null>(null);
  const [standardLabels, setStandardLabels] = useState<Partial<StandardLabels> | null>(null);
  const [autoCtx, setAutoCtx] = useState<any>({});
  const template = useMemo(
    () => (templateId && templateId !== STANDARD_FORM_VALUE ? templates.find((t) => t.id === templateId) || null : null),
    [templates, templateId]
  );

  const load = async () => {
    if (!id) return;
    const { data: p, error } = await supabase.from('work_permits' as any).select('*').eq('id', id).single();
    if (error || !p) { toast({ title: '허가서를 불러오지 못했습니다.', variant: 'destructive' }); return; }
    setPermit(p);
    setTab(((p as any).permit_type || 'general') as PermitType);
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
    const baseSig: PermitSignatures = (p as any).signatures || {};

    // 프로젝트명
    if ((p as any).project_id) {
      const { data: proj } = await supabase.from('projects').select('name').eq('id', (p as any).project_id).single();
      setProjectName((proj as any)?.name || '');
    }

    // permit_date 기준 — 같은 프로젝트 + 같은 날짜 유효 + 승인완료 위험성평가 자동 매칭
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

    // 전자결재 approvals → 서명칸/승인일 자동 매핑 (entity_type/entity_id SSOT)
    const { data: aps } = await supabase
      .from('approvals')
      .select('position, step, step_order, approver_name, status, approved_at')
      .eq('entity_type', 'work_permit')
      .eq('entity_id', id)
      .in('status', ['승인', 'approved'])
      .order('step_order', { ascending: true });
    const { signatures: merged } = mergeApprovalsIntoSignatures(baseSig, (aps || []) as ApprovedStep[]);
    setSignatures(merged);


    // 자동 채움 컨텍스트(작성자/회사/프로젝트/permit_date) 구성
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

  // 종류(tab)별 사용 가능한 양식 목록을 모두 조회 — 사용자가 드롭다운으로 선택
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
        // 이 종류(tab)에 해당하거나 general인 원본 PDF 오버레이 양식만 별도 노출
        const usable = list.filter((t) => {
          const typeOk = !t.permit_type || t.permit_type === tab || t.permit_type === 'general';
          const hasOverlay = t.original_pdf_url && (t.print_overlay?.pages?.length || 0) > 0;
          return typeOk && hasOverlay;
        });
        setTemplates(usable);
        // 표준 양식 스타일은 작성 화면의 기본값이며, 현재 허가서 종류의 기본 양식을 우선 적용
        const styleHolder = pickStandardStyleHolder(list, tab);
        setStandardStyle((styleHolder?.layout_json as any)?.standard_style ?? null);
        setStandardLabels((styleHolder?.layout_json as any)?.standard_labels ?? null);
        // 저장된 template_id가 원본 PDF 오버레이일 때만 고급 양식으로 진입. 기본은 표준 SF003.
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
  }, [tab, permit?.id]);


  const save = async () => {
    if (!permit) return;
    setSaving(true);
    const syncedData: PermitFormData = { ...data };
    const workDescription = syncedData.work_description || permit.work_description || '';
    const workLocation = syncedData.work_location || permit.location || permit.work_location || '';
    const contractorCompany = syncedData.contractor_company || permit.contractor_company || '';
    const { error } = await supabase.from('work_permits' as any).update({
      permit_type: tab,
      form_data: syncedData,
      signatures,
      linked_assessment_run_ids: linkedRuns.map(r => r.id),
      form_version: 'SF003-Rev1',
      form_template_id: templateId && templateId !== STANDARD_FORM_VALUE ? templateId : null,
      work_name: syncedData.work_name || permit.work_name || workDescription,
      work_description: workDescription,
      location: workLocation,
      contractor_company: contractorCompany,
      personnel_count: Number(syncedData.personnel_count || permit.personnel_count || 0),
      work_start_at: toDbTimestamp(syncedData.work_start) || permit.work_start_at || null,
      work_end_at: toDbTimestamp(syncedData.work_end) || permit.work_end_at || null,
    }).eq('id', permit.id);
    setSaving(false);
    if (error) return toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    toast({ title: '허가서가 저장되었습니다.' });
  };

  const today = todayKst();
  const isToday = permit?.permit_date === today;
  const isApproved = permit?.status === '승인' || permit?.status === '승인완료' || permit?.status === 'approved';
  const isExpired = permit?.valid_until ? new Date(permit.valid_until).getTime() < Date.now() : false;
  // 최종 승인 완료 후 PDF 저장/인쇄 가능 (허가일=오늘 강제 제거 — 아카이브·증빙용)
  const canPrint = isApproved && !isExpired;

  const print = async () => {
    if (!canPrint) {
      toast({
        title: '인쇄 불가',
        description: !isApproved
          ? '결재 승인 후 인쇄할 수 있습니다.'
          : '유효기간이 종료되었습니다.',
        variant: 'destructive',
      });
      return;
    }
    document.title = `안전작업허가서_${permit?.work_description || permit?.id || ''}`;
    try {
      await (document as any).fonts?.load?.('16px "Noto Sans KR"');
      await (document as any).fonts?.ready;
    } catch { /* ignore */ }

    // 결재 완료 스텝 → 오버레이 도장/성명용
    let approvedSigners: ReturnType<typeof mergeApprovalsIntoSignatures>['approvedSigners'] = [];
    let printSignatures = signatures;
    try {
      const { data: aps } = await supabase
        .from('approvals')
        .select('position, step, step_order, approver_name, status, approved_at')
        .eq('entity_type', 'work_permit')
        .eq('entity_id', permit.id)
        .order('step_order', { ascending: true });
      const merged = mergeApprovalsIntoSignatures(signatures, (aps || []) as ApprovedStep[]);
      approvedSigners = merged.approvedSigners;
      printSignatures = merged.signatures;
      setSignatures(merged.signatures);
    } catch (e) {
      console.warn('approval fetch for print failed', e);
    }

    try {
      let tpl: any = template && template.original_pdf_url ? template : null;
      if (tpl) {
        const { data: full } = await supabase
          .from('permit_form_templates')
          .select('signature_slots')
          .eq('id', tpl.id)
          .maybeSingle();
        tpl.signature_slots = full?.signature_slots || [];
      }
      if (tpl) {
        const path = (tpl.original_pdf_url as string).replace(/^.*permit-form-assets\//, '');
        const { data: signed } = await supabase.storage.from('permit-form-assets').createSignedUrl(path, 600);
        if (signed?.signedUrl) {
          const sigMap: Record<string, { signature?: string; name?: string }> = {};
          Object.entries(printSignatures || {}).forEach(([role, val]: [string, any]) => {
            if (val && typeof val === 'object' && (val.signature || val.name)) {
              sigMap[role] = { signature: val.signature, name: val.name };
            }
          });

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
    // 표준 SF003: 브라우저 인쇄 → PDF로 저장 (결재 성명·일자가 폼에 반영된 뒤)
    await new Promise((r) => setTimeout(r, 50));
    window.print();
  };

  if (!permit) return <div className="p-6 text-sm text-muted-foreground">불러오는 중...</div>;

  return (
    <div className="p-3 md:p-6 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/work-permits')}><ArrowLeft className="h-4 w-4 mr-1" />목록</Button>
          <h1 className="text-lg md:text-xl font-bold flex items-center gap-2"><FileSignature className="h-5 w-5" />안전작업허가서</h1>
          <Badge variant="outline">{permit.status}</Badge>
          <Badge variant="outline">{permit.permit_date}</Badge>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={save} disabled={saving}><Save className="h-4 w-4 mr-1" />저장</Button>
          {!isApproved && (
            <Button size="sm" variant="outline" onClick={() => setApprovalOpen(true)}><ShieldCheck className="h-4 w-4 mr-1" />결재상신</Button>
          )}
          <Button
            size="sm"
            onClick={print}
            disabled={!canPrint}
            title={
              !isApproved
                ? '결재 승인 후 인쇄 가능'
                : isExpired
                ? '유효기간 종료'
                : !isToday
                ? '허가일과 오늘이 다릅니다(증빙용 인쇄는 가능)'
                : '인쇄 / PDF로 저장'
            }
          >
            <Printer className="h-4 w-4 mr-1" />{canPrint ? '인쇄 / PDF 저장' : '인쇄 불가'}
          </Button>
        </div>
      </div>

      {/* 자동 연결된 위험성평가 */}
      <Card className="print:hidden">
        <CardContent className="p-3 text-sm">
          <span className="font-semibold mr-2">발행일 유효 위험성평가:</span>
          {linkedRuns.length === 0
            ? <span className="text-muted-foreground">해당 일자({permit.permit_date})에 유효한 승인완료 위험성평가가 없습니다.</span>
            : linkedRuns.map(r => <Badge key={r.id} className="mr-1">{r.period_label}</Badge>)}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as PermitType)} className="print:hidden">
        <TabsList>
          {PERMIT_TABS.map(t => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {/* 양식 선택 드롭다운 */}
      <Card className="print:hidden">
        <CardContent className="p-3 flex items-center gap-2 text-sm flex-wrap">
          <FileSignature className="h-4 w-4" />
          <span className="font-semibold">허가서 양식:</span>
          <Select value={templateId} onValueChange={setTemplateId}>
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
          {templates.length === 0 && (
            <span className="text-xs text-muted-foreground">(추가 양식은 시스템 › 허가서 양식 디자인에서 등록 가능)</span>
          )}
        </CardContent>
      </Card>

      <div className="bg-white border rounded shadow-sm p-3 md:p-6 print:border-0 print:shadow-none print:p-0">
        {template && template.original_pdf_url ? (
          <OverlayFillForm
            pdfUrl={template.original_pdf_url}
            layout={template.layout_json}
            overlay={template.print_overlay}
            values={data}
            signatures={signatures as any}
            autoFillContext={autoCtx}
            onChange={(v) => setData(v)}
            onSign={(role, sig) => setSignatures({ ...signatures, [role]: sig } as any)}
            readOnly={isApproved}
          />
        ) : (
          // 디자인 미리보기와 동일한 표준 A4 시트에서 렌더해 셀 폭/로고/인쇄 조건 통일
          <StandardPermitSheet>
            <DigPermitForm
              permitType={tab}
              data={data}
              signatures={signatures}
              projectName={projectName}
              standardStyle={standardStyle}
              standardLabels={standardLabels}
              onChange={(d) => setData(d)}
              onSign={(k, v) => setSignatures({ ...signatures, [k]: v })}
              readOnly={isApproved}
              printMode={isApproved}
            />
          </StandardPermitSheet>
        )}
      </div>



      {approvalOpen && (
        <SubmitApprovalDialog
          open={approvalOpen}
          onOpenChange={setApprovalOpen}
          entityType="work_permit"
          entityId={permit.id}
          projectId={permit.project_id}
          submitterCompanyId={permit.company_id || userCompanyId || null}
          onSubmitted={() => { setApprovalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
