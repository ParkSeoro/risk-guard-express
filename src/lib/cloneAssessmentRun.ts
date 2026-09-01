import { supabase } from '@/integrations/supabase/client';

export type CloneAssessmentRunSource = {
  id: string;
  project_id: string;
  type?: string | null;
  period_label?: string | null;
  target_processes?: string[] | null;
  target_contractors?: string[] | null;
  target_company_ids?: string[] | null;
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
  opinion_required?: boolean | null;
  health_required?: boolean | null;
  author_user_id?: string | null;
  previous_run_id?: string | null;
};

export type CloneAssessmentRunResult =
  | { ok: true; id: string; itemCount: number; participantCount: number }
  | { ok: false; error: string };

const RISK_ITEM_DROP_KEYS = [
  'id', 'created_at', 'updated_at', 'submitted_at', 'submitted_by',
  'is_locked', 'batch_id', 'version_number',
] as const;

export function copyRiskItemsForClone(items: Record<string, unknown>[], newRunId: string, userId: string) {
  return items.map((item) => {
    const rest = { ...item };
    for (const k of RISK_ITEM_DROP_KEYS) delete rest[k];
    return {
      ...rest,
      run_id: newRunId,
      status: '미착수',
      is_locked: false,
      created_by: userId,
    };
  });
}

export function copyParticipantsForClone(participants: Record<string, unknown>[], newRunId: string) {
  return participants.map((p) => {
    const rest = { ...p };
    delete rest.id;
    delete rest.created_at;
    delete rest.signed_at;
    return { ...rest, run_id: newRunId, signed_at: null };
  });
}

/**
 * Clone an assessment run into a new 작성중 revision.
 * Copies live risk_items (not soft-deleted) and participants (unsigned).
 */
export async function cloneAssessmentRun(opts: {
  source: CloneAssessmentRunSource;
  userId: string;
  periodLabel?: string;
}): Promise<CloneAssessmentRunResult> {
  const { source, userId } = opts;
  const period_label = (opts.periodLabel || '').trim() || `${source.period_label || ''} (개정)`;
  const notesBase = source.notes ? `${source.notes}\n\n` : '';

  const { data: newRun, error } = await supabase.from('assessment_runs').insert([{
    project_id: source.project_id,
    type: source.type || '정기',
    period_label,
    target_processes: source.target_processes || [],
    target_contractors: source.target_contractors || [],
    target_company_ids: source.target_company_ids || [],
    start_date: source.start_date || null,
    end_date: source.end_date || null,
    notes: `${notesBase}[원본 회차: ${source.period_label || ''}]`,
    opinion_required: source.opinion_required ?? true,
    health_required: source.health_required ?? true,
    status: '작성중',
    created_by: userId,
    author_user_id: source.author_user_id || null,
    previous_run_id: source.previous_run_id || null,
  }]).select('id').single();

  if (error || !newRun) {
    return { ok: false, error: error?.message || '회차 복제에 실패했습니다.' };
  }

  const { data: items } = await supabase
    .from('risk_items')
    .select('*')
    .eq('run_id', source.id)
    .eq('is_deleted', false)
    .order('sort_order');

  let itemCount = 0;
  if (items && items.length > 0) {
    const copies = copyRiskItemsForClone(items as Record<string, unknown>[], newRun.id, userId);
    const { error: itemErr } = await supabase.from('risk_items').insert(copies as any);
    if (itemErr) {
      return { ok: false, error: itemErr.message };
    }
    itemCount = copies.length;
  }

  const { data: participants } = await supabase
    .from('assessment_run_participants')
    .select('*')
    .eq('run_id', source.id);

  let participantCount = 0;
  if (participants && participants.length > 0) {
    const copies = copyParticipantsForClone(participants as Record<string, unknown>[], newRun.id);
    const { error: partErr } = await supabase.from('assessment_run_participants').insert(copies as any);
    if (partErr) {
      return { ok: false, error: partErr.message };
    }
    participantCount = copies.length;
  }

  return { ok: true, id: newRun.id, itemCount, participantCount };
}
