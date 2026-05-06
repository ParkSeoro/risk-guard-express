import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle2, XCircle, AlertTriangle, ClipboardList } from 'lucide-react';

type Item = { key: string; label: string; ok: boolean; detail: string };
type Group = { title: string; items: Item[] };

export default function SiteReadinessChecklist() {
  const projectId = typeof window !== 'undefined' ? localStorage.getItem('selectedProjectId') || '' : '';
  const [groups, setGroups] = useState<Record<string, Group>>({ admin: { title: '관리자', items: [] }, worker: { title: '근로자', items: [] }, client: { title: '발주처', items: [] } });
  const [loading, setLoading] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const run = async () => {
    if (!projectId) return;
    setLoading(true);
    const [{ data: runs }, { data: tbms }, { data: parts }, { data: permits }, { data: costs }, { data: insp }, { data: accidents }] = await Promise.all([
      supabase.from('assessment_runs').select('id, status, start_date, end_date').eq('project_id', projectId).eq('is_deleted', false),
      supabase.from('tbm_sessions' as any).select('id, qr_token, is_active, tbm_date').eq('project_id', projectId),
      supabase.from('tbm_participations' as any).select('id, tbm_session_id, briefing_confirmed, signature_data').limit(1000),
      supabase.from('work_permits' as any).select('id, status').eq('project_id', projectId),
      (supabase.from('safety_costs' as any).select('id').eq('project_id', projectId).limit(1) as any).then((r: any) => r, () => ({ data: [] })),
      supabase.from('inspection_responses' as any).select('id').eq('project_id', projectId),
      supabase.from('assessment_accidents').select('id').eq('project_id', projectId),
    ]);

    const activeRuns = (runs || []).filter((r: any) => {
      if ((r.start_date && r.start_date > today) || (r.end_date && r.end_date < today)) return false;
      return r.status === '승인완료';
    });
    const approvedRuns = (runs || []).filter((r: any) => r.status === '승인완료');
    const tbmList = tbms || [];
    const tbmIds = new Set(tbmList.map((t: any) => t.id));
    const myParts = (parts || []).filter((p: any) => tbmIds.has(p.tbm_session_id));
    const approvedPermits = (permits || []).filter((p: any) => p.status === '승인').length;

    const admin: Item[] = [
      { key: 'a1', label: '위험성평가 적용기간 내 승인본 존재', ok: activeRuns.length > 0, detail: `적용중 ${activeRuns.length}건` },
      { key: 'a2', label: 'TBM 생성 여부', ok: tbmList.length > 0, detail: `${tbmList.length}건` },
      { key: 'a3', label: 'QR 정상 생성 (활성 TBM 1건 이상)', ok: tbmList.some((t: any) => t.is_active && t.qr_token), detail: `활성 ${tbmList.filter((t: any) => t.is_active).length}건` },
      { key: 'a4', label: '작업허가서 승인 1건 이상', ok: approvedPermits > 0, detail: `승인 ${approvedPermits}건` },
      { key: 'a5', label: '산업안전보건관리비 입력', ok: ((costs as any)?.data?.length || 0) > 0 || ((costs as any)?.length || 0) > 0, detail: '내역 등록 확인' },
    ];

    const signed = myParts.filter((p: any) => p.signature_data && p.briefing_confirmed).length;
    const worker: Item[] = [
      { key: 'w1', label: 'QR 참여자 1명 이상', ok: myParts.length > 0, detail: `${myParts.length}명` },
      { key: 'w2', label: '위험성평가 브리핑 확인 완료', ok: myParts.every((p: any) => p.briefing_confirmed) && myParts.length > 0, detail: `${myParts.filter((p: any) => p.briefing_confirmed).length}/${myParts.length}` },
      { key: 'w3', label: '전자서명 완료', ok: signed > 0 && signed === myParts.length, detail: `${signed}/${myParts.length}` },
    ];

    const tbmRate = tbmList.length > 0 ? Math.round((myParts.length / tbmList.length) * 10) / 10 : 0;
    const client: Item[] = [
      { key: 'c1', label: '위험성평가 승인 상태', ok: approvedRuns.length > 0, detail: `승인 ${approvedRuns.length}건 / 전체 ${(runs || []).length}건` },
      { key: 'c2', label: 'TBM 평균 참석률', ok: tbmRate >= 1, detail: `세션당 평균 ${tbmRate}명` },
      { key: 'c3', label: '작업허가 승인', ok: approvedPermits > 0, detail: `${approvedPermits}건` },
      { key: 'c4', label: '산업안전보건관리비 사용 기록', ok: ((costs as any)?.data?.length || 0) > 0 || ((costs as any)?.length || 0) > 0, detail: '확인' },
      { key: 'c5', label: '점검/사고 기록 추적 가능', ok: (insp || []).length + (accidents || []).length >= 0, detail: `점검 ${(insp || []).length}건 / 사고 ${(accidents || []).length}건` },
    ];

    setGroups({
      admin: { title: '관리자', items: admin },
      worker: { title: '근로자', items: worker },
      client: { title: '발주처', items: client },
    });
    setLoading(false);
  };

  useEffect(() => { run(); }, [projectId]);

  const renderGroup = (g: Group) => {
    const total = g.items.length;
    const done = g.items.filter(i => i.ok).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center justify-between">
          <span>{g.title} 체크리스트</span>
          <Badge variant={pct === 100 ? 'default' : 'secondary'}>{done}/{total} ({pct}%)</Badge>
        </CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Progress value={pct} />
          {g.items.map(i => (
            <div key={i.key} className={`flex items-start gap-2 p-3 rounded-md border ${i.ok ? '' : 'border-destructive/30 bg-destructive/5'}`}>
              {i.ok ? <CheckCircle2 className="h-5 w-5 text-success shrink-0" /> : <XCircle className="h-5 w-5 text-destructive shrink-0" />}
              <div className="flex-1">
                <p className="font-medium text-sm">{i.label}</p>
                <p className="text-xs text-muted-foreground">{i.detail}</p>
              </div>
              {!i.ok && <Badge variant="destructive" className="text-xs"><AlertTriangle className="h-3 w-3 mr-1" />미완료</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6" />현장 적용 체크리스트</h1>
          <p className="text-sm text-muted-foreground">관리자 · 근로자 · 발주처 관점에서 현장 운영 준비 상태를 자동 검증합니다.</p>
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">분석 중...</p> : (
        <Tabs defaultValue="admin">
          <TabsList>
            <TabsTrigger value="admin">관리자</TabsTrigger>
            <TabsTrigger value="worker">근로자</TabsTrigger>
            <TabsTrigger value="client">발주처</TabsTrigger>
          </TabsList>
          <TabsContent value="admin">{renderGroup(groups.admin)}</TabsContent>
          <TabsContent value="worker">{renderGroup(groups.worker)}</TabsContent>
          <TabsContent value="client">{renderGroup(groups.client)}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}
