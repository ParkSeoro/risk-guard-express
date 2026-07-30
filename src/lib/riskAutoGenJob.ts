/**
 * Module-level risk auto-gen job — survives dialog close / SPA remount in the same tab.
 *
 * Two-phase UX (AI path):
 *  A) scope_draft — 세부작업·위험요인·상황만 삽입 → awaiting_review (user edits)
 *  B) continueRiskAutoGenFill — 대책·등급·PPE·법적근거 채움 (+ library legal enrich)
 */
import { supabase } from '@/integrations/supabase/client';
import {
  AI_SCOPE_DRAFT_NOTE,
  AI_ROW_FAILED_HAZARD,
  AI_ROW_FAILED_NOTE_PREFIX,
  fetchScopeDraft,
  fetchRiskRowDetailWithRetry,
  isAiScopeDraftItem,
  mapPool,
  RISK_ROW_CONCURRENCY,
  type AIGenerateOptions,
  type DetailLevel,
} from '@/lib/riskAutoGenAI';
import { enrichLegalBasis } from '@/lib/enrichLegalBasis';
import { calculateRiskGrade } from '@/lib/riskGrade';

export type RiskAutoGenJobState = {
  status: 'idle' | 'running' | 'awaiting_review' | 'done' | 'partial' | 'error';
  runId: string | null;
  projectId: string | null;
  processes: string[];
  processIndex: number;
  processTotal: number;
  currentProcess: string;
  message: string;
  /** Draft rows inserted (Phase A) */
  insertedTotal: number;
  /** Rows fully filled by Phase B */
  filledTotal: number;
  /** Alias for UI that still reads receivedTotal */
  receivedTotal: number;
  /** Item ids waiting for Phase-B fill (scope drafts) */
  pendingIds: string[];
  phase: 'idle' | 'draft' | 'review' | 'filling';
  elapsedSec: number;
  error?: string;
  startedAt: number | null;
};

export type RiskAutoGenJobInput = {
  runId: string;
  projectId: string;
  userId: string;
  processes: string[];
  useAI: boolean;
  detailLevel: DetailLevel;
  equipmentTags: string[];
  conditionTags: string[];
  workLocation: string;
  conditionText: string;
  sortStart: number;
};

type Listener = (state: RiskAutoGenJobState) => void;

const IDLE: RiskAutoGenJobState = {
  status: 'idle',
  runId: null,
  projectId: null,
  processes: [],
  processIndex: 0,
  processTotal: 0,
  currentProcess: '',
  message: '',
  insertedTotal: 0,
  filledTotal: 0,
  receivedTotal: 0,
  pendingIds: [],
  phase: 'idle',
  elapsedSec: 0,
  startedAt: null,
};

let state: RiskAutoGenJobState = { ...IDLE };
const listeners = new Set<Listener>();
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let runningPromise: Promise<void> | null = null;
/** Kept so Phase B can reuse equipment/env after review pause */
let lastJobInput: RiskAutoGenJobInput | null = null;

function emit() {
  const snap = { ...state, pendingIds: [...state.pendingIds] };
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch (e) {
      console.warn('[AutoGenJob] listener error', e);
    }
  });
}

function patch(partial: Partial<RiskAutoGenJobState>) {
  state = {
    ...state,
    ...partial,
    pendingIds: partial.pendingIds ? [...partial.pendingIds] : state.pendingIds,
  };
  emit();
}

function startElapsedClock() {
  stopElapsedClock();
  elapsedTimer = setInterval(() => {
    if (!state.startedAt || state.status !== 'running') return;
    patch({ elapsedSec: Math.floor((Date.now() - state.startedAt) / 1000) });
  }, 1000);
}

function stopElapsedClock() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

export function getRiskAutoGenJob(): RiskAutoGenJobState {
  return { ...state, pendingIds: [...state.pendingIds] };
}

export function subscribeRiskAutoGenJob(fn: Listener): () => void {
  listeners.add(fn);
  fn(getRiskAutoGenJob());
  return () => listeners.delete(fn);
}

