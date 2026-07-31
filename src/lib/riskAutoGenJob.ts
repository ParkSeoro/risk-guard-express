/**
 * Module-level risk auto-gen job — survives dialog close / SPA remount in the same tab.
 *
 * Simple two-phase UX (AI path):
 *  A) scope_draft — 공종·세부작업·위험요인만 삽입 → awaiting_review (user edits)
 *  B) risk_fill (batch) — 발생상황·대책·등급·PPE·법적근거 채움
 */
import { supabase } from '@/integrations/supabase/client';
import {
  AI_SCOPE_DRAFT_NOTE,
  AI_ROW_FAILED_HAZARD,
  AI_ROW_FAILED_NOTE_PREFIX,
  fetchScopeDraft,
  fetchRiskFillBatch,
  fetchRiskRowDetailWithRetry,
  isFillableRiskItem,
  RISK_FILL_CHUNK,
  type AIGenerateOptions,
  type DetailLevel,
} from '@/lib/riskAutoGenAI';
import type { GeneratedRiskItem } from '@/lib/riskAutoGen';
import { enrichLegalBasis } from '@/lib/enrichLegalBasis';
import { calculateRiskGrade } from '@/lib/riskGrade';

const JOB_STORAGE_KEY = 'safenex.riskAutoGenJob.v1';

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
/** Set when user cancels a hung job so in-flight loops exit */
let cancelRequested = false;

