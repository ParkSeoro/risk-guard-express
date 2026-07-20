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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Printer, Save, FileSignature, ShieldCheck, Table2 } from 'lucide-react';
import DigPermitForm, { PermitFormData, PermitSignatures, PermitType } from '@/components/permits/DigPermitForm';
import OverlayFillForm from '@/components/permits/OverlayFillForm';
import GridFillForm from '@/components/permit-grid/GridFillForm';
import SubmitApprovalDialog from '@/components/approval/SubmitApprovalDialog';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { printOverlay } from '@/lib/permitOverlayPrint';
import type { GridBook } from '@/lib/xlsxGrid';
import type { InputCell } from '@/lib/permitGridTypes';

const PERMIT_TABS: { id: PermitType; label: string }[] = [
  { id: 'general', label: '일반' },
  { id: 'confined_space', label: '밀폐공간' },
  { id: 'hot_work', label: '화기' },
  { id: 'excavation', label: '굴착·중장비' },
];

// approvals.position → DigPermitForm 서명 키 매핑 (회사가 합의한 5단계 결재선)
const POSITION_TO_SIG: Record<string, keyof PermitSignatures> = {
  contractor_pic: 'contractor_pic',
  cm: 'cm',
  safety_pic: 'safety_pic',
  sm: 'sm',
  site_director: 'site_director',
  site_supervisor: 'site_supervisor',
  // 협조(cooperator)는 별도 서명칸 없음 — 표시는 결재선 화면에서 처리
};