export function isRiskAutoGenRunning(runId?: string): boolean {
  if (state.status !== 'running') return false;
  if (runId) return state.runId === runId;
  return true;
}

function buildOpts(input: RiskAutoGenJobInput, proc: string): AIGenerateOptions {
  return {
    processName: proc,
    equipment: input.equipmentTags.join(', '),
    workDescription: input.conditionText,
    workLocation: input.workLocation || undefined,
    workEnvironment: input.conditionTags.length > 0 ? input.conditionTags : undefined,
    tags: input.conditionTags,
    detailLevel: input.detailLevel,
    deduplicate: true,
    projectId: input.projectId,
  };
}

async function fillOneRow(
  row: { id: string; sub_task: string | null; process: string | null; hazard?: string | null; hazard_situation?: string | null },
  opts: AIGenerateOptions,
): Promise<boolean> {
  const subTask = row.sub_task || '';
  const proc = row.process || opts.processName;
  try {
    const detail = await fetchRiskRowDetailWithRetry({ ...opts, processName: proc, subTask });
    const lg = detail.likelihood_grade || '중';
    const sg = detail.severity_grade || '중';
    const ilg = detail.improved_likelihood_grade || '하';
    const isg = detail.improved_severity_grade || '하';
    const legal = await enrichLegalBasis({
      processName: proc,
      hazard: detail.hazard || row.hazard || '',
      hazardSituation: detail.hazard_situation || row.hazard_situation || '',
      existing: detail.legal_basis || [],
    });
    const { error: updErr } = await supabase
      .from('risk_items')
      .update({
        process: detail.process || proc,
        sub_task: detail.sub_task || subTask,
        hazard: detail.hazard || row.hazard || '',
        hazard_situation: detail.hazard_situation || row.hazard_situation || '',
        existing_measure: detail.existing_measure,
        improvement_measure: detail.improvement_measure,
        frequency: detail.frequency,
        severity: detail.severity,
        improved_frequency: detail.improved_frequency,
        improved_severity: detail.improved_severity,
        likelihood_grade: lg,
        severity_grade: sg,
        risk_grade: detail.risk_grade || calculateRiskGrade(lg as any, sg as any),
        improved_likelihood_grade: ilg,
        improved_severity_grade: isg,
        improved_risk_grade: detail.improved_risk_grade || calculateRiskGrade(ilg as any, isg as any),
        ppe: detail.ppe || [],
        legal_basis: legal,
        note: null,
      })
      .eq('id', row.id);

    if (updErr) {
      console.warn('[AutoGenJob] row patch failed:', updErr.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[AutoGenJob] risk_row failed after retries:', subTask, err?.message || err);
    await supabase
      .from('risk_items')
      .update({
        hazard: row.hazard || AI_ROW_FAILED_HAZARD,
        hazard_situation: row.hazard_situation || 'API 과부하 또는 일시 오류로 생성되지 않았습니다.',
        note: `${AI_ROW_FAILED_NOTE_PREFIX} ${err?.message || ''} · [재시도] 버튼을 눌러주세요`.slice(0, 240),
      })
      .eq('id', row.id);
    return false;
  }
}

async function runJob(input: RiskAutoGenJobInput): Promise<void> {
  console.log('[AutoGenJob] runJob start (Phase A draft)', {
    runId: input.runId,
    processes: input.processes,
    useAI: input.useAI,
  });
  lastJobInput = input;
  let sortCursor = input.sortStart;
  let insertedTotal = 0;
  let filledTotal = 0;
  let interrupted = false;
  const allPending: string[] = [];

  for (let i = 0; i < input.processes.length; i++) {
    if (state.status !== 'running') {
      console.warn('[AutoGenJob] aborted mid-loop, status=', state.status);
      return;
    }
    const proc = input.processes[i].trim();
    patch({
      processIndex: i + 1,
      currentProcess: proc,
      phase: 'draft',
      message: `공종 「${proc}」 세부작업·위험요인 초안 생성 중…`,
    });

    if (!input.useAI) {
      console.log('[AutoGenJob] library-only path (full rows, no review pause)', proc);
      const { generateRiskItems } = await import('@/lib/riskAutoGen');
      const libraryItems = await generateRiskItems({
        processName: proc,
        tags: input.conditionTags,
        targetCount: input.detailLevel === 'core' ? 8 : 12,
        deduplicate: true,
      });
      const rows = libraryItems.map((g) => ({
        project_id: input.projectId,
        run_id: input.runId,
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
        status: '초안' as const,
        ppe: g.ppe,
        legal_basis: g.legal_basis,
        department: g.department,
        assignee: g.assignee,
        created_by: input.userId,
        sort_order: sortCursor++,
        source_type: 'library',
      }));
      if (rows.length) {
        const { data, error } = await supabase.from('risk_items').insert(rows).select('id');
        if (error) console.warn('[AutoGenJob] library insert failed:', error.message);
        else {
          insertedTotal += data?.length || 0;
          filledTotal += data?.length || 0;
        }
      }
      patch({
        insertedTotal,
        filledTotal,
        receivedTotal: filledTotal,
        message: `${filledTotal}건 라이브러리 등록`,
      });
      continue;
    }

    const opts = buildOpts(input, proc);
    let draftItems: { sub_task: string; hazard: string; hazard_situation: string }[] = [];
    try {
      console.log('[AutoGenJob] fetchScopeDraft → generate-risk-ai (scope_draft)', proc);
      const draft = await fetchScopeDraft(opts);
      draftItems = draft.items;
      console.log('[AutoGenJob] scope_draft ok', draftItems.length);
    } catch (err: any) {
      console.error('[AutoGenJob] scope_draft failed:', err?.message || err, err);
      interrupted = true;
      if (insertedTotal > 0) break;
      throw err;
    }

    const placeholders = draftItems.map((it) => ({
      project_id: input.projectId,
      run_id: input.runId,
      process: proc,
      sub_task: it.sub_task,
      hazard: it.hazard,
      hazard_situation: it.hazard_situation,
      existing_measure: '',
      improvement_measure: '',
      frequency: 3,
      severity: 3,
      improved_frequency: 1,
      improved_severity: 1,
      likelihood_grade: '중',
      severity_grade: '중',
      risk_grade: '중',
      improved_likelihood_grade: '하',
      improved_severity_grade: '하',
      improved_risk_grade: '하',
      status: '초안' as const,
      ppe: [] as string[],
      legal_basis: [] as string[],
      department: '',
      assignee: '',
      created_by: input.userId,
      sort_order: sortCursor++,
      source_type: 'ai',
      note: AI_SCOPE_DRAFT_NOTE,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('risk_items')
      .insert(placeholders)
      .select('id, sub_task, sort_order');

    if (insertErr || !inserted?.length) {
      console.warn('[AutoGenJob] draft insert failed:', insertErr?.message);
      interrupted = true;
      if (insertedTotal === 0) {
        throw new Error(insertErr?.message || '초안 행 저장에 실패했습니다.');
      }
      break;
    }

    insertedTotal += inserted.length;
    allPending.push(...inserted.map((r) => r.id));
    patch({
      insertedTotal,
      filledTotal,
      receivedTotal: filledTotal,
      pendingIds: [...allPending],
      message: `초안 ${insertedTotal}행 저장 · 검수 대기`,
    });
  }

  if (!input.useAI) {
    if (insertedTotal === 0 && filledTotal === 0) {
      patch({
        status: 'error',
        error: '결과를 생성하지 못했습니다. 공종명을 확인해주세요.',
        message: '생성 실패',
        phase: 'idle',
        pendingIds: [],
      });
      return;
    }
    patch({
      status: filledTotal > 0 ? 'done' : 'error',
      message: `${filledTotal}건 등록 완료 (library)`,
      insertedTotal,
      filledTotal,
      receivedTotal: filledTotal,
      pendingIds: [],
      phase: 'idle',
    });
    return;
  }

  if (insertedTotal === 0) {
    patch({
      status: 'error',
      error: '초안을 생성하지 못했습니다. 공종·장비·환경을 확인해주세요.',
      message: '생성 실패',
      phase: 'idle',
      pendingIds: [],
    });
    return;
  }

  // Pause for user review — Phase B via continueRiskAutoGenFill
  patch({
    status: 'awaiting_review',
    phase: 'review',
    message: `초안 ${insertedTotal}행 준비됨 · 불필요 항목 삭제 후 [나머지 채우기]`,
    insertedTotal,
    filledTotal: 0,
    receivedTotal: 0,
    pendingIds: [...allPending],
  });
  if (interrupted) {
    console.warn('[AutoGenJob] Phase A partial — still awaiting review');
  }
}

/**
 * Phase B — fill scope-draft rows with measures, grades, PPE, legal basis.
 * Uses remaining [AI_SCOPE_DRAFT] rows for the run (respects user deletes).
 */
export function continueRiskAutoGenFill(runId?: string): boolean {
  if (state.status === 'running') return false;
  const targetRunId = runId || state.runId || lastJobInput?.runId;
  if (!targetRunId) return false;

  // Recover input from last job, or minimal stub (opts built per-row from item.process)
  if (!lastJobInput || lastJobInput.runId !== targetRunId) {
    lastJobInput = {
      runId: targetRunId,
      projectId: state.projectId || '',
      userId: '',
      processes: state.processes.length ? state.processes : ['공종'],
      useAI: true,
      detailLevel: 'core',
      equipmentTags: [],
      conditionTags: [],
      workLocation: '',
      conditionText: '',
      sortStart: 0,
    };
  }

  const input = lastJobInput;
  patch({
    status: 'running',
    runId: targetRunId,
    projectId: input.projectId,
    phase: 'filling',
    message: '대책·등급·법적근거 채우는 중…',
    filledTotal: 0,
    receivedTotal: 0,
    startedAt: Date.now(),
    elapsedSec: 0,
    error: undefined,
  });
  startElapsedClock();

  runningPromise = (async () => {
    const { data: drafts, error } = await supabase
      .from('risk_items')
      .select('id, process, sub_task, hazard, hazard_situation, note, sort_order, project_id')
      .eq('run_id', targetRunId)
      .eq('is_deleted', false)
      .order('sort_order', { ascending: true });

    if (error) throw new Error(error.message);

    const rows = ((drafts as any[]) || []).filter((r) => isAiScopeDraftItem(r));
    if (rows.length === 0) {
      patch({
        status: 'done',
        message: '채울 초안이 없습니다. (이미 채웠거나 삭제됨)',
        phase: 'idle',
        pendingIds: [],
      });
      return;
    }

    if (!input.projectId && rows[0]?.project_id) {
      input.projectId = rows[0].project_id;
      patch({ projectId: rows[0].project_id });
    }

    const pending = rows.map((r) => r.id);
    patch({
      insertedTotal: Math.max(state.insertedTotal, rows.length),
      pendingIds: [...pending],
      message: `${rows.length}행 채움 시작…`,
    });

    let filledTotal = 0;
    let failed = 0;
    await mapPool(rows, RISK_ROW_CONCURRENCY, async (row) => {
      if (state.status !== 'running') return;
      const opts = buildOpts(input, row.process || input.processes[0] || '');
      const ok = await fillOneRow(row, opts);
      const idx = pending.indexOf(row.id);
      if (idx >= 0) pending.splice(idx, 1);
      if (ok) filledTotal += 1;
      else failed += 1;
      patch({
        filledTotal,
        receivedTotal: filledTotal,
        pendingIds: [...pending],
        message: `${filledTotal}/${rows.length}행 채움${failed ? ` · 실패 ${failed}` : ''}`,
      });
    });

    if (failed > 0 && filledTotal === 0) {
      patch({
        status: 'error',
        error: '행 채움에 실패했습니다. 잠시 후 다시 [나머지 채우기]를 눌러주세요.',
        message: '채움 실패',
        phase: 'idle',
        pendingIds: [],
      });
      return;
    }

    patch({
      status: failed > 0 ? 'partial' : 'done',
      message:
        failed > 0
          ? `부분 완료 · ${filledTotal}/${rows.length}행 채움 (실패 행은 [재시도])`
          : `${filledTotal}건 채움 완료 (대책·등급·법적근거)`,
      filledTotal,
      receivedTotal: filledTotal,
      pendingIds: [],
      phase: 'idle',
    });
  })()
    .catch((err: any) => {
      console.error('[AutoGenJob] continue fill catch:', err?.message || err);
      patch({
        status: state.filledTotal > 0 ? 'partial' : 'error',
        error: err?.message || '채움 실패',
        message: err?.message || '채움 실패',
        phase: 'idle',
        pendingIds: [],
      });
    })
    .finally(() => {
      stopElapsedClock();
      runningPromise = null;
      if (state.startedAt) {
        patch({ elapsedSec: Math.floor((Date.now() - state.startedAt) / 1000) });
      }
    });

  return true;
}

/**
 * Start Phase A (draft) in the background. Returns false if another job is running.
 */
export function startRiskAutoGenJob(input: RiskAutoGenJobInput): boolean {
  console.log('[AutoGenJob] startRiskAutoGenJob', {
    runId: input.runId,
    processes: input.processes,
    useAI: input.useAI,
    status: state.status,
  });

  if (state.status === 'running' && !runningPromise) {
    console.warn('[AutoGenJob] orphaned running state — resetting before start');
    stopElapsedClock();
    state = { ...IDLE };
  }

  if (state.status === 'running') {
    console.warn('[AutoGenJob] reject: already running');
    return false;
  }

  const processes = input.processes.map((p) => p.trim()).filter(Boolean);
  if (processes.length === 0) {
    console.warn('[AutoGenJob] reject: empty processes');
    return false;
  }

  lastJobInput = { ...input, processes };
  patch({
    status: 'running',
    runId: input.runId,
    projectId: input.projectId,
    processes,
    processIndex: 0,
    processTotal: processes.length,
    currentProcess: processes[0],
    message: '초안 생성 준비 중…',
    insertedTotal: 0,
    filledTotal: 0,
    receivedTotal: 0,
    pendingIds: [],
    phase: 'draft',
    elapsedSec: 0,
    error: undefined,
    startedAt: Date.now(),
  });
  startElapsedClock();

  runningPromise = runJob({ ...input, processes })
    .catch((err: any) => {
      console.error('[AutoGenJob] runJob catch:', err?.message || err, err);
      if (state.insertedTotal > 0) {
        patch({
          status: 'awaiting_review',
          phase: 'review',
          message: `초안 ${state.insertedTotal}행 저장됨 · 검수 후 [나머지 채우기]`,
          error: undefined,
        });
        return;
      }
      patch({
        status: 'error',
        error: err?.message || '자동 생성 실패',
        message: err?.message || '자동 생성 실패',
        pendingIds: [],
        phase: 'idle',
      });
    })
    .finally(() => {
      stopElapsedClock();
      runningPromise = null;
      if (state.startedAt) {
        patch({ elapsedSec: Math.floor((Date.now() - state.startedAt) / 1000) });
      }
      console.log('[AutoGenJob] Phase A finished', {
        status: state.status,
        insertedTotal: state.insertedTotal,
      });
    });

  return true;
}

/** Clear terminal state so UI can hide the banner. Does not clear awaiting_review. */
export function acknowledgeRiskAutoGenJob() {
  if (state.status === 'running' || state.status === 'awaiting_review') return;
  stopElapsedClock();
  state = { ...IDLE };
  emit();
}

/** Dismiss review banner without filling (user finished editing manually). */
export function dismissRiskAutoGenReview() {
  if (state.status !== 'awaiting_review') return;
  stopElapsedClock();
  state = { ...IDLE };
  emit();
}