function persistJob() {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (state.status === 'idle') {
      sessionStorage.removeItem(JOB_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(
      JOB_STORAGE_KEY,
      JSON.stringify({
        state: { ...state, pendingIds: [...state.pendingIds] },
        input: lastJobInput,
      }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

function restoreJobFromStorage() {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(JOB_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { state?: RiskAutoGenJobState; input?: RiskAutoGenJobInput | null };
    if (!parsed?.state) return;
    // Never restore an in-flight "running" — the fetch was killed by refresh
    if (parsed.state.status === 'running') {
      if (parsed.state.insertedTotal > 0) {
        state = {
          ...parsed.state,
          status: 'awaiting_review',
          phase: 'review',
          message: `초안 ${parsed.state.insertedTotal}행 · 새로고침 후 검수 가능 · [나머지 채우기]`,
          error: undefined,
        };
      } else {
        state = {
          ...IDLE,
          status: 'error',
          runId: parsed.state.runId,
          projectId: parsed.state.projectId,
          error: '새로고침으로 생성이 중단되었습니다. [공종 자동작성]을 다시 눌러주세요.',
          message: '생성 중단',
        };
      }
    } else {
      state = { ...parsed.state, pendingIds: [...(parsed.state.pendingIds || [])] };
    }
    lastJobInput = parsed.input || null;
  } catch {
    /* ignore */
  }
}

restoreJobFromStorage();

function emit() {
  const snap = { ...state, pendingIds: [...state.pendingIds] };
  persistJob();
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

/** Force-stop a hung job so the user can retry. */
export function cancelRiskAutoGenJob(reason?: string) {
  cancelRequested = true;
  stopElapsedClock();
  runningPromise = null;
  const msg = reason || '생성을 중단했습니다. 다시 [공종 자동작성] 또는 [나머지 채우기]를 눌러주세요.';
  if (state.insertedTotal > 0) {
    patch({
      status: 'awaiting_review',
      phase: 'review',
      message: `초안 ${state.insertedTotal}행 · 중단됨 · 검수 후 [나머지 채우기]`,
      error: undefined,
    });
  } else {
    patch({
      status: 'error',
      error: msg,
      message: '생성 중단',
      phase: 'idle',
      pendingIds: [],
    });
  }
}

/**
 * If this run already has fillable draft rows in DB, show the review banner
 * even after a full page reload (session/memory lost).
 */
export async function recoverRiskAutoGenReview(runId: string, projectId?: string): Promise<boolean> {
  if (!runId) return false;
  if (state.status === 'running') return false;
  if (state.status === 'awaiting_review' && state.runId === runId) return true;

  const { data, error } = await supabase
    .from('risk_items')
    .select('id, process, note, source_type, hazard_situation, existing_measure, improvement_measure, hazard')
    .eq('run_id', runId)
    .eq('is_deleted', false);

  if (error) {
    console.warn('[AutoGenJob] recover review failed:', error.message);
    return false;
  }

  const drafts = ((data as any[]) || []).filter((r) => isFillableRiskItem(r));
  if (drafts.length === 0) return false;

  const processes = Array.from(
    new Set(drafts.map((r) => String(r.process || '').trim()).filter(Boolean)),
  );

  if (!lastJobInput || lastJobInput.runId !== runId) {
    lastJobInput = {
      runId,
      projectId: projectId || state.projectId || '',
      userId: '',
      processes: processes.length ? processes : ['공종'],
      useAI: true,
      detailLevel: 'core',
      equipmentTags: [],
      conditionTags: [],
      workLocation: '',
      conditionText: '',
      sortStart: 0,
    };
  }

  patch({
    status: 'awaiting_review',
    runId,
    projectId: projectId || state.projectId || lastJobInput.projectId,
    processes: lastJobInput.processes,
    processIndex: 0,
    processTotal: lastJobInput.processes.length,
    currentProcess: '',
    insertedTotal: drafts.length,
    filledTotal: 0,
    receivedTotal: 0,
    pendingIds: drafts.map((r) => r.id),
    phase: 'review',
    message: `초안 ${drafts.length}행 검수 대기 · [나머지 채우기]로 대책·등급을 채우세요`,
    error: undefined,
    startedAt: state.startedAt || Date.now(),
  });
  return true;
}

async function assertCanInsertRiskItems(projectId: string, userId: string): Promise<void> {
  // Lightweight probe: insert+delete a soft-marked row is heavy; use RPC/role if available.
  // Fallback: attempt a no-op update path via selecting membership.
  const { data: mem, error } = await supabase
    .from('project_members')
    .select('role_new')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[AutoGenJob] role precheck failed:', error.message);
    return; // don't block on precheck failure
  }

  const role = String((mem as any)?.role_new || '');
  const allowed = new Set(['project_admin', 'safety_manager', 'site_manager', 'supervisor']);
  // masters may not have project_members row — allow empty and let insert RLS decide
  if (mem && role && !allowed.has(role)) {
    throw new Error(
      `위험성평가 항목을 저장할 권한이 없습니다. 현재 역할: ${role || '없음'}. project_admin / safety_manager / site_manager / supervisor 계정이 필요합니다.`,
    );
  }
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

async function applyFilledDetail(
  rowId: string,
  proc: string,
  subTask: string,
  rowHazard: string | null | undefined,
  detail: GeneratedRiskItem,
): Promise<boolean> {
  const lg = detail.likelihood_grade || '중';
  const sg = detail.severity_grade || '중';
  const ilg = detail.improved_likelihood_grade || '하';
  const isg = detail.improved_severity_grade || '하';
  const legal = await enrichLegalBasis({
    processName: proc,
    hazard: detail.hazard || rowHazard || '',
    hazardSituation: detail.hazard_situation || '',
    existing: detail.legal_basis || [],
  });
  const { error: updErr } = await supabase
    .from('risk_items')
    .update({
      process: detail.process || proc,
      sub_task: detail.sub_task || subTask,
      hazard: detail.hazard || rowHazard || '',
      hazard_situation: detail.hazard_situation || '',
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
    .eq('id', rowId);

  if (updErr) {
    console.warn('[AutoGenJob] row patch failed:', updErr.message);
    return false;
  }
  return true;
}

async function markRowFailed(
  row: { id: string; hazard?: string | null; hazard_situation?: string | null },
  err: any,
): Promise<void> {
  await supabase
    .from('risk_items')
    .update({
      hazard: row.hazard || AI_ROW_FAILED_HAZARD,
      hazard_situation: row.hazard_situation || 'API 과부하 또는 일시 오류로 생성되지 않았습니다.',
      note: `${AI_ROW_FAILED_NOTE_PREFIX} ${err?.message || ''} · [재시도] 버튼을 눌러주세요`.slice(0, 240),
    })
    .eq('id', row.id);
}

async function fillOneRow(
  row: { id: string; sub_task: string | null; process: string | null; hazard?: string | null; hazard_situation?: string | null },
  opts: AIGenerateOptions,
): Promise<boolean> {
  const subTask = row.sub_task || '';
  const proc = row.process || opts.processName;
  try {
    const detail = await fetchRiskRowDetailWithRetry({ ...opts, processName: proc, subTask });
    return await applyFilledDetail(row.id, proc, subTask, row.hazard, detail);
  } catch (err: any) {
    console.warn('[AutoGenJob] risk_row failed after retries:', subTask, err?.message || err);
    await markRowFailed(row, err);
    return false;
  }
}

function matchFilledToDraft(
  filled: GeneratedRiskItem[],
  drafts: { id: string; sub_task: string | null; hazard?: string | null }[],
): Map<string, GeneratedRiskItem> {
  const map = new Map<string, GeneratedRiskItem>();
  const used = new Set<number>();
  for (const row of drafts) {
    const st = (row.sub_task || '').trim();
    const hz = (row.hazard || '').trim();
    let idx = filled.findIndex(
      (f, i) => !used.has(i) && (f.sub_task || '').trim() === st && (!hz || (f.hazard || '').trim() === hz),
    );
    if (idx < 0) {
      idx = filled.findIndex((f, i) => !used.has(i) && (f.sub_task || '').trim() === st);
    }
    if (idx < 0) continue;
    used.add(idx);
    map.set(row.id, filled[idx]);
  }
  // Positional fallback for unmatched
  let fi = 0;
  for (const row of drafts) {
    if (map.has(row.id)) continue;
    while (fi < filled.length && used.has(fi)) fi += 1;
    if (fi >= filled.length) break;
    used.add(fi);
    map.set(row.id, filled[fi]);
    fi += 1;
  }
  return map;
}

async function runJob(input: RiskAutoGenJobInput): Promise<void> {
  console.log('[AutoGenJob] runJob start (Phase A draft)', {
    runId: input.runId,
    processes: input.processes,
    useAI: input.useAI,
  });
  lastJobInput = input;
  cancelRequested = false;
  let sortCursor = input.sortStart;
  let insertedTotal = 0;
  let filledTotal = 0;
  let interrupted = false;
  const allPending: string[] = [];

  if (input.useAI && input.userId && input.projectId) {
    await assertCanInsertRiskItems(input.projectId, input.userId);
  }

  for (let i = 0; i < input.processes.length; i++) {
    if (cancelRequested || state.status !== 'running') {
      console.warn('[AutoGenJob] aborted mid-loop, status=', state.status, 'cancel=', cancelRequested);
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
    let draftItems: { sub_task: string; hazard: string }[] = [];
    try {
      console.log('[AutoGenJob] fetchScopeDraft → generate-risk-ai (scope_draft)', proc);
      const draft = await fetchScopeDraft(opts);
      draftItems = draft?.items || [];
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
      hazard_situation: '',
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
        const raw = insertErr?.message || '초안 행 저장에 실패했습니다.';
        if (/42501|row-level security|RLS/i.test(raw)) {
          throw new Error(
            '위험성평가 항목을 저장할 권한이 없습니다. project_admin / safety_manager / site_manager / supervisor 계정으로 다시 시도하세요.',
          );
        }
        throw new Error(raw);
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
    message: `초안 ${insertedTotal}행 준비됨 · 공종·세부작업·위험요인 검수 후 [나머지 채우기]`,
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
 * Phase B — batch-fill scope-draft rows (situation, measures, grades, PPE, legal).
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
    cancelRequested = false;
    const { data: drafts, error } = await supabase
      .from('risk_items')
      .select(
        'id, process, sub_task, hazard, hazard_situation, existing_measure, improvement_measure, note, source_type, sort_order, project_id',
      )
      .eq('run_id', targetRunId)
      .eq('is_deleted', false)
      .order('sort_order', { ascending: true });

    if (error) throw new Error(error.message);

    const rows = ((drafts as any[]) || []).filter((r) => isFillableRiskItem(r));
    if (rows.length === 0) {
      patch({
        status: 'error',
        error:
          '채울 초안이 없습니다. 먼저 [공종 자동작성]으로 세부작업·위험요인 초안을 만든 뒤 다시 시도하세요. (이미 대책까지 채워진 행은 대상이 아닙니다)',
        message: '채울 초안 없음',
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

    // Group by process → chunk → one Edge call per chunk (much fewer calls than per-row)
    const byProcess = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = (row.process || input.processes[0] || '공종').trim() || '공종';
      if (!byProcess.has(key)) byProcess.set(key, []);
      byProcess.get(key)!.push(row);
    }

    let filledTotal = 0;
    let failed = 0;

    for (const [proc, procRows] of byProcess) {
      if (state.status !== 'running') return;
      const opts = buildOpts(input, proc);

      for (let offset = 0; offset < procRows.length; offset += RISK_FILL_CHUNK) {
        if (cancelRequested || state.status !== 'running') return;
        const chunk = procRows.slice(offset, offset + RISK_FILL_CHUNK);
        patch({
          currentProcess: proc,
          message: `「${proc}」 ${filledTotal + failed}/${rows.length} · 배치 채움…`,
        });

        try {
          const filled = await fetchRiskFillBatch({
            ...opts,
            draftItems: chunk.map((r) => ({
              sub_task: r.sub_task || '',
              hazard: r.hazard || '',
            })),
          });
          const matched = matchFilledToDraft(filled, chunk);

          for (const row of chunk) {
            const detail = matched.get(row.id);
            if (!detail) {
              // Fallback single-row for unmatched
              const ok = await fillOneRow(row, opts);
              if (ok) filledTotal += 1;
              else failed += 1;
            } else {
              const ok = await applyFilledDetail(
                row.id,
                proc,
                row.sub_task || '',
                row.hazard,
                detail,
              );
              if (ok) filledTotal += 1;
              else failed += 1;
            }
            const idx = pending.indexOf(row.id);
            if (idx >= 0) pending.splice(idx, 1);
          }
        } catch (err: any) {
          console.warn('[AutoGenJob] risk_fill batch failed, falling back per-row:', err?.message || err);
          for (const row of chunk) {
            if (state.status !== 'running') return;
            const ok = await fillOneRow(row, opts);
            if (ok) filledTotal += 1;
            else failed += 1;
            const idx = pending.indexOf(row.id);
            if (idx >= 0) pending.splice(idx, 1);
          }
        }

        patch({
          filledTotal,
          receivedTotal: filledTotal,
          pendingIds: [...pending],
          message: `${filledTotal}/${rows.length}행 채움${failed ? ` · 실패 ${failed}` : ''}`,
        });
      }
    }

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

  // Stale running (>90s) — allow restart so a hung tab doesn't lock AI forever
  if (state.status === 'running' && state.startedAt && Date.now() - state.startedAt > 90_000) {
    console.warn('[AutoGenJob] stale running (>90s) — force reset');
    stopElapsedClock();
    runningPromise = null;
    cancelRequested = true;
    state = { ...IDLE };
  }

  if (state.status === 'running') {
    console.warn('[AutoGenJob] reject: already running');
    return false;
  }

  cancelRequested = false;

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
  lastJobInput = null;
  emit();
}

/** Dismiss review banner without filling (user finished editing manually). */
export function dismissRiskAutoGenReview() {
  if (state.status !== 'awaiting_review') return;
  stopElapsedClock();
  state = { ...IDLE };
  emit();
}
