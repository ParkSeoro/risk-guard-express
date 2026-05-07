// AI 대량 생성 백그라운드 작업 클라이언트
import { supabase } from '@/integrations/supabase/client';

export interface StartJobOpts {
  projectId: string;
  runId?: string;
  processName: string;
  equipment?: string;
  workDescription?: string;
  workLocation?: string;
  workEnvironment?: string[];
  targetCount: 50 | 100 | 150 | 300;
}

export async function startBackgroundJob(opts: StartJobOpts): Promise<{ jobId: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  const { data, error } = await supabase.functions.invoke('risk-job-orchestrator', {
    body: {
      action: 'start',
      project_id: opts.projectId,
      run_id: opts.runId || null,
      created_by: user.id,
      process_name: opts.processName,
      equipment: opts.equipment || '',
      work_description: opts.workDescription || '',
      work_location: opts.workLocation || '일반',
      work_environment: opts.workEnvironment || [],
      target_count: opts.targetCount,
    },
  });

  if (error) throw new Error(error.message || '작업 시작 실패');
  if ((data as any)?.error) throw new Error((data as any).error);

  return { jobId: (data as any).job_id };
}

export interface JobProgress {
  id: string;
  status: string;
  total_batches: number;
  completed_batches: number;
  items_generated: number;
  target_count: number;
  quality_score: number | null;
  diversity_score: number | null;
  duplicate_rate: number | null;
  error_message: string | null;
}

/**
 * Subscribe to realtime updates for a job. Returns unsubscribe function.
 */
export function subscribeToJob(jobId: string, onUpdate: (job: JobProgress) => void) {
  const channel = supabase
    .channel(`ai-job-${jobId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'ai_generation_jobs', filter: `id=eq.${jobId}` },
      (payload) => onUpdate(payload.new as JobProgress),
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

export async function fetchJob(jobId: string): Promise<JobProgress | null> {
  const { data } = await supabase.from('ai_generation_jobs').select('*').eq('id', jobId).maybeSingle();
  return data as JobProgress | null;
}

export async function fetchJobItems(jobId: string): Promise<any[]> {
  const { data } = await supabase
    .from('ai_generated_items_buffer')
    .select('items, batch_index')
    .eq('job_id', jobId)
    .order('batch_index', { ascending: true });
  if (!data) return [];
  return data.flatMap((row: any) => Array.isArray(row.items) ? row.items : []);
}