export default function WorkPermitDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { userCompanyId } = useProjectAccess();

  const [permit, setPermit] = useState<any>(null);
  const [projectName, setProjectName] = useState('');
  const [tab, setTab] = useState<PermitType>('general');
  const [data, setData] = useState<PermitFormData>({});
  const [signatures, setSignatures] = useState<PermitSignatures>({});
  const [linkedRuns, setLinkedRuns] = useState<any[]>([]);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const template = useMemo(() => templates.find((t) => t.id === templateId) || null, [templates, templateId]);

  const load = async () => {
    if (!id) return;
    const { data: p, error } = await supabase.from('work_permits' as any).select('*').eq('id', id).single();
    if (error || !p) { toast({ title: '허가서를 불러오지 못했습니다.', variant: 'destructive' }); return; }
    setPermit(p);
    setTab(((p as any).permit_type || 'general') as PermitType);
    setData((p as any).form_data || {});
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

    // approvals → 서명/시간 자동 매핑
    const { data: aps } = await supabase
      .from('approvals')
      .select('position, approver_name, status, approved_at, comment')
      .eq('entity_type', 'work_permit')
      .eq('entity_id', id)
      .eq('status', '승인')
      .order('step_order', { ascending: true });
    const merged: PermitSignatures = { ...baseSig };
    let lastApproved: string | undefined;
    (aps || []).forEach((a: any) => {
      const sigKey = POSITION_TO_SIG[a.position as string];
      if (!sigKey) return;
      const existing = (merged as any)[sigKey];
      if (!existing?.signature) {
        // 손서명이 없는 경우 텍스트 도장 처리
        (merged as any)[sigKey] = {
          name: a.approver_name || '',
          signature: '',
          signed_at: a.approved_at || '',
        };
      }
      if (a.approved_at) lastApproved = a.approved_at;
    });
    if (lastApproved) merged.approved_at = lastApproved;
    setSignatures(merged);
  };

  useEffect(() => { load(); }, [id]);

  // 종류(tab)별 사용 가능한 양식 목록을 모두 조회 — 사용자가 드롭다운으로 선택
  useEffect(() => {
    (async () => {
      try {
        const { data: tpls } = await supabase
          .from('permit_form_templates')
          .select('id, name, code, version, layout_json, print_overlay, original_pdf_url, is_default, permit_type, grid_snapshot, input_cells, source_xlsx_url')
          .eq('is_deleted', false)
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .order('updated_at', { ascending: false });
        const list = (tpls || []) as any[];
        // 이 종류(tab)에 해당하거나 general인 양식 + 실제로 렌더 가능한 것만
        const usable = list.filter((t) => {
          const typeOk = !t.permit_type || t.permit_type === tab || t.permit_type === 'general';
          const hasGrid = t.grid_snapshot?.sheets?.length > 0;
          const hasOverlay = t.original_pdf_url && (t.print_overlay?.pages?.length || 0) > 0;
          return typeOk && (hasGrid || hasOverlay);
        });
        setTemplates(usable);
        // 저장된 template_id가 있으면 사용, 아니면 이 종류의 기본을 자동 선택
        const saved = (permit as any)?.form_template_id;
        const preferred =
          usable.find((t) => t.id === saved) ||
          usable.find((t) => t.permit_type === tab && t.is_default) ||
          usable.find((t) => t.permit_type === tab) ||
          usable[0];
        setTemplateId(preferred?.id || '');
      } catch (e) {
        console.warn('template lookup failed', e);
        setTemplates([]);
        setTemplateId('');
      }
    })();
  }, [tab, permit?.id]);

  const save = async () => {
    if (!permit) return;
    setSaving(true);
    const { error } = await supabase.from('work_permits' as any).update({
      permit_type: tab,
      form_data: data,
      signatures,
      linked_assessment_run_ids: linkedRuns.map(r => r.id),
      form_version: 'SF003-Rev1',
      form_template_id: templateId || null,
    }).eq('id', permit.id);
    setSaving(false);
    if (error) return toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    toast({ title: '허가서가 저장되었습니다.' });
  };

  const today = new Date().toISOString().slice(0, 10);
  const isToday = permit?.permit_date === today;
  const isApproved = permit?.status === '승인' || permit?.status === '승인완료' || permit?.status === 'approved';
  const isExpired = permit?.valid_until ? new Date(permit.valid_until).getTime() < Date.now() : false;
  const canPrint = isApproved && isToday && !isExpired;

  const print = async () => {
    if (!canPrint) {
      toast({
        title: '인쇄 불가',
        description: !isApproved ? '결재 승인 후 인쇄할 수 있습니다.' :
                    !isToday ? '허가일자와 오늘 날짜가 일치해야 인쇄할 수 있습니다.' :
                    '유효기간이 종료되었습니다.',
        variant: 'destructive',
      });
      return;
    }
    document.title = `안전작업허가서_${permit?.work_description || permit?.id || ''}`;
    // 폰트 로딩 보장 (한글 깨짐 방지)
    try {
      await (document as any).fonts?.load?.('16px "Noto Sans KR"');
      await (document as any).fonts?.ready;
    } catch {}
    // 1) 화면에 로드된 템플릿 우선. 없으면 활성+기본 순으로 탐색
    try {
      let tpl: any = template && template.original_pdf_url ? template : null;
      if (!tpl) {
        const { data: tpls } = await supabase
          .from('permit_form_templates')
          .select('id, name, original_pdf_url, print_overlay, signature_slots, is_default, is_active, permit_type')
          .eq('is_deleted', false)
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .limit(10);
        tpl = (tpls || []).find((t: any) =>
          t.original_pdf_url && (t.print_overlay?.pages?.length || 0) > 0 && (t.permit_type === tab || !t.permit_type),
        ) || (tpls || []).find((t: any) =>
          t.original_pdf_url && (t.print_overlay?.pages?.length || 0) > 0,
        );
      } else {
        // template state에 signature_slots가 없을 수 있으니 재조회
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
          Object.entries(signatures || {}).forEach(([role, val]: [string, any]) => {
            if (val && typeof val === 'object') sigMap[role] = { signature: val.signature, name: val.name };
          });

          // 결재라인 → approvedSigners 로 자동 매핑
          const approvedSigners: any[] = [];
          try {
            const { data: appr } = await (supabase as any)
              .from('approvals')
              .select('id, status')
              .eq('target_type', 'work_permit')
              .eq('target_id', permit.id)
              .order('created_at', { ascending: false })
              .limit(1);
            const apprId = appr?.[0]?.id;
            if (apprId) {
              const { data: steps } = await (supabase as any)
                .from('approval_lines')
                .select('step_order, role, approver_name, approver_position, signature_image, status, approved_at')
                .eq('approval_id', apprId)
                .order('step_order', { ascending: true });
              (steps || []).forEach((s: any, idx: number) => {
                approvedSigners.push({
                  role: s.role || `step_${idx + 1}`,
                  name: s.approver_name || '',
                  position: s.approver_position || '',
                  signatureImage: s.signature_image || '',
                  approvedAt: s.approved_at || '',
                  status: s.status === 'approved' ? 'approved' : s.status === 'rejected' ? 'rejected' : 'pending',
                });
              });
            }
          } catch (e) { console.warn('approval line fetch failed', e); }

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
    // 2) 폴백: 기존 브라우저 인쇄
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
          <Button size="sm" variant="outline" onClick={() => setApprovalOpen(true)}><ShieldCheck className="h-4 w-4 mr-1" />결재상신</Button>
          <Button
            size="sm"
            onClick={print}
            disabled={!canPrint}
            title={!isApproved ? '결재 승인 후 인쇄 가능' : !isToday ? '오늘 날짜 허가서만 인쇄 가능' : isExpired ? '유효기간 종료' : ''}
          >
            <Printer className="h-4 w-4 mr-1" />{canPrint ? '인쇄 / 작업시작' : '인쇄 불가'}
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
          {templates.length === 0 ? (
            <span className="text-muted-foreground">이 종류에 사용 가능한 양식이 없습니다. (시스템 › 허가서 양식 디자인에서 등록)</span>
          ) : (
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="h-8 max-w-[420px]"><SelectValue placeholder="양식 선택" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.grid_snapshot?.sheets?.length > 0 ? '📊 ' : '📄 '}{t.name} · {t.version}
                    {t.is_default ? ' (기본)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {template?.grid_snapshot?.sheets?.length > 0 && (
            <Badge variant="outline" className="ml-1"><Table2 className="h-3 w-3 mr-1" />엑셀 그리드</Badge>
          )}
        </CardContent>
      </Card>

      <div className="bg-white border rounded shadow-sm p-3 md:p-6 print:border-0 print:shadow-none print:p-0">
        {template && template.grid_snapshot?.sheets?.length > 0 ? (
          <GridFillForm
            book={template.grid_snapshot as GridBook}
            inputCells={(template.input_cells || []) as InputCell[]}
            values={data}
            onChange={(v) => setData(v)}
            readOnly={isApproved}
          />
        ) : template && template.original_pdf_url ? (
          <OverlayFillForm
            pdfUrl={template.original_pdf_url}
            layout={template.layout_json}
            overlay={template.print_overlay}
            values={data}
            signatures={signatures as any}
            onChange={(v) => setData(v)}
            onSign={(role, sig) => setSignatures({ ...signatures, [role]: sig } as any)}
            readOnly={isApproved}
          />
        ) : (
          <DigPermitForm
            permitType={tab}
            data={data}
            signatures={signatures}
            projectName={projectName}
            onChange={(d) => setData(d)}
            onSign={(k, v) => setSignatures({ ...signatures, [k]: v })}
          />
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
