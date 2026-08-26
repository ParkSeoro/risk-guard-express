/**
 * Module-level risk auto-gen job — survives dialog close / SPA remount in the same tab.
 *
 * Simple two-phase UX:
 *  A) scope_draft — 공종·세부작업·위험요인만 삽입 → awaiting_review
 *  B) 나머지 채우기 — 상신 빈칸 완결. PPE·법적근거는 법령/기준으로 먼저,
 *     상황·대책 문장이 비어 있을 때만 LLM.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  AI_SCOPE_DRAFT_NOTE,
  AI_ROW_FAILED_HAZARD,
  AI_ROW_FAILED_NOTE_PREFIX,
  fetchScopeDraft,
  fetchRiskFillTwoStage,
  fetchRiskRowDetailWithRetry,
  isFillableRiskItem,
  isAiScopeDraftItem,
  isAiFailedRiskItem,
  shouldReplaceRiskField,
  resolveBatchEdgeCallBudget,
  riskFillWorkKey,
  toRiskFillDraft,
  isNonRetryableFillError,
  isBlankRiskList,
  pickLibraryFillMatch,
  RISK_FILL_CHUNK,
  type AIGenerateOptions,
  type DetailLevel,
  type LlmCallBudget,
} from '@/lib/riskAutoGenAI';
import { generateRiskItems, type GeneratedRiskItem } from '@/lib/riskAutoGen';
import {
  fetchGlobalRiskLibraryItems,
  inferHazardType,
  inferWorkPhase,
} from '@/lib/globalRiskLibrary';
import { fetchPastApprovedRiskItems, filterDraftGaps } from '@/lib/riskReuseFromPast';
import { enrichLegalBasis } from '@/lib/enrichLegalBasis';
import { calculateRiskGrade, deriveResidualGrades, isFlattenedResidualPlaceholder } from '@/lib/riskGrade';
import { canWriteRiskItems, riskItemsWriteDeniedMessage } from '@/lib/riskWriteAccess';
import { formatAutoGenError } from '@/lib/staleChunkError';
import { defaultPpeForHazard, needsLlmNarrativeFill, seedFillDetailFromRow } from '@/lib/riskFillComplete';

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
  /** Company scope for past-assessment reuse (null = all) */
  accessibleCompanyIds?: string[] | null;
  preferCompanyIds?: string[] | null;
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

/** Approved / discarded runs must not resurrect the draft-review CTA. */
export function isLockedAssessmentRunStatus(status?: string | null): boolean {
  const s = String(status || '').trim();
  return s === '승인완료' || s === '폐기';
}

