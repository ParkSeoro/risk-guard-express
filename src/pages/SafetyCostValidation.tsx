import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, CheckCircle2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface Report { id: string; title: string; report_month: string; status: string; report_total: number | null; }
interface Violation {
  id: string; report_id: string; violation_code: string; severity: string;
  detail: string | null; legal_basis: string | null; actual_amount: number | null;
  expected_amount: number | null; created_at: string; resolved_at: string | null;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-blue-100 text-blue-800',
};

export default function SafetyCostValidation() {
  const { selectedProject } = useGlobalProjectAccess();
  const { toast } = useToast();
  const [reports, setReports] = useState<Report[]>([]);
  const [violations, setViolations] = useState<Record<string, Violation[]>>({});
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState<string | null>(null);

  const load = async () => {
    if (!selectedProject) return;
    setLoading(true);
    const { data: r } = await supabase
      .from('safety_cost_monthly_reports')
      .select('id, title, report_month, status, report_total')
      .eq('project_id', selectedProject)
      .eq('is_deleted', false)
      .order('report_month', { ascending: false })
      .limit(24);
    const reps = (r as Report[]) || [];
    setReports(reps);

    if (reps.length) {
      const { data: v } = await supabase
        .from('safety_cost_violations')
        .select('*')
        .in('report_id', reps.map(x => x.id))
        .eq('is_deleted', false);
      const grouped: Record<string, Violation[]> = {};
      ((v as Violation[]) || []).forEach(x => {
        (grouped[x.report_id] = grouped[x.report_id] || []).push(x);
      });
      setViolations(grouped);
    } else { setViolations({}); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [selectedProject]);

  const handleValidate = async (reportId: string) => {
    setValidating(reportId);
    const { data, error } = await supabase.rpc('validate_safety_cost_report', { _report_id: reportId });
    setValidating(null);
    if (error) { toast({ title: '검증 실패', description: error.message, variant: 'destructive' }); return; }
    const d: any = data;
    toast({ title: `검증 완료 — 위반 ${d?.violations ?? 0}건` });
    load();
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <header>
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" /> 산업안전보건관리비 검증
        </h1>
        <p className="text-sm text-muted-foreground">월별 사용내역의 법정 비율·증빙 정합성 자동 검증</p>
      </header>

      {loading ? (
        <div className="text-center text-muted-foreground py-12">로딩 중...</div>
      ) : reports.length === 0 ? (
        <Card><CardContent className="text-center text-muted-foreground py-12">월별 보고서가 없습니다.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {reports.map((r) => {
            const vs = violations[r.id] || [];
            return (
              <Card key={r.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <CardTitle className="text-base">{r.title || format(new Date(r.report_month), 'yyyy-MM') + ' 월간 보고'}</CardTitle>
                      <p className="text-xs text-muted-foreground">{format(new Date(r.report_month), 'yyyy-MM')} · 상태 {r.status || '작성중'} · 합계 {r.report_total?.toLocaleString() ?? 0}원</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {vs.length === 0 ? (
                        <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" />위반 없음</Badge>
                      ) : (
                        <Badge variant="destructive">위반 {vs.length}건</Badge>
                      )}
                      <Button size="sm" variant="outline" onClick={() => handleValidate(r.id)} disabled={validating === r.id}>
                        {validating === r.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                        검증 실행
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {vs.length > 0 && (
                  <CardContent className="space-y-2">
                    {vs.map(v => (
                      <div key={v.id} className="border rounded-md p-2 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={SEVERITY_COLOR[v.severity] || ''}>{v.severity}</Badge>
                          <span className="font-mono text-xs text-muted-foreground">{v.violation_code}</span>
                        </div>
                        <div>{v.detail}</div>
                        {v.legal_basis && <div className="text-xs text-muted-foreground mt-1">근거: {v.legal_basis}</div>}
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
