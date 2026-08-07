import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Beaker, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { startBackgroundJob, fetchJob, fetchJobItems } from '@/lib/aiJobClient';
import { toast } from '@/hooks/use-toast';
import { AIJobProgress } from '@/components/risk-ai/AIJobProgress';

type TestType = 'generation' | 'speed' | 'quality';

interface TestRow {
  id: string;
  test_type: string;
  pass_fail: string | null;
  duration_ms: number | null;
  error_location: string | null;
  result: any;
  created_at: string;
}

const AITestEngine = () => {
  const { hasRole, user } = useAuth();
  const isMaster = hasRole('master');

  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [testType, setTestType] = useState<TestType>('generation');
  const [count, setCount] = useState<50 | 100 | 150 | 300>(50);
  const [running, setRunning] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [history, setHistory] = useState<TestRow[]>([]);

  useEffect(() => {
    if (!isMaster) return;
    supabase.from('projects').select('id, name').eq('is_deleted', false).order('name').then(({ data }) => {
      if (data) {
        setProjects(data);
        if (!projectId && data.length > 0) setProjectId(data[0].id);
      }
    });
    loadHistory();
  }, [isMaster]);

  const loadHistory = async () => {
    const { data } = await supabase
      .from('ai_test_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setHistory(data as any);
  };

  if (!isMaster) return <Navigate to="/" replace />;

  const runTest = async () => {
    if (!projectId || !user) {
      toast({ title: '프로젝트를 선택해주세요', variant: 'destructive' });
      return;
    }

    setRunning(true);
    const startTime = Date.now();
    let passFail: 'pass' | 'fail' = 'fail';
    let errorLocation: string | null = null;
    let result: any = {};

    try {
      const { jobId } = await startBackgroundJob({
        projectId,
        processName: '굴착작업 (테스트)',
        equipment: '굴착기',
        workDescription: 'AI 테스트 엔진 자동 실행',
        workLocation: '일반',
        workEnvironment: ['주간'],
        targetCount: count,
      });
      setActiveJobId(jobId);

      // poll until done (max 5 min)
      const maxWait = 5 * 60 * 1000;
      const pollStart = Date.now();
      let job: any = null;
      while (Date.now() - pollStart < maxWait) {
        await new Promise(r => setTimeout(r, 3000));
        job = await fetchJob(jobId);
        if (job && ['completed', 'partial', 'failed'].includes(job.status)) break;
      }

      const duration = Date.now() - startTime;

      if (!job) {
        errorLocation = 'orchestrator timeout';
        result = { error: '5분 내 완료되지 않음' };
      } else {
        const items = await fetchJobItems(jobId);
        result = {
          status: job.status,
          items_generated: job.items_generated,
          target: count,
          quality_score: job.quality_score,
          diversity_score: job.diversity_score,
          duplicate_rate: job.duplicate_rate,
          duration_ms: duration,
          sample: items.slice(0, 2),
        };

        if (testType === 'generation') {
          passFail = job.items_generated > 0 ? 'pass' : 'fail';
          if (passFail === 'fail') errorLocation = '생성된 항목 없음';
        } else if (testType === 'speed') {
          // 50개당 60초 이하 기준
          const expectedMax = (count / 50) * 60_000;
          passFail = duration <= expectedMax * 2 ? 'pass' : 'fail';
          if (passFail === 'fail') errorLocation = `예상 시간 초과 (${duration}ms > ${expectedMax * 2}ms)`;
        } else if (testType === 'quality') {
          passFail = (job.quality_score || 0) >= 60 ? 'pass' : 'fail';
          if (passFail === 'fail') errorLocation = `품질 점수 미달 (${job.quality_score})`;
        }
      }

      await supabase.from('ai_test_runs').insert({
        tested_by: user.id,
        test_type: testType,
        input_params: { project_id: projectId, target_count: count } as any,
        result: result as any,
        pass_fail: passFail,
        error_location: errorLocation,
        duration_ms: duration,
      });

      toast({
        title: passFail === 'pass' ? '테스트 PASS' : '테스트 FAIL',
        description: errorLocation || `${result.items_generated}개 생성 / ${duration}ms`,
        variant: passFail === 'pass' ? 'default' : 'destructive',
      });
    } catch (err: any) {
      const duration = Date.now() - startTime;
      await supabase.from('ai_test_runs').insert({
        tested_by: user.id,
        test_type: testType,
        input_params: { project_id: projectId, target_count: count } as any,
        result: { error: err?.message } as any,
        pass_fail: 'fail',
        error_location: err?.stack?.split('\n')[0] || err?.message || 'unknown',
        duration_ms: duration,
      });
      toast({ title: '테스트 실패', description: err?.message, variant: 'destructive' });
    } finally {
      setRunning(false);
      loadHistory();
    }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Beaker className="h-6 w-6" /> AI 테스트 엔진 <Badge variant="outline">마스터</Badge>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          위험성평가 AI 생성 시스템의 동작/속도/품질을 자동 검증합니다.
        </p>
      </div>

      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>프로젝트</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>테스트 유형</Label>
            <Select value={testType} onValueChange={(v) => setTestType(v as TestType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="generation">생성 테스트</SelectItem>
                <SelectItem value="speed">속도 테스트</SelectItem>
                <SelectItem value="quality">품질 테스트</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>항목 수</Label>
            <Select value={String(count)} onValueChange={(v) => setCount(Number(v) as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[50, 100, 150, 300].map(c => <SelectItem key={c} value={String(c)}>{c}개</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button onClick={runTest} disabled={running || !projectId} className="w-full">
          {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Beaker className="h-4 w-4 mr-2" />}
          {running ? '테스트 실행 중...' : '테스트 시작'}
        </Button>

        {activeJobId && running && <AIJobProgress jobId={activeJobId} />}
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">최근 테스트 기록</h2>
        <div className="space-y-2 text-sm">
          {history.length === 0 && <div className="text-muted-foreground">기록 없음</div>}
          {history.map(r => (
            <div key={r.id} className="flex items-center justify-between border-b pb-2 last:border-0">
              <div className="flex items-center gap-2">
                {r.pass_fail === 'pass'
                  ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                  : <XCircle className="h-4 w-4 text-destructive" />}
                <Badge variant={r.pass_fail === 'pass' ? 'default' : 'destructive'}>
                  {r.pass_fail?.toUpperCase()}
                </Badge>
                <span>{r.test_type}</span>
                <span className="text-muted-foreground">{r.duration_ms}ms</span>
              </div>
              <div className="text-xs text-muted-foreground truncate max-w-xs">
                {r.error_location || `${r.result?.items_generated || 0}개 / ${r.result?.quality_score || '-'}점`}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

export default AITestEngine;
