import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Activity, ChevronRight, Download } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

interface JobRow {
  id: string;
  process_name: string;
  status: string;
  target_count: number;
  items_generated: number;
  total_batches: number;
  completed_batches: number;
  quality_score: number | null;
  created_at: string;
  error_message: string | null;
}

interface LogRow {
  id: string;
  job_id: string;
  batch_index: number;
  prompt: string | null;
  raw_response: any;
  model: string | null;
  latency_ms: number | null;
  error: string | null;
}

const AILogs = () => {
  const { hasRole } = useAuth();
  const isMaster = hasRole('master');
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [logsByJob, setLogsByJob] = useState<Record<string, LogRow[]>>({});

  useEffect(() => {
    if (!isMaster) return;
    supabase.from('ai_generation_jobs').select('*').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { if (data) setJobs(data as any); });
  }, [isMaster]);

  if (!isMaster) return <Navigate to="/" replace />;

  const loadLogs = async (jobId: string) => {
    if (logsByJob[jobId]) return;
    const { data } = await supabase
      .from('ai_generation_logs')
      .select('*')
      .eq('job_id', jobId)
      .order('batch_index');
    if (data) setLogsByJob(s => ({ ...s, [jobId]: data as any }));
  };

  const exportCsv = () => {
    const rows = [['job_id', 'process', 'status', 'target', 'generated', 'quality', 'created_at', 'error']];
    jobs.forEach(j => rows.push([
      j.id, j.process_name, j.status, String(j.target_count), String(j.items_generated),
      String(j.quality_score || ''), j.created_at, j.error_message || ''
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ai-jobs-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" /> AI 로그 <Badge variant="outline">마스터</Badge>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">AI 생성 작업/배치 입출력/오류를 추적합니다.</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
      </div>

      <Card className="p-4 space-y-2">
        {jobs.length === 0 && <div className="text-sm text-muted-foreground">로그가 없습니다.</div>}
        {jobs.map(job => (
          <Collapsible key={job.id} onOpenChange={(o) => o && loadLogs(job.id)}>
            <CollapsibleTrigger className="w-full">
              <div className="flex items-center gap-2 p-2 hover:bg-muted rounded text-sm">
                <ChevronRight className="h-4 w-4" />
                <Badge variant={job.status === 'completed' ? 'default' : job.status === 'failed' ? 'destructive' : 'outline'}>
                  {job.status}
                </Badge>
                <span className="font-medium truncate flex-1 text-left">{job.process_name}</span>
                <span className="text-muted-foreground">{job.items_generated}/{job.target_count}</span>
                <span className="text-muted-foreground">품질 {job.quality_score ?? '-'}</span>
                <span className="text-xs text-muted-foreground">{new Date(job.created_at).toLocaleString('ko-KR')}</span>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-6 space-y-1 py-2">
                {(logsByJob[job.id] || []).map(log => (
                  <div key={log.id} className="text-xs border-l-2 pl-2 py-1" style={{ borderColor: log.error ? 'hsl(var(--destructive))' : 'hsl(var(--border))' }}>
                    <div className="flex gap-2">
                      <Badge variant="outline" className="text-[10px]">batch {log.batch_index}</Badge>
                      {log.model && <span className="text-muted-foreground">{log.model}</span>}
                      {log.latency_ms !== null && <span className="text-muted-foreground">{log.latency_ms}ms</span>}
                    </div>
                    {log.prompt && <div className="text-muted-foreground mt-1 truncate">{log.prompt}</div>}
                    {log.error && <div className="text-destructive mt-1">{log.error}</div>}
                  </div>
                ))}
                {logsByJob[job.id] && logsByJob[job.id].length === 0 && (
                  <div className="text-xs text-muted-foreground">로그 없음</div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </Card>
    </div>
  );
};

export default AILogs;
