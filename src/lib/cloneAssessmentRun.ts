import { supabase } from '@/integrations/supabase/client';

export type CloneAssessmentRunSource = {
  id: string;
  project_id: string;
  type?: string | null;
  period_label?: string | null;
  target_processes?: string[] | null;
  target_contractors?: string[] | null;
  target_company_ids?: string[] | null;
  notes?: string | null;
  opinion_required?: boolean | null;
  health_required?: boolean | null;
  author_user_id?: string | null;
};

export type CloneAssessmentRunResult =
  | { ok: true; id: string; itemCount: number; participantCount: number }
  | { ok: false; error: string };

/** Live risk_items columns to carry into a revision (no legacy/lock fields). */
const RISK_ITEM_COPY_KEYS = [
  'project_id',
  'process',
  'sub_task',
  'hazard',
  'hazard_situation',
  'existing_measure',
  'improvement_measure',
  'frequency',
  'severity',
  'improved_frequency',
  'improved_severity',
  'ppe',
  'legal_basis',
  'department',
  'assignee',
  'note',
  'sort_order',
  'likelihood_grade',
  'severity_grade',
  'risk_grade',
  'improved_likelihood_grade',
  'improved_severity_grade',
  'improved_risk_grade',
  'responsible_department_id',
  'assignee_user_id',
  'item_category',
  'source_type',
  'source_opinion_id',
  'is_user_reviewed',
  'linked_chemical_ids',
  'linked_env_factor_ids',
  'env_exceedance_source',
  'auto_adjust_reason',
  'hazard_type',
  'work_phase',
] as const;

/**
 * Stored generated columns: risk = frequency * severity,
 * improved_risk = improved_frequency * improved_severity.
 * Sending either value makes Postgres reject the insert.
 */
export const RISK_ITEM_GENERATED_KEYS = ['risk', 'improved_risk'] as const;

/**
 * Clone rules (개정 회차):
 * - Risk content copied; status → 미착수; soft-deleted & excluded items skipped
 * - Participants (name/role/company) copied; signed_at cleared
 * - previous_run_id → source run; start/end dates empty; author_user_id kept
 */
export function copyRiskItemsForClone(
  items: Record<string, unknown>[],
  newRunId: string,
  userId: string,
) {
  return items
    .filter((item) => item.is_deleted !== true && item.is_excluded !== true)
    .map((item) => {
      const row: Record<string, unknown> = {
        run_id: newRunId,
        status: '미착수',
        created_by: userId,
        is_deleted: false,
        is_excluded: false,
        excluded_reason: '',
        excluded_at: null,
        excluded_by: null,
        deleted_at: null,
        deleted_by: null,
        deleted_reason: null,
      };
      for (const key of RISK_ITEM_COPY_KEYS) {
        if (key in item) row[key] = item[key];
      }
      for (const key of RISK_ITEM_GENERATED_KEYS) delete row[key];
      return row;
    });
}

export function copyParticipantsForClone(
  participants: Record<string, unknown>[],
  newRunId: string,
) {
  return participants.map((p) => ({
    run_id: newRunId,
    role: p.role ?? '참여자',
    user_name: p.user_name ?? null,
    company: p.company ?? null,
    signed_at: null,
  }));
}

async function rollbackClonedRun(runId: string, userId: string): Promise<void> {
  const removedAt = new Date().toISOString();
  try {
    await supabase.from('assessment_run_participants').delete().eq('run_id', runId);
    await supabase
      .from('risk_items')
      .update({
        is_deleted: true,
        deleted_at: removedAt,
        deleted_by: userId,
        deleted_reason: '개정 회차 복제 실패',
      })
      .eq('run_id', runId);
    // Hide the shell. Hard delete is admin-only and would detach risk_items
    // (ON DELETE SET NULL) when the writer cannot delete those rows.
    const { data, error } = await supabase
      .from('assessment_runs')
      .update({
        is_deleted: true,
        deleted_at: removedAt,
        deleted_by: userId,
        deleted_reason: '개정 회차 복제 실패',
      })
      .eq('id', runId)
      .select('id');
    if (error || !data?.length) {
      console.warn('[cloneAssessmentRun] rollback failed', runId, error);
    }
  } catch (e) {
    console.warn('[cloneAssessmentRun] rollback failed', runId, e);
  }
}

/**
 * Clone an assessment run into a new 작성중 revision.
 */
export async function cloneAssessmentRun(opts: {
  source: CloneAssessmentRunSource;
  userId: string;
  periodLabel?: string;
}): Promise<CloneAssessmentRunResult> {
  const { source, userId } = opts;
  const period_label =
    (opts.periodLabel || '').trim() || `${source.period_label || ''} (개정)`;
  const notesBase = source.notes ? `${source.notes}\n\n` : '';

  const { data: newRun, error } = await supabase
    .from('assessment_runs')
    .insert([
      {
        project_id: source.project_id,
        type: source.type || '정기',
        period_label,
        target_processes: source.target_processes || [],
        target_contractors: source.target_contractors || [],
        target_company_ids: source.target_company_ids || [],
        start_date: null,
        end_date: null,
        notes: `${notesBase}[원본 회차: ${source.period_label || ''}]`,
        opinion_required: source.opinion_required ?? true,
        health_required: source.health_required ?? true,
        status: '작성중',
        created_by: userId,
        author_user_id: source.author_user_id || null,
        previous_run_id: source.id,
      },
    ])
    .select('id')
    .single();

  if (error || !newRun) {
    return { ok: false, error: error?.message || '회차 복제에 실패했습니다.' };
  }

  const { data: items, error: itemsReadErr } = await supabase
    .from('risk_items')
    .select('*')
    .eq('run_id', source.id)
    .eq('is_deleted', false)
    .eq('is_excluded', false)
    .order('sort_order');

  if (itemsReadErr) {
    await rollbackClonedRun(newRun.id, userId);
    return { ok: false, error: itemsReadErr.message };
  }

  let itemCount = 0;
  const copies = copyRiskItemsForClone(
    (items || []) as Record<string, unknown>[],
    newRun.id,
    userId,
  );
  if (copies.length > 0) {
    const { error: itemErr } = await supabase.from('risk_items').insert(copies as any);
    if (itemErr) {
      await rollbackClonedRun(newRun.id, userId);
      return { ok: false, error: itemErr.message };
    }
    itemCount = copies.length;
  }

  const { data: participants, error: partReadErr } = await supabase
    .from('assessment_run_participants')
    .select('role, user_name, company')
    .eq('run_id', source.id);

  if (partReadErr) {
    await rollbackClonedRun(newRun.id, userId);
    return { ok: false, error: partReadErr.message };
  }

  let participantCount = 0;
  if (participants && participants.length > 0) {
    const partCopies = copyParticipantsForClone(
      participants as Record<string, unknown>[],
      newRun.id,
    );
    const { error: partErr } = await supabase
      .from('assessment_run_participants')
      .insert(partCopies as any);
    if (partErr) {
      await rollbackClonedRun(newRun.id, userId);
      return { ok: false, error: partErr.message };
    }
    participantCount = partCopies.length;
  }

  return { ok: true, id: newRun.id, itemCount, participantCount };
}
