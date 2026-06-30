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
import { ArrowLeft, Printer, Save, FileSignature, ShieldCheck } from 'lucide-react';
import DigPermitForm, { PermitFormData, PermitSignatures, PermitType } from '@/components/permits/DigPermitForm';
import SubmitApprovalDialog from '@/components/approval/SubmitApprovalDialog';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { printOverlay } from '@/lib/permitOverlayPrint';

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

  const save = async () => {
    if (!permit) return;
    setSaving(true);
    const { error } = await supabase.from('work_permits' as any).update({
      permit_type: tab,
      form_data: data,
      signatures,
      linked_assessment_run_ids: linkedRuns.map(r => r.id),
      form_version: 'SF003-Rev1',
    }).eq('id', permit.id);
    setSaving(false);
    if (error) return toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    toast({ title: '허가서가 저장되었습니다.' });
  };

  const print = () => {
    document.title = `안전작업허가서_${permit?.work_description || permit?.id || ''}`;
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
          <Button size="sm" onClick={print}><Printer className="h-4 w-4 mr-1" />인쇄</Button>
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

      <div className="bg-white border rounded shadow-sm p-3 md:p-6 print:border-0 print:shadow-none print:p-0">
        <DigPermitForm
          permitType={tab}
          data={data}
          signatures={signatures}
          projectName={projectName}
          onChange={(d) => setData(d)}
          onSign={(k, v) => setSignatures({ ...signatures, [k]: v })}
        />
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
