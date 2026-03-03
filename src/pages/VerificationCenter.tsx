import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  ShieldCheck, AlertTriangle, CheckCircle2, XCircle, FileText, Upload, Search as SearchIcon, Wand2
} from 'lucide-react';
import { validateRiskItems, saveValidationResults, validateImportedItems, type ValidationReport, type ValidationIssue } from '@/lib/validationEngine';
import { exportToPDF } from '@/lib/exportUtils';
import { calculateRiskGrade } from '@/lib/riskGrade';
import * as XLSX from 'xlsx';

const VerificationCenter = () => {
  const { user, isAdmin } = useAuth();
  const { log } = useAuditLog();
  const { toast } = useToast();

  const [projects, setProjects] = useState<{ id: string; name: string; site_name: string; client: string; contractor: string; period_start: string; period_end: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [tab, setTab] = useState('coverage');

  // Coverage
  const [coverageReport, setCoverageReport] = useState<ValidationReport | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);

  // Excel upload
  const [excelData, setExcelData] = useState<Record<string, string>[]>([]);
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [excelColumnMap, setExcelColumnMap] = useState<Record<string, string>>({});
  const [excelIssues, setExcelIssues] = useState<ValidationIssue[]>([]);
  const [excelStep, setExcelStep] = useState<'upload' | 'map' | 'result'>('upload');

  useEffect(() => {
    supabase.from('projects').select('id, name, site_name, client, contractor, period_start, period_end').then(({ data }) => {
      if (data && data.length > 0) {
        setProjects(data);
        setSelectedProject(data[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    supabase.from('assessment_runs').select('*').eq('project_id', selectedProject).order('created_at', { ascending: false }).then(({ data }) => {
      setRuns(data || []);
      if (data && data.length > 0) setSelectedRun(data[0].id);
      else setSelectedRun('');
    });
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedRun) { setItems([]); return; }
    supabase.from('risk_items').select('*').eq('run_id', selectedRun).order('sort_order').then(({ data }) => {
      setItems(data || []);
    });
  }, [selectedRun]);

  const selectedRunData = runs.find(r => r.id === selectedRun);
  const projectData = projects.find(p => p.id === selectedProject);

  // Coverage verification
  const handleCoverageCheck = async () => {
    if (!selectedProject || !user || items.length === 0) {
      toast({ title: '회차를 선택하고 항목이 있어야 합니다.', variant: 'destructive' });
      return;
    }
    setCoverageLoading(true);
    try {
      // Exclude items marked as 'is_excluded' from validation check
      const activeItems = items.filter((i: any) => !i.is_excluded);
      const report = await validateRiskItems(activeItems, selectedProject);
      setCoverageReport(report);
      await saveValidationResults(report, selectedProject, user.id, selectedRun);
      log('누락검증', 'assessment_run', selectedRun, selectedProject, { score: report.score, gaps: report.coverageGaps.length });
      toast({ title: `검증 완료: ${report.verdict} (${report.score}점) · 누락 ${report.coverageGaps.length}건` });
    } catch {
      toast({ title: '검증 실패', variant: 'destructive' });
    }
    setCoverageLoading(false);
  };

  const handleCoveragePDF = () => {
    if (!coverageReport || !projectData || !selectedRunData) return;
    try {
      const activeItems = items.filter((i: any) => !i.is_excluded);
      const rows = activeItems.map(i => ({
        ...i, sub_task: i.sub_task || '', hazard: i.hazard || '', hazard_situation: i.hazard_situation || '',
        existing_measure: i.existing_measure || '', improvement_measure: i.improvement_measure || '',
        likelihood_grade: i.likelihood_grade || '중', severity_grade: i.severity_grade || '중', risk_grade: i.risk_grade || '중',
        improved_likelihood_grade: i.improved_likelihood_grade || '하', improved_severity_grade: i.improved_severity_grade || '하', improved_risk_grade: i.improved_risk_grade || '하',
        ppe: i.ppe || [], legal_basis: i.legal_basis || [], department: i.department || '', assignee: i.assignee || '', note: i.note || '',
      }));
      exportToPDF(rows, projectData as any, null, [], { type: selectedRunData.type, period_label: selectedRunData.period_label }, coverageReport);
      log('누락검증PDF', 'assessment_run', selectedRun, selectedProject);
    } catch (err) {
      toast({ title: 'PDF 다운로드 실패', description: String(err), variant: 'destructive' });
    }
  };

  // Excel upload
  const handleExcelFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
        if (json.length === 0) { toast({ title: '데이터가 없습니다.', variant: 'destructive' }); return; }
        setExcelHeaders(Object.keys(json[0]));
        setExcelData(json);
        const autoMap: Record<string, string> = {};
        const knownMappings: Record<string, string[]> = {
          process: ['공정', 'Process', '공종'],
          sub_task: ['세부작업', 'Sub Task'],
          hazard: ['위험요인', 'Hazard'],
          hazard_situation: ['위험발생상황', 'Hazard Situation'],
          existing_measure: ['기존대책', 'Existing Measure'],
          improvement_measure: ['개선대책', 'Improvement'],
          likelihood_grade: ['가능성', 'Likelihood', '빈도'],
          severity_grade: ['중대성', 'Severity', '강도'],
          legal_basis: ['법적근거', 'Legal'],
        };
        for (const [field, aliases] of Object.entries(knownMappings)) {
          const found = Object.keys(json[0]).find(h => aliases.some(a => h.includes(a)));
          if (found) autoMap[field] = found;
        }
        setExcelColumnMap(autoMap);
        setExcelStep('map');
      } catch {
        toast({ title: '파일 파싱 실패', variant: 'destructive' });
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleExcelValidate = () => {
    const mapped = excelData.map(row => {
      const m: Record<string, string> = {};
      for (const [field, col] of Object.entries(excelColumnMap)) {
        m[field] = row[col] || '';
      }
      return m;
    });
    const issues = validateImportedItems(mapped);
    setExcelIssues(issues);
    setExcelStep('result');
    log('엑셀검증', 'verification_center', selectedRun || '', selectedProject, { rows: excelData.length, issues: issues.length });
  };

  const handleExcelImport = async () => {
    if (!selectedRun || !user) return;
    const run = runs.find(r => r.id === selectedRun);
    if (!run) return;
    const inserts = excelData.map((row, i) => {
      const get = (field: string) => row[excelColumnMap[field] || ''] || '';
      const lg = get('likelihood_grade') || '중';
      const sg = get('severity_grade') || '중';
      return {
        project_id: run.project_id, run_id: selectedRun,
        process: get('process') || '미분류',
        sub_task: get('sub_task'), hazard: get('hazard'), hazard_situation: get('hazard_situation'),
        existing_measure: get('existing_measure'), improvement_measure: get('improvement_measure'),
        likelihood_grade: ['상', '중', '하'].includes(lg) ? lg : '중',
        severity_grade: ['상', '중', '하'].includes(sg) ? sg : '중',
        risk_grade: calculateRiskGrade((['상', '중', '하'].includes(lg) ? lg : '중') as any, (['상', '중', '하'].includes(sg) ? sg : '중') as any),
        improved_likelihood_grade: '하', improved_severity_grade: '하', improved_risk_grade: '하',
        legal_basis: get('legal_basis') ? get('legal_basis').split(',').map(s => s.trim()) : [],
        status: '초안', created_by: user.id, sort_order: items.length + i,
      };
    });
    const { data } = await supabase.from('risk_items').insert(inserts).select();
    if (data) {
      setItems(prev => [...prev, ...data]);
      toast({ title: `${data.length}건 반영 완료` });
      log('엑셀반영', 'assessment_run', selectedRun, selectedProject, { count: data.length });
    }
    setExcelStep('upload');
    setExcelData([]);
  };

  const handleExcelReportPDF = () => {
    if (!projectData || !selectedRunData) return;
    try {
      // Generate a simple validation-only PDF
      const fakeReport: ValidationReport = {
        totalItems: excelData.length, totalIssues: excelIssues.length,
        errors: excelIssues.filter(i => i.severity === 'error').length,
        warnings: excelIssues.filter(i => i.severity === 'warning').length,
        score: excelIssues.length === 0 ? 100 : Math.max(0, 100 - excelIssues.length * 5),
        verdict: excelIssues.filter(i => i.severity === 'error').length > 0 ? '부적정' : excelIssues.length > 0 ? '조건부 적정' : '적정',
        issues: excelIssues, coverageGaps: [], itemVerdicts: {},
      };
      exportToPDF([], projectData as any, null, [], { type: selectedRunData.type, period_label: `${selectedRunData.period_label} (엑셀검증)` }, fakeReport);
      log('엑셀검증PDF', 'verification_center', selectedRun, selectedProject);
    } catch (err) {
      toast({ title: 'PDF 다운로드 실패', description: String(err), variant: 'destructive' });
    }
  };

  const verdictColor = (v: string) =>
    v === '적정' ? 'bg-success/10 text-success' : v === '조건부 적정' ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive';

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="h-6 w-6" /> 검증센터</h1>
          <p className="text-sm text-muted-foreground mt-1">누락 검증(커버리지) + 무관/오분류 탐지 + 협력사 엑셀 업로드 검증</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="프로젝트" /></SelectTrigger>
            <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={selectedRun} onValueChange={setSelectedRun}>
            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="회차 선택" /></SelectTrigger>
            <SelectContent>
              {runs.map(r => (
                <SelectItem key={r.id} value={r.id}>[{r.type}] {r.period_label} ({r.status})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!selectedRun ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">프로젝트와 회차를 선택하세요.</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center gap-4 text-sm">
                <span>선택된 회차: <strong>[{selectedRunData?.type}] {selectedRunData?.period_label}</strong></span>
                <Badge variant="outline" className="text-[10px]">{selectedRunData?.status}</Badge>
                <span className="text-muted-foreground">항목 {items.length}건</span>
              </div>
            </CardContent>
          </Card>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="coverage" className="flex-1 gap-1"><SearchIcon className="h-3.5 w-3.5" /> 누락 검증</TabsTrigger>
              <TabsTrigger value="quality" className="flex-1 gap-1"><ShieldCheck className="h-3.5 w-3.5" /> 품질/무관 검증</TabsTrigger>
              <TabsTrigger value="excel" className="flex-1 gap-1"><Upload className="h-3.5 w-3.5" /> 엑셀 업로드 검증</TabsTrigger>
            </TabsList>

            {/* Coverage Tab */}
            <TabsContent value="coverage" className="space-y-4">
              <div className="flex items-center gap-2">
                <Button size="sm" className="gap-1.5" onClick={handleCoverageCheck} disabled={coverageLoading || items.length === 0}>
                  <ShieldCheck className="h-3.5 w-3.5" /> {coverageLoading ? '검증 중...' : '누락 검증 실행'}
                </Button>
                {coverageReport && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={handleCoveragePDF}>
                    <FileText className="h-3.5 w-3.5" /> 검증 리포트 PDF
                  </Button>
                )}
              </div>

              {coverageReport && (
                <>
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <Card><CardContent className="pt-4">
                      <p className="text-2xl font-bold">{coverageReport.score}</p>
                      <p className="text-xs text-muted-foreground">점수</p>
                    </CardContent></Card>
                    <Card><CardContent className={`pt-4 rounded-lg ${verdictColor(coverageReport.verdict)}`}>
                      <p className="text-lg font-bold">{coverageReport.verdict}</p>
                      <p className="text-xs">판정</p>
                    </CardContent></Card>
                    <Card><CardContent className="pt-4">
                      <p className="text-2xl font-bold text-destructive">{coverageReport.errors}</p>
                      <p className="text-xs text-muted-foreground">오류</p>
                    </CardContent></Card>
                    <Card><CardContent className="pt-4">
                      <p className="text-2xl font-bold text-warning">{coverageReport.coverageGaps.length}</p>
                      <p className="text-xs text-muted-foreground">누락 항목</p>
                    </CardContent></Card>
                  </div>

                  <Progress value={coverageReport.score} className="h-2" />

                  {/* Coverage Gaps */}
                  {coverageReport.coverageGaps.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">누락된 위험성평가</CardTitle></CardHeader>
                      <CardContent className="max-h-64 overflow-y-auto space-y-1">
                        {coverageReport.coverageGaps.map((gap, i) => (
                          <div key={i} className="text-xs p-2 rounded bg-warning/5 flex items-start gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
                            <div>
                              <div className="flex items-center gap-1">
                                <Badge variant="outline" className={`text-[9px] ${gap.severity === '상' ? 'text-destructive' : gap.severity === '중' ? 'text-warning' : 'text-muted-foreground'}`}>{gap.severity}</Badge>
                                <span className="font-medium">{gap.process} – {gap.subTask}</span>
                              </div>
                              <p className="text-muted-foreground">{gap.message}</p>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Excluded Items */}
                  {items.some((i: any) => i.is_excluded) && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">의도적 제외 항목</CardTitle></CardHeader>
                      <CardContent className="max-h-40 overflow-y-auto space-y-1">
                        {items.filter((i: any) => i.is_excluded).map((item, i) => (
                          <div key={item.id} className="text-xs p-2 rounded bg-muted/30">
                            <span className="font-medium">{item.process} - {item.sub_task || ''}</span>
                            <span className="ml-2 text-muted-foreground">사유: {item.excluded_reason}</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Item-level Issues */}
                  {coverageReport.issues.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">항목별 지적사항</CardTitle>
                          <div className="flex gap-2">
                            <Badge variant="outline" className="text-[10px] gap-1"><XCircle className="h-3 w-3 text-destructive" /> 오류 {coverageReport.errors}</Badge>
                            <Badge variant="outline" className="text-[10px] gap-1"><AlertTriangle className="h-3 w-3 text-warning" /> 경고 {coverageReport.warnings}</Badge>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="max-h-64 overflow-y-auto space-y-1">
                        {coverageReport.issues.map((issue, i) => {
                          const item = items.find(it => it.id === issue.riskItemId);
                          return (
                            <div key={i} className={`text-xs p-2 rounded flex items-start gap-2 ${issue.severity === 'error' ? 'bg-destructive/5' : 'bg-warning/5'}`}>
                              {issue.severity === 'error' ? <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />}
                              <div>
                                <span className="font-medium">{item?.process} – {item?.sub_task || ''}</span>
                                <p className="text-muted-foreground">{issue.message}</p>
                                {issue.recommendation && <p className="text-muted-foreground italic text-[10px]">→ {issue.recommendation}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="quality" className="py-4 text-center text-muted-foreground">
              <Wand2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>자동 보완 기능은 회차 상세 페이지에서 사용할 수 있습니다.</p>
            </TabsContent>

            <TabsContent value="excel" className="space-y-4">
              <div className="space-y-4 max-w-xl mx-auto border p-4 rounded-lg bg-card">
                <h3 className="font-semibold text-sm">협력사 엑셀 업로드 검증</h3>
                {excelStep === 'upload' && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">협력사가 제공한 엑셀 파일을 업로드하여 형식을 검증합니다.</p>
                    <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelFile} />
                  </div>
                )}
                {excelStep === 'map' && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">{excelData.length}행 파싱됨. 컬럼 매핑 확인 후 검증하세요.</p>
                    <Button onClick={handleExcelValidate} className="w-full">검증 실행</Button>
                  </div>
                )}
                {excelStep === 'result' && (
                  <div className="space-y-4">
                    <div className="text-center">
                      <p className={`text-lg font-bold ${excelIssues.length > 0 ? 'text-destructive' : 'text-success'}`}>
                        {excelIssues.length > 0 ? `${excelIssues.length}건의 오류 발견` : '✅ 문제 없음'}
                      </p>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {excelIssues.map((iss, i) => (
                        <div key={i} className="text-xs p-2 bg-destructive/5 text-destructive rounded">{iss.message}</div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => setExcelStep('upload')}>다시하기</Button>
                      <Button className="flex-1" onClick={handleExcelReportPDF}>리포트 출력</Button>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
};

export default VerificationCenter;