/** Drop leftover awaiting_review for this run when it is locked. */
export function clearAutoGenReviewForLockedRun(runId: string, runStatus?: string | null): boolean {
  if (!runId || !isLockedAssessmentRunStatus(runStatus)) return false;
  if (state.runId !== runId) return false;
  if (state.status === 'running') return false;
  stopElapsedClock();
  state = { ...IDLE };
  if (lastJobInput?.runId === runId) lastJobInput = null;
  emit();
  return true;
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
 * Locked (승인완료/폐기) runs never recover — leftover session jobs are cleared.
 */
export async function recoverRiskAutoGenReview(runId: string, projectId?: string): Promise<boolean> {
  if (!runId) return false;
  if (state.status === 'running') return false;

  const { data: runRow } = await supabase
    .from('assessment_runs')
    .select('status')
    .eq('id', runId)
    .maybeSingle();
  const runStatus = (runRow as { status?: string } | null)?.status;
  if (isLockedAssessmentRunStatus(runStatus)) {
    clearAutoGenReviewForLockedRun(runId, runStatus);
    return false;
  }

  if (state.status === 'awaiting_review' && state.runId === runId) return true;

  const { data, error } = await supabase
    .from('risk_items')
    .select('id, process, note, source_type, hazard_situation, existing_measure, improvement_measure, hazard, ppe, legal_basis')
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
  // Must stay aligned with risk_items RLS + src/lib/riskWriteAccess SSOT.
  // Excel upload does NOT call this — it hits RLS only. Keep allowlist = RLS roles.
  const { data: rows, error } = await supabase
    .from('project_members')
    .select('role_new')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .limit(5);

  if (error) {
    console.warn('[AutoGenJob] role precheck failed:', error.message);
    return; // don't block on precheck failure — RLS is source of truth
  }

  const roles = ((rows as { role_new?: string }[]) || [])
    .map((r) => String(r.role_new || ''))
    .filter(Boolean);

  // masters / missing membership — let insert RLS decide
  if (roles.length === 0) return;

  if (!roles.some((r) => canWriteRiskItems(r))) {
    throw new Error(riskItemsWriteDeniedMessage(roles.join(',')));
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
  current?: {
    note?: string | null;
    hazard_situation?: string | null;
    existing_measure?: string | null;
    improvement_measure?: string | null;
    ppe?: string[] | null;
    legal_basis?: string[] | null;
    likelihood_grade?: string | null;
    severity_grade?: string | null;
    risk_grade?: string | null;
    frequency?: number | null;
    severity?: number | null;
    improved_likelihood_grade?: string | null;
    improved_severity_grade?: string | null;
    improved_risk_grade?: string | null;
    improved_frequency?: number | null;
    improved_severity?: number | null;
  },
): Promise<boolean> {
  const forceAll = isAiScopeDraftItem(current || {}) || isAiFailedRiskItem(current || {});
  const narrativeOnly = (detail as { fill_stage?: string }).fill_stage === 'narrative';
  const lg = detail.likelihood_grade || '중';
  const sg = detail.severity_grade || '중';
  const nextSituation = shouldReplaceRiskField(current?.hazard_situation, forceAll)
    ? (detail.hazard_situation || '')
    : (current?.hazard_situation || '');
  const nextExisting = shouldReplaceRiskField(current?.existing_measure, forceAll)
    ? (detail.existing_measure || '')
    : (current?.existing_measure || '');
  const nextImprove = shouldReplaceRiskField(current?.improvement_measure, forceAll)
    ? (detail.improvement_measure || '')
    : (current?.improvement_measure || '');
  let nextPpe = shouldReplaceRiskField(current?.ppe, forceAll) ? (detail.ppe || []) : (current?.ppe || []);
  if (isBlankRiskList(nextPpe)) {
    nextPpe = defaultPpeForHazard(detail.hazard || rowHazard, nextSituation);
  }
  const existingLegal = shouldReplaceRiskField(current?.legal_basis, forceAll)
    ? (detail.legal_basis || [])
    : (current?.legal_basis || []);
  const legal = await enrichLegalBasis({
    processName: proc,
    hazard: detail.hazard || rowHazard || '',
    hazardSituation: nextSituation,
    existingMeasure: nextExisting,
    improvementMeasure: nextImprove,
    existing: existingLegal,
  });
  // Narrative soft-fill must not clobber grades. Insert-default 하/하/하 is a
  // placeholder, not a judged residual — derive (가능성 1단계↓, 중대성 유지).
  const keepInitialGrades =
    narrativeOnly || (!forceAll && !shouldReplaceRiskField(current?.likelihood_grade, false));
  const persistLg = keepInitialGrades ? (current?.likelihood_grade || lg) : lg;
  const persistSg = keepInitialGrades ? (current?.severity_grade || sg) : sg;
  const derivedResidual = deriveResidualGrades(persistLg, persistSg);
  const residualPlaceholder = isFlattenedResidualPlaceholder(current || {});
  const keepImprovedGrades =
    !residualPlaceholder &&
    (narrativeOnly ||
      (!forceAll && !shouldReplaceRiskField(current?.improved_likelihood_grade, false)));
  const ilg = keepImprovedGrades
    ? (current?.improved_likelihood_grade || derivedResidual.likelihood)
    : derivedResidual.likelihood;
  const isg = keepImprovedGrades
    ? (current?.improved_severity_grade || derivedResidual.severity)
    : derivedResidual.severity;
  const irg = keepImprovedGrades
    ? (current?.improved_risk_grade || derivedResidual.risk)
    : derivedResidual.risk;
  const { error: updErr } = await supabase
    .from('risk_items')
    .update({
      process: detail.process || proc,
      sub_task: detail.sub_task || subTask,
      hazard: detail.hazard || rowHazard || '',
      hazard_situation: nextSituation,
      existing_measure: nextExisting,
      improvement_measure: nextImprove,
      frequency: keepInitialGrades ? (current?.frequency ?? detail.frequency) : detail.frequency,
      severity: keepInitialGrades ? (current?.severity ?? detail.severity) : detail.severity,
      improved_frequency: keepImprovedGrades
        ? (current?.improved_frequency ?? detail.improved_frequency)
        : detail.improved_frequency,
      improved_severity: keepImprovedGrades
        ? (current?.improved_severity ?? detail.improved_severity)
        : detail.improved_severity,
      likelihood_grade: keepInitialGrades ? (current?.likelihood_grade || lg) : lg,
      severity_grade: keepInitialGrades ? (current?.severity_grade || sg) : sg,
      risk_grade: keepInitialGrades
        ? (current?.risk_grade || detail.risk_grade || calculateRiskGrade(lg as any, sg as any))
        : (detail.risk_grade || calculateRiskGrade(lg as any, sg as any)),
      improved_likelihood_grade: keepImprovedGrades
        ? (current?.improved_likelihood_grade || ilg)
        : ilg,
      improved_severity_grade: keepImprovedGrades
        ? (current?.improved_severity_grade || isg)
        : isg,
      improved_risk_grade: irg,
      ppe: nextPpe,
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
  row: {
    id: string;
    sub_task: string | null;
    process: string | null;
    hazard?: string | null;
    hazard_situation?: string | null;
    existing_measure?: string | null;
    improvement_measure?: string | null;
    note?: string | null;
    ppe?: string[] | null;
    legal_basis?: string[] | null;
    likelihood_grade?: string | null;
    severity_grade?: string | null;
    risk_grade?: string | null;
    frequency?: number | null;
    severity?: number | null;
    improved_likelihood_grade?: string | null;
    improved_severity_grade?: string | null;
    improved_risk_grade?: string | null;
    improved_frequency?: number | null;
    improved_severity?: number | null;
  },
  opts: AIGenerateOptions,
  budget?: LlmCallBudget,
): Promise<boolean> {
  const subTask = riskFillWorkKey(row);
  const proc = row.process || opts.processName;
  if (!subTask) {
    await markRowFailed(row, new Error('세부작업 또는 위험요인이 비어 있습니다.'));
    return false;
  }
  try {
    const detail = await fetchRiskRowDetailWithRetry(
      { ...opts, processName: proc, subTask },
      undefined,
      budget,
    );
    return await applyFilledDetail(row.id, proc, row.sub_task || subTask, row.hazard, detail, row);
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
    const workKey = riskFillWorkKey(row);
    let idx = filled.findIndex(
      (f, i) => !used.has(i) && (f.sub_task || '').trim() === st && (!hz || (f.hazard || '').trim() === hz),
    );
    if (idx < 0 && st) {
      idx = filled.findIndex((f, i) => !used.has(i) && (f.sub_task || '').trim() === st);
    }
    // Synthesized sub_task (hazard/process) from blank 세부작업 rows
    if (idx < 0 && workKey) {
      idx = filled.findIndex((f, i) => !used.has(i) && (f.sub_task || '').trim() === workKey);
    }
    if (idx < 0 && hz) {
      idx = filled.findIndex((f, i) => !used.has(i) && (f.hazard || '').trim() === hz);
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
      const libraryItems = await generateRiskItems({
        processName: proc,
        tags: input.conditionTags,
        targetCount: input.detailLevel === 'core' ? 16 : 24,
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

    // 1) System-wide global library (fast indexed process_key) — preferred for cost/latency
    let reusedCount = 0;
    const seenKeys = new Set<string>();
    try {
      const globalItems = await fetchGlobalRiskLibraryItems({
        processName: proc,
        equipmentTags: input.equipmentTags,
        conditionTags: input.conditionTags,
        limit: input.detailLevel === 'comprehensive' ? 48 : 32,
      });
      if (globalItems.length) {
        const rows = globalItems.map((g) => {
          const key = `${(g.sub_task || '').trim()}||${(g.hazard || '').trim()}`.toLowerCase();
          seenKeys.add(key);
          return {
            project_id: input.projectId,
            run_id: input.runId,
            process: g.process || proc,
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
            department: '',
            assignee: '',
            created_by: input.userId,
            sort_order: sortCursor++,
            source_type: 'library',
            note: '[GLOBAL_LIB] 시스템 라이브러리',
            hazard_type: (g as any).hazard_type || inferHazardType(g.hazard),
            work_phase: (g as any).work_phase || inferWorkPhase(g.sub_task),
          };
        });
        const { data, error } = await supabase.from('risk_items').insert(rows as any).select('id');
        if (error) console.warn('[AutoGenJob] global library insert failed:', error.message);
        else {
          reusedCount += data?.length || 0;
          insertedTotal += data?.length || 0;
          filledTotal += data?.length || 0;
        }
      }
    } catch (e: any) {
      console.warn('[AutoGenJob] global library skipped:', e?.message || e);
    }

    // 2) Past approved reuse (same project) — fill gaps only
    try {
      const past = await fetchPastApprovedRiskItems({
        projectId: input.projectId,
        processName: proc,
        accessibleCompanyIds: input.accessibleCompanyIds ?? null,
        userId: input.userId,
        preferCompanyIds: input.preferCompanyIds ?? null,
        excludeRunId: input.runId,
        limit: input.detailLevel === 'comprehensive' ? 40 : 28,
      });
      const pastGap = past.filter((g) => {
        const key = `${(g.sub_task || '').trim()}||${(g.hazard || '').trim()}`.toLowerCase();
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });
      if (pastGap.length) {
        const rows = pastGap.map((g) => ({
          project_id: input.projectId,
          run_id: input.runId,
          process: g.process || proc,
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
          source_type: 'reuse',
          hazard_type: inferHazardType(g.hazard),
          work_phase: inferWorkPhase(g.sub_task),
          note: '[REUSE] 이전 승인 평가에서 가져옴',
        }));
        const { data, error } = await supabase.from('risk_items').insert(rows as any).select('id');
        if (error) console.warn('[AutoGenJob] reuse insert failed:', error.message);
        else {
          const n = data?.length || 0;
          reusedCount += n;
          insertedTotal += n;
          filledTotal += n;
          patch({
            insertedTotal,
            filledTotal,
            receivedTotal: filledTotal,
            message: `「${proc}」 라이브러리·재사용 ${reusedCount}건 반영`,
          });
        }
      }
    } catch (reuseErr: any) {
      console.warn('[AutoGenJob] reuse skipped:', reuseErr?.message || reuseErr);
    }

    if (reusedCount > 0) {
      patch({
        insertedTotal,
        filledTotal,
        receivedTotal: filledTotal,
        message: `「${proc}」 라이브러리·재사용 ${reusedCount}건`,
      });
    }

    // AI scope draft for gaps (when library/reuse is thin or empty)
    let draftItems: { sub_task: string; hazard: string; work_phase?: string; hazard_type?: string }[] = [];
    const wantMoreAi = reusedCount < (input.detailLevel === 'comprehensive' ? 12 : 8);
    if (wantMoreAi) {
      try {
        console.log('[AutoGenJob] fetchScopeDraft → generate-risk-ai (scope_draft)', proc);
        const draft = await fetchScopeDraft(opts);
        const { data: existing } = await supabase
          .from('risk_items')
          .select('sub_task, hazard')
          .eq('run_id', input.runId)
          .eq('process', proc)
          .eq('is_deleted', false);
        draftItems = filterDraftGaps(draft?.items || [], (existing as any[]) || []);
        console.log('[AutoGenJob] scope_draft ok', draftItems.length, '(after reuse gap filter)');
      } catch (err: any) {
        console.error('[AutoGenJob] scope_draft failed:', err?.message || err, err);
        if (reusedCount === 0) {
          interrupted = true;
          if (insertedTotal > 0) break;
          throw err;
        }
      }
    }

    if (draftItems.length === 0) {
      continue;
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
      // Keep draft scores low so legacy score-based triggers never spam.
      // Real grades/scores are filled after review / AI fill.
      frequency: 1,
      severity: 1,
      improved_frequency: 1,
      improved_severity: 1,
      likelihood_grade: '하',
      severity_grade: '하',
      risk_grade: '하',
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
      hazard_type: it.hazard_type || inferHazardType(it.hazard),
      work_phase: it.work_phase || inferWorkPhase(it.sub_task),
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('risk_items')
      .insert(placeholders as any)
      .select('id, sub_task, sort_order');

    if (insertErr || !inserted?.length) {
      console.warn('[AutoGenJob] draft insert failed:', insertErr?.message);
      interrupted = true;
      if (insertedTotal === 0) {
        const raw = insertErr?.message || '초안 행 저장에 실패했습니다.';
        if (/42501|row-level security|RLS/i.test(raw)) {
          throw new Error(riskItemsWriteDeniedMessage());
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

  // Reuse-only: no AI draft rows left to fill
  if (allPending.length === 0) {
    patch({
      status: 'done',
      phase: 'idle',
      message: `${insertedTotal}건 등록 완료 (이전 평가 재사용)`,
      insertedTotal,
      filledTotal: insertedTotal,
      receivedTotal: insertedTotal,
      pendingIds: [],
    });
    return;
  }

  // Pause for user review — Phase B via continueRiskAutoGenFill
  patch({
    status: 'awaiting_review',
    phase: 'review',
    message:
      filledTotal > 0
        ? `재사용 ${filledTotal}건 + AI초안 ${allPending.length}행 · 검수 후 [나머지 채우기]`
        : `초안 ${insertedTotal}행 준비됨 · 공종·세부작업·위험요인 검수 후 [나머지 채우기]`,
    insertedTotal,
    filledTotal,
    receivedTotal: filledTotal,
    pendingIds: [...allPending],
  });
  if (interrupted) {
    console.warn('[AutoGenJob] Phase A partial — still awaiting review');
  }
}

/**
 * Phase B — complete submit gaps on fillable rows.
 * Local first (PPE defaults + legal_references + library overlay), then LLM
 * only for rows whose 발생상황·대책 are still empty. GPU 503 must not block
 * 보호구·법적근거 — those are reference data, not generated prose.
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
    message: '보호구·법적근거부터 채우는 중…',
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
        'id, process, sub_task, hazard, hazard_situation, existing_measure, improvement_measure, note, source_type, sort_order, project_id, ppe, legal_basis, likelihood_grade, severity_grade, risk_grade, frequency, severity, improved_likelihood_grade, improved_severity_grade, improved_risk_grade, improved_frequency, improved_severity',
      )
      .eq('run_id', targetRunId)
      .eq('is_deleted', false)
      .order('sort_order', { ascending: true });

    if (error) throw new Error(error.message);

    const allFillable = ((drafts as any[]) || []).filter((r) => isFillableRiskItem(r));
    if (allFillable.length === 0) {
      patch({
        status: 'error',
        error:
          '채울 빈칸이 없습니다. 개선대책·보호구·법적근거가 이미 있는 행은 대상이 아닙니다. 비어 있으면 [나머지 채우기]가 다시 나타납니다.',
        message: '채울 초안 없음',
        phase: 'idle',
        pendingIds: [],
      });
      return;
    }

    const skippedNoKey = allFillable.filter((r) => !riskFillWorkKey(r)).length;
    const rows = allFillable.filter((r) => riskFillWorkKey(r));
    if (rows.length === 0) {
      patch({
        status: 'error',
        error:
          '세부작업 또는 위험요인이 비어 있어 채울 수 없습니다. 행에 세부작업·위험요인을 입력하거나 [초안 생성]으로 행을 만든 뒤 다시 [나머지 채우기]를 눌러주세요.',
        message: '채울 대상 없음',
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
    let lastError = '';
    // Per-row Edge fallback budget for this fill batch (chunk path is separate)
    const rowFallbackBudget = resolveBatchEdgeCallBudget(rows.length);
    const libraryByProcess = new Map<string, GeneratedRiskItem[]>();

    const libraryPoolFor = async (procName: string): Promise<GeneratedRiskItem[]> => {
      const cached = libraryByProcess.get(procName);
      if (cached) return cached;
      const [globalItems, localItems] = await Promise.all([
        fetchGlobalRiskLibraryItems({ processName: procName, limit: 32 }).catch(() => []),
        generateRiskItems({ processName: procName, targetCount: 24, deduplicate: true }).catch(() => []),
      ]);
      const pool = [...globalItems, ...localItems];
      libraryByProcess.set(procName, pool);
      return pool;
    };

    const completeLocal = async (row: (typeof rows)[number], procName: string): Promise<boolean> => {
      const pool = await libraryPoolFor(procName);
      const lib = pickLibraryFillMatch(pool, row);
      const seeded = seedFillDetailFromRow(row, lib);
      const ok = await applyFilledDetail(
        row.id,
        procName,
        row.sub_task || riskFillWorkKey(row),
        row.hazard,
        seeded,
        row,
      );
      if (!ok) return false;
      // applyFilledDetail clears [AI_SCOPE_DRAFT] / failed notes. Mirror that here so
      // needsLlmNarrativeFill looks at remaining blank 상황·대책, not the old tag.
      row.note = null;
      row.hazard_situation = seeded.hazard_situation;
      row.existing_measure = seeded.existing_measure;
      row.improvement_measure = seeded.improvement_measure;
      row.ppe = seeded.ppe;
      row.legal_basis = seeded.legal_basis;
      row.improved_likelihood_grade = seeded.improved_likelihood_grade;
      row.improved_severity_grade = seeded.improved_severity_grade;
      row.improved_risk_grade = seeded.improved_risk_grade;
      return true;
    };

    /** LLM for empty 상황·대책 only. Never markRowFailed — local PPE/legal must survive 503. */
    const fillNarrative = async (
      row: (typeof rows)[number],
      opts: AIGenerateOptions,
    ): Promise<boolean> => {
      const subTask = riskFillWorkKey(row);
      const procName = row.process || opts.processName;
      if (!subTask) return false;
      try {
        const detail = await fetchRiskRowDetailWithRetry(
          { ...opts, processName: procName, subTask },
          undefined,
          rowFallbackBudget,
        );
        return await applyFilledDetail(row.id, procName, row.sub_task || subTask, row.hazard, detail, row);
      } catch (err: any) {
        lastError = String(err?.message || err || '');
        console.warn('[AutoGenJob] narrative fill skipped (local PPE/legal kept):', lastError);
        return false;
      }
    };

    let narrativeFailed = 0;

    for (const [proc, procRows] of byProcess) {
      if (state.status !== 'running') return;
      const opts = buildOpts(input, proc);
      const needAi: typeof procRows = [];

      for (const row of procRows) {
        if (cancelRequested || state.status !== 'running') return;
        patch({
          currentProcess: proc,
          message: `「${proc}」 ${filledTotal + failed}/${rows.length} · 보호구·법적근거 채움…`,
        });
        const ok = await completeLocal(row, proc);
        if (ok) {
          filledTotal += 1;
          if (needsLlmNarrativeFill(row)) needAi.push(row);
        } else {
          failed += 1;
        }
        const idx = pending.indexOf(row.id);
        if (idx >= 0) pending.splice(idx, 1);
      }

      patch({
        filledTotal,
        receivedTotal: filledTotal,
        pendingIds: [...pending],
        message:
          needAi.length > 0
            ? `「${proc}」 보호구·법규 반영 · 빈 대책 ${needAi.length}행 AI…`
            : `${filledTotal}/${rows.length}행 채움${failed ? ` · 실패 ${failed}` : ''}`,
      });

      if (needAi.length === 0) continue;

      for (let offset = 0; offset < needAi.length; offset += RISK_FILL_CHUNK) {
        if (cancelRequested || state.status !== 'running') return;
        const chunk = needAi.slice(offset, offset + RISK_FILL_CHUNK);
        patch({
          currentProcess: proc,
          message: `「${proc}」 빈 대책 ${offset + 1}–${Math.min(offset + chunk.length, needAi.length)}/${needAi.length}행 AI…`,
        });
        try {
          const filled = await fetchRiskFillTwoStage({
            ...opts,
            draftItems: chunk.map((r) => toRiskFillDraft(r)),
          });
          const matched = matchFilledToDraft(filled, chunk);
          for (const row of chunk) {
            const detail = matched.get(row.id);
            let ok = false;
            if (detail) {
              ok = await applyFilledDetail(
                row.id,
                proc,
                row.sub_task || riskFillWorkKey(row),
                row.hazard,
                detail,
                row,
              );
            }
            if (!ok) ok = await fillNarrative(row, opts);
            if (!ok) narrativeFailed += 1;
          }
        } catch (err: any) {
          lastError = String(err?.message || err || '');
          console.warn('[AutoGenJob] risk_fill two-stage failed after local complete:', lastError);
          const allowPerRowAi = !isNonRetryableFillError(err);
          for (const row of chunk) {
            if (state.status !== 'running') return;
            const ok = allowPerRowAi ? await fillNarrative(row, opts) : false;
            if (!ok) narrativeFailed += 1;
          }
        }
      }
    }

    if (failed > 0 && filledTotal === 0) {
      patch({
        status: 'error',
        error: lastError
          ? `행 채움에 실패했습니다. ${lastError}`
          : '행 채움에 실패했습니다. 잠시 후 다시 [나머지 채우기]를 눌러주세요.',
        message: '채움 실패',
        phase: 'idle',
        pendingIds: [],
      });
      return;
    }

    const skipNote = skippedNoKey > 0 ? ` · 세부작업 없는 행 ${skippedNoKey}건 건너뜀` : '';
    if (narrativeFailed > 0) {
      patch({
        status: 'partial',
        message: `보호구·법적근거 ${filledTotal}행 반영. 대책 문장 ${narrativeFailed}행은 AI가 응답하지 않아 비었습니다.${skipNote}`,
        filledTotal,
        receivedTotal: filledTotal,
        pendingIds: [],
        phase: 'idle',
        error: lastError || undefined,
      });
      return;
    }

    patch({
      status: failed > 0 ? 'partial' : 'done',
      message:
        failed > 0
          ? `부분 완료 · ${filledTotal}/${rows.length}행 채움 (실패 행은 [재시도])${skipNote}`
          : `${filledTotal}건 채움 완료 (보호구·법적근거·대책)${skipNote}`,
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
      const autoGenError = formatAutoGenError(err);
      patch({
        status: 'error',
        error: autoGenError,
        message: autoGenError,
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
