import { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { fetchJob, subscribeToJob, type JobProgress } from '@/lib/aiJobClient';

interface Props {
  jobId: string;
  onComplete?: (job: JobProgress) => void;
}

export function AIJobProgress({ jobId, onComplete }: Props) {
  const [job, setJob] = useState<JobProgress | null>(null);

  useEffect(() => {
    fetchJob(jobId).then((j) => { if (j) setJob(j); });
    const unsub = subscribeToJob(jobId, (j) => {
      setJob(j);
      if (['completed', 'partial', 'failed'].includes(j.status)) {
        onComplete?.(j);
      }
    });
    return unsub;
  }, [jobId]);

  if (!job) return <div className="text-sm text-muted-foreground">작업 정보 로딩 중...</div>;

  const pct = job.total_batches > 0
    ? Math.round((job.completed_batches / job.total_batches) * 100)
    : 0;

  const statusIcon = {
    queued: <Loader2 className="h-4 w-4 animate-spin" />,
    running: <Loader2 className="h-4 w-4 animate-spin" />,
    partial: <AlertCircle className="h-4 w-4 text-amber-500" />,
    completed: <CheckCircle2 className="h-4 w-4 text-green-600" />,
    failed: <AlertCircle className="h-4 w-4 text-destructive" />,
  }[job.status] || null;

  const statusText = {
    queued: '대기 중',
    running: '생성 중',
    partial: '부분 완료',
    completed: '완료',
    failed: '실패',
  }[job.status] || job.status;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {statusIcon}
          <span>AI 위험성평가 생성 — {statusText}</span>
        </div>
        <Badge variant="outline">{job.items_generated} / {job.target_count} 항목</Badge>
      </div>

      <Progress value={pct} />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>배치 {job.completed_batches} / {job.total_batches}</span>
        <span>{pct}%</span>
      </div>

      {(job.status === 'completed' || job.status === 'partial') && job.quality_score !== null && (
        <div className="flex gap-2 pt-2 border-t">
          <Badge variant="secondary">품질 {job.quality_score}점</Badge>
          {job.diversity_score !== null && <Badge variant="outline">다양성 {Math.round(job.diversity_score * 100)}%</Badge>}
          {job.duplicate_rate !== null && <Badge variant="outline">중복률 {Math.round(job.duplicate_rate * 100)}%</Badge>}
        </div>
      )}

      {job.error_message && (
        <div className="text-xs text-destructive">{job.error_message}</div>
      )}
    </Card>
  );
}
