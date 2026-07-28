import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle, FileText } from 'lucide-react';
import { validateRiskItems, saveValidationResults, type ValidationReport } from '@/lib/validationEngine';
import { getGradeClassName } from '@/lib/riskGrade';
import { exportToPDF } from '@/lib/exportUtils';

const Verification = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState<{ id: string; name: string; site_name: string; client: string; contractor: string; period_start: string; period_end: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [pastResults, setPastResults] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('projects').select('id, name, site_name, client, contractor, period_start, period_end').eq('is_deleted', false).then(({ data }) => {
      if (data && data.length > 0) {
        setProjects(data);
        setSelectedProject(data[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    Promise.all([
      supabase.from('risk_items').select('*').eq('project_id', selectedProject),
      supabase.from('validation_results').select('*').eq('project_id', selectedProject).order('created_at', { ascending: false }).limit(50),
    ]).then(([r, v]) => {
      setItems(r.data || []);
      setPastResults(v.data || []);
    });
  }, [selectedProject]);

  const handleValidate = async () => {
    if (!selectedProject || !user) return;
    setLoading(true);
    try {
      const result = await validateRiskItems(items, selectedProject);
      setReport(result);
      await saveValidationResults(result, selectedProject, user.id);
      toast({ title: `검증 완료: ${result.verdict} (${result.score}점)` });
    } catch {
      toast({ title: '검증 실패', variant: 'destructive' });
    }
    setLoading(false);
  };

  const verdictColor = (v: string) => {
    if (v === '적정') return 'bg-success/10 text-success border-success/30';
    if (v === '조건부 적정') return 'bg-warning/10 text-warning border-warning/30';
    return 'bg-destructive/10 text-destructive border-destructive/30';
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="h-6 w-6" /> 적정성 검증</h1>
          <p className="text-sm text-muted-foreground mt-1">협력사 제출 위험성평가의 자동 검증 및 판정</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-60 text-xs"><SelectValue placeholder="프로젝트" /></SelectTrigger>
            <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" className="gap-1.5" onClick={handleValidate} disabled={loading || items.length === 0}>
            <ShieldCheck className="h-3.5 w-3.5" /> {loading ? '검증 중...' : '검증 실행'}
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-5 text-center">
          <p className="text-3xl font-bold">{items.length}</p>
          <p className="text-xs text-muted-foreground">총 평가항목</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5 text-center">
          <p className="text-3xl font-bold text-destructive">{items.filter(i => i.status === '제출' || i.status === '검토대기').length}</p>
          <p className="text-xs text-muted-foreground">검증 대상</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5 text-center">
          <p className="text-3xl font-bold">{report?.score ?? '—'}</p>
          <p className="text-xs text-muted-foreground">적정성 점수</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5 text-center">
          {report ? (
            <Badge className={`text-sm px-3 py-1 ${verdictColor(report.verdict)}`}>{report.verdict}</Badge>
          ) : (
            <p className="text-lg font-bold text-muted-foreground">—</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">종합 판정</p>
        </CardContent></Card>
      </div>

      {/* Report detail */}
      {report && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">검증 결과</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] gap-1"><XCircle className="h-3 w-3 text-destructive" /> 오류 {report.errors}건</Badge>
                <Badge variant="outline" className="text-[10px] gap-1"><AlertTriangle className="h-3 w-3 text-warning" /> 경고 {report.warnings}건</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Progress value={report.score} className="h-2 mb-4" />
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {report.issues.map((issue, i) => {
                const item = items.find(it => it.id === issue.riskItemId);
                return (
                  <div key={i} className={`flex items-start gap-2 p-2 rounded-md text-xs ${issue.severity === 'error' ? 'bg-destructive/5' : 'bg-warning/5'}`}>
                    {issue.severity === 'error' ? <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />}
                    <div>
                      <span className="font-medium">{item?.process} – {item?.sub_task || item?.hazard || ''}</span>
                      <p className="text-muted-foreground">{issue.message}</p>
                    </div>
                  </div>
                );
              })}
              {report.issues.length === 0 && (
                <div className="flex items-center gap-2 p-4 text-success">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">검출된 문제가 없습니다.</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Past results */}
      {pastResults.length > 0 && !report && (
        <Card>
          <CardHeader><CardTitle className="text-base">이전 검증 결과</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1">
              {pastResults.slice(0, 10).map(r => (
                <div key={r.id} className={`flex items-center justify-between p-2 rounded text-xs ${r.status === 'fail' ? 'bg-destructive/5' : 'bg-warning/5'}`}>
                  <span>{r.message}</span>
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Verification;
