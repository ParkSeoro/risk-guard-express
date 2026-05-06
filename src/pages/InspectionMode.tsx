import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ShieldAlert, CheckCircle2, XCircle, Printer, Loader2, Eye } from 'lucide-react';

type Finding = { key: string; label: string; ok: boolean; detail: string };

export default function InspectionMode() {
  const { toast } = useToast();
  const projectId = typeof window !== 'undefined' ? localStorage.getItem('selectedProjectId') || '' : '';
  const [findings, setFindings] = useState<Finding[]>([]);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  const loadHistory = async () => {
    if (!projectId) return;
    const { data } = await supabase.from('inspection_responses' as any)
      .select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(20);
    setHistory((data as any) || []);
  };
  useEffect(() => { loadHistory(); }, [projectId]);

  const run = async () => {
    if (!projectId) return toast({ title: '프로젝트를 선택하세요.', variant: 'destructive' });
    setRunning(true);
    const f: Finding[] = [];

    const [{ data: runs }, { data: tbms }, { count: tbmParts }, { data: permits }, { data: costs }, { data: duties }] = await Promise.all([
      supabase.from('assessment_runs').select('id, status').eq('project_id', projectId).eq('is_deleted', false),
      supabase.from('tbm_sessions' as any).select('id').eq('project_id', projectId),
      supabase.from('tbm_participations' as any).select('id', { count: 'exact', head: true }),
      supabase.from('work_permits' as any).select('id, status').eq('project_id', projectId),
      supabase.from('safety_cost_items' as any).select('id', { count: 'exact', head: true }).eq('project_id', projectId).limit(1),
      supabase.from('legal_duties' as any).select('id, is_active').eq('project_id', projectId),
    ]);

    const approvedRuns = (runs || []).filter((r: any) => r.status === '승인완료').length;
    f.push({ key: 'risk_assessment', label: '위험성평가 작성/승인', ok: approvedRuns > 0, detail: `승인완료 ${approvedRuns}건 / 전체 ${(runs || []).length}건` });
    f.push({ key: 'tbm', label: 'TBM 실시', ok: (tbms || []).length > 0, detail: `TBM 세션 ${(tbms || []).length}건` });
    f.push({ key: 'worker', label: '근로자 참여 및 서명', ok: (tbmParts || 0) > 0, detail: `참여 서명 ${tbmParts || 0}건` });
    const approvedPermits = (permits || []).filter((p: any) => p.status === '승인').length;
    f.push({ key: 'permit', label: '작업허가서 승인', ok: approvedPermits > 0, detail: `승인 ${approvedPermits}건 / 전체 ${(permits || []).length}건` });
    f.push({ key: 'cost', label: '산업안전보건관리비 사용', ok: !!costs, detail: costs ? '사용 내역 등록됨' : '등록된 사용 내역 없음' });
    f.push({ key: 'duty', label: '법정 안전점검/교육', ok: (duties || []).length > 0, detail: `등록된 의무 ${(duties || []).length}건` });

    setFindings(f);
    setRunning(false);
  };

  const save = async () => {
    if (findings.length === 0) return;
    await supabase.from('inspection_responses' as any).insert({
      project_id: projectId,
      findings: findings as any,
      status: 'completed',
    });
    toast({ title: '점검 결과가 저장되었습니다.' });
    loadHistory();
  };

  const print = () => window.print();

  const okCount = findings.filter(x => x.ok).length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldAlert className="h-6 w-6" />감독 대응 모드</h1>
          <p className="text-sm text-muted-foreground">현장 상태를 자동 분석하여 감독 점검 대응 보고서를 생성합니다.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={run} disabled={running} variant="default">
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldAlert className="h-4 w-4 mr-1" />}
            점검 모드 실행
          </Button>
          {findings.length > 0 && (
            <>
              <Button onClick={save} variant="secondary"><CheckCircle2 className="h-4 w-4 mr-1" />결과 저장</Button>
              <Button onClick={print} variant="outline"><Printer className="h-4 w-4 mr-1" />보고서 인쇄</Button>
            </>
          )}
        </div>
      </div>

      {findings.length > 0 && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h2 className="text-lg font-bold">감독 점검 대응 체크리스트</h2>
              <Badge variant={okCount === findings.length ? 'default' : 'destructive'}>
                {okCount} / {findings.length} 충족
              </Badge>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="border p-2 text-left w-8">#</th>
                  <th className="border p-2 text-left">점검 항목</th>
                  <th className="border p-2 text-center w-20">상태</th>
                  <th className="border p-2 text-left">현황</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f, i) => (
                  <tr key={f.key}>
                    <td className="border p-2 text-center">{i + 1}</td>
                    <td className="border p-2 font-medium">{f.label}</td>
                    <td className="border p-2 text-center">
                      {f.ok ? <CheckCircle2 className="h-5 w-5 text-success inline" /> : <XCircle className="h-5 w-5 text-destructive inline" />}
                    </td>
                    <td className="border p-2 text-muted-foreground">{f.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {findings.some(f => !f.ok) && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
                <p className="font-semibold text-destructive">⚠ 즉시 조치 필요</p>
                <ul className="list-disc ml-5 mt-1 text-muted-foreground">
                  {findings.filter(f => !f.ok).map(f => <li key={f.key}>{f.label}: {f.detail}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="print:hidden">
        <h3 className="font-semibold mb-2">최근 점검 이력</h3>
        <div className="grid gap-2">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">기록 없음</p>
          ) : history.map((h: any) => (
            <Card key={h.id}><CardContent className="p-3 flex items-center justify-between text-sm">
              <div>{new Date(h.created_at).toLocaleString('ko-KR')}</div>
              <Badge>{(h.findings || []).filter((x: any) => x.ok).length}/{(h.findings || []).length} 충족</Badge>
            </CardContent></Card>
          ))}
        </div>
      </div>
    </div>
  );
}
