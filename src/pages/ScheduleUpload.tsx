import { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Upload, FileSpreadsheet, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import { parseScheduleFile, extractProcesses, type ParsedRow, type ColumnMapping } from '@/lib/scheduleParser';
import { generateFromSchedule, type GeneratedRiskItem } from '@/lib/riskAutoGen';
import { getGradeClassName } from '@/lib/riskGrade';

type Step = 'upload' | 'mapping' | 'preview' | 'done';

const ScheduleUpload = () => {
  const { projectId } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ processName: '' });
  const [targetCount, setTargetCount] = useState(100);
  const [preview, setPreview] = useState<GeneratedRiskItem[]>([]);
  const [loading, setLoading] = useState(false);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setLoading(true);
    try {
      const { headers: h, rows: r } = await parseScheduleFile(f);
      setHeaders(h);
      setRows(r);
      // Auto-detect processName column
      const processCol = h.find(col => /공정|공종|작업|process/i.test(col));
      const subTaskCol = h.find(col => /세부|sub.*task|상세/i.test(col));
      setMapping({
        processName: processCol || h[0] || '',
        subTask: subTaskCol,
      });
      setStep('mapping');
    } catch {
      toast({ title: '파일 파싱 실패', variant: 'destructive' });
    }
    setLoading(false);
  }, [toast]);

  const handleGeneratePreview = async () => {
    if (!mapping.processName) return;
    setLoading(true);
    try {
      const processes = extractProcesses(rows, mapping);
      const generated = await generateFromSchedule(processes, targetCount);
      setPreview(generated);
      setStep('preview');
    } catch {
      toast({ title: '생성 미리보기 실패', variant: 'destructive' });
    }
    setLoading(false);
  };

  const handleConfirmGenerate = async () => {
    if (!projectId || !user || preview.length === 0) return;
    setLoading(true);

    // Save batch
    const { data: batch } = await supabase.from('generated_batches').insert([{
      project_id: projectId,
      source_type: 'schedule',
      created_by: user.id,
      total_items: preview.length,
      options: { targetCount, fileName: file?.name } as any,
      risk_distribution: {
        high: preview.filter(i => i.risk_grade === '상').length,
        medium: preview.filter(i => i.risk_grade === '중').length,
        low: preview.filter(i => i.risk_grade === '하').length,
      } as any,
    }]).select().single();

    const inserts = preview.map((g, i) => ({
      project_id: projectId,
      process: g.process,
      sub_task: g.sub_task,
      hazard: g.hazard,
      hazard_situation: g.hazard_situation,
      existing_measure: g.existing_measure,
      improvement_measure: g.improvement_measure,
      frequency: g.frequency,
      severity: g.severity,
      improved_frequency: g.improved_frequency,
      improved_severity: g.improved_severity,
      likelihood_grade: g.likelihood_grade,
      severity_grade: g.severity_grade,
      risk_grade: g.risk_grade,
      improved_likelihood_grade: g.improved_likelihood_grade,
      improved_severity_grade: g.improved_severity_grade,
      improved_risk_grade: g.improved_risk_grade,
      status: '초안',
      ppe: g.ppe,
      legal_basis: g.legal_basis,
      department: g.department,
      assignee: g.assignee,
      created_by: user.id,
      sort_order: i,
      batch_id: batch?.id || null,
    }));

    const { data } = await supabase.from('risk_items').insert(inserts).select();
    if (data) {
      toast({ title: `${data.length}건의 위험성평가 항목이 생성되었습니다.` });
      // Save schedule upload record
      await supabase.from('schedule_uploads').insert([{
        project_id: projectId,
        file_name: file?.name || '',
        file_path: '',
        parsed_rows: rows.slice(0, 100) as any,
        column_mapping: mapping as any,
        total_generated: data.length,
        status: 'completed',
        uploaded_by: user.id,
      }]);
    }

    setStep('done');
    setLoading(false);
  };

  const highCount = preview.filter(i => i.risk_grade === '상').length;
  const medCount = preview.filter(i => i.risk_grade === '중').length;
  const lowCount = preview.filter(i => i.risk_grade === '하').length;

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">마스터 스케줄 업로드</h1>
        <p className="text-sm text-muted-foreground mt-1">공정표 파일을 업로드하여 위험성평가 항목을 자동 생성합니다</p>
      </div>

      {/* Progress steps */}
      <div className="flex items-center gap-2">
        {(['upload', 'mapping', 'preview', 'done'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
              step === s ? 'bg-accent text-accent-foreground' :
              (['upload', 'mapping', 'preview', 'done'].indexOf(step) > i ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')
            }`}>
              {['upload', 'mapping', 'preview', 'done'].indexOf(step) > i ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
              {['파일 선택', '컬럼 매핑', '미리보기', '완료'][i]}
            </div>
            {i < 3 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {step === 'upload' && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <FileSpreadsheet className="h-16 w-16 mx-auto text-muted-foreground" />
              <div>
                <p className="text-lg font-medium">XLSX 또는 CSV 파일 업로드</p>
                <p className="text-sm text-muted-foreground mt-1">공정명, 세부작업, 기간, 협력사, 위치 컬럼을 포함하는 공정표 파일</p>
              </div>
              <label className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-md cursor-pointer hover:bg-accent/90 transition-colors">
                <Upload className="h-4 w-4" />
                파일 선택
                <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} />
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'mapping' && (
        <Card>
          <CardHeader><CardTitle className="text-base">컬럼 매핑</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">파일에서 감지된 {headers.length}개 컬럼 · {rows.length}행</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-destructive">공정명 (필수) *</Label>
                <Select value={mapping.processName} onValueChange={v => setMapping(p => ({ ...p, processName: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>세부작업 (선택)</Label>
                <Select value={mapping.subTask || '__none__'} onValueChange={v => setMapping(p => ({ ...p, subTask: v === '__none__' ? undefined : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">선택 안 함</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>협력사 (선택)</Label>
                <Select value={mapping.contractor || '__none__'} onValueChange={v => setMapping(p => ({ ...p, contractor: v === '__none__' ? undefined : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">선택 안 함</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>위치/구역 (선택)</Label>
                <Select value={mapping.location || '__none__'} onValueChange={v => setMapping(p => ({ ...p, location: v === '__none__' ? undefined : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">선택 안 함</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>생성 목표 개수</Label>
              <Select value={String(targetCount)} onValueChange={v => setTargetCount(Number(v))}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50개</SelectItem>
                  <SelectItem value="100">100개</SelectItem>
                  <SelectItem value="150">150개</SelectItem>
                  <SelectItem value="300">300개</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Preview data */}
            <div className="border rounded-md overflow-hidden">
              <div className="text-xs font-medium bg-muted px-3 py-1.5">파일 미리보기 (상위 5행)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr>{headers.map(h => <th key={h} className={`px-2 py-1.5 text-left bg-muted/50 whitespace-nowrap ${h === mapping.processName ? 'bg-accent/20 font-bold' : ''}`}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>{headers.map(h => <td key={h} className={`px-2 py-1 border-b ${h === mapping.processName ? 'bg-accent/10 font-medium' : ''}`}>{row[h]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <Button onClick={handleGeneratePreview} disabled={!mapping.processName || loading} className="w-full">
              {loading ? '분석 중...' : '자동 생성 미리보기'}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">생성 결과 미리보기</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold">{preview.length}</p>
                  <p className="text-xs text-muted-foreground">총 생성 항목</p>
                </div>
                <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'hsl(0 72% 51% / 0.1)' }}>
                  <p className="text-2xl font-bold text-destructive">{highCount}</p>
                  <p className="text-xs text-muted-foreground">위험도 상</p>
                </div>
                <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'hsl(45 93% 47% / 0.1)' }}>
                  <p className="text-2xl font-bold" style={{ color: 'hsl(45, 93%, 37%)' }}>{medCount}</p>
                  <p className="text-xs text-muted-foreground">위험도 중</p>
                </div>
                <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'hsl(145 63% 42% / 0.1)' }}>
                  <p className="text-2xl font-bold text-success">{lowCount}</p>
                  <p className="text-xs text-muted-foreground">위험도 하</p>
                </div>
              </div>

              {preview.length < targetCount && (
                <div className="flex items-center gap-2 p-3 bg-warning/10 rounded-md mb-4">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <p className="text-xs">목표 {targetCount}개 중 {preview.length}개만 생성됨. 라이브러리에 해당 공종 항목이 부족할 수 있습니다.</p>
                </div>
              )}

              <div className="overflow-x-auto max-h-80">
                <table className="w-full data-table text-xs">
                  <thead><tr><th>#</th><th>공정</th><th>세부작업</th><th>위험요인</th><th className="text-center">위험도</th><th className="text-center">개선후</th></tr></thead>
                  <tbody>
                    {preview.slice(0, 20).map((item, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{item.process}</td>
                        <td>{item.sub_task}</td>
                        <td>{item.hazard}</td>
                        <td className="text-center"><span className={`inline-flex items-center justify-center w-8 h-6 rounded text-[11px] font-bold ${getGradeClassName(item.risk_grade)}`}>{item.risk_grade}</span></td>
                        <td className="text-center"><span className={`inline-flex items-center justify-center w-8 h-6 rounded text-[11px] font-bold ${getGradeClassName(item.improved_risk_grade)}`}>{item.improved_risk_grade}</span></td>
                      </tr>
                    ))}
                    {preview.length > 20 && <tr><td colSpan={6} className="text-center text-muted-foreground">... 외 {preview.length - 20}건</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('mapping')} className="flex-1">이전으로</Button>
            <Button onClick={handleConfirmGenerate} disabled={loading} className="flex-1">
              {loading ? '생성 중...' : `${preview.length}건 확정 생성`}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <CheckCircle2 className="h-16 w-16 mx-auto text-success" />
            <p className="text-lg font-medium">위험성평가 항목이 성공적으로 생성되었습니다!</p>
            <Button onClick={() => navigate(`/risk-assessment/${projectId}`)}>위험성평가 보기</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ScheduleUpload;
