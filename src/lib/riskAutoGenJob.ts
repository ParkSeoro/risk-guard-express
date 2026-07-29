/**
 * Module-level risk auto-gen job — survives dialog close / SPA remount in the same tab.
 *
 * Two-step parallel architecture (avoids Edge 150s timeout):
 *  1) Phase 1 — fetch JSA sub_task timeline (~1–3s), bulk-insert placeholder rows
 *  2) Phase 2 — fill each row via parallel risk_row calls + patch DB
 */
import { supabase } from '@/integrations/supabase/client';
import {
  AI_PENDING_HAZARD,
  fetchJsaTimeline,
  fetchRiskRowDetail,
  mapPool,
  type AIGenerateOptions,
  type DetailLevel,
} from '@/lib/riskAutoGenAI';
import { calculateRiskGrade } from '@/lib/riskGrade';

export type RiskAutoGenJobState = {
  status: 'idle' | 'running' | 'done' | 'partial' | 'error';
  runId: string | null;
  projectId: string | null;
  processes: string[];
  processIndex: number;
  processTotal: number;
  currentProcess: string;
  message: string;
  /** Placeholder rows inserted (Phase 1) */
  insertedTotal: number;
  /** Rows fully filled by Phase 2 */
  filledTotal: number;
  /** Alias for UI that still reads receivedTotal */
  receivedTotal: number;
  /** Item ids still waiting for Phase-2 fill */
  pendingIds: string[];
  phase: 'idle' | 'timeline' | 'filling';
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

async function runJob(input: RiskAutoGenJobInput): Promise<void> {
  const equipJoined = input.equipmentTags.join(', ');
  let sortCursor = input.sortStart;
  let insertedTotal = 0;
  let filledTotal = 0;
  let sourceLabel = 'ai';
  let interrupted = false;
  const allPending: string[] = [];

  for (let i = 0; i < input.processes.length; i++) {
    if (state.status !== 'running') return;
    const proc = input.processes[i].trim();
    patch({
      processIndex: i + 1,
      currentProcess: proc,
      phase: 'timeline',
      message: `공종 「${proc}」 세부작업 타임라인 도출 중…`,
    });

    if (!input.useAI) {
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
      sourceLabel = 'library';
      patch({
        insertedTotal,
        filledTotal,
        receivedTotal: filledTotal,
        message: `${filledTotal}건 라이브러리 등록`,
      });
      continue;
    }

    const opts: AIGenerateOptions = {
      processName: proc,
      equipment: equipJoined,
      workDescription: input.conditionText,
      workLocation: input.workLocation || undefined,
      workEnvironment: input.conditionTags.length > 0 ? input.conditionTags : undefined,
      tags: input.conditionTags,
      detailLevel: input.detailLevel,
      deduplicate: true,
      projectId: input.projectId,
    };

    // ── Phase 1: timeline → placeholder bulk insert ──
    let subTasks: string[] = [];
    try {
      const tl = await fetchJsaTimeline(opts);
      subTasks = tl.subTasks;
    } catch (err: any) {
      console.warn('[AutoGenJob] timeline failed:', err?.message || err);
      interrupted = true;
      if (insertedTotal > 0 || filledTotal > 0) break;
      throw err;
    }

    const placeholders = subTasks.map((st) => ({
      project_id: input.projectId,
      run_id: input.runId,
      process: proc,
      sub_task: st,
      hazard: AI_PENDING_HAZARD,
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
      note: '[AI_PENDING]',
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('risk_items')
      .insert(placeholders)
      .select('id, sub_task, sort_order');

    if (insertErr || !inserted?.length) {
      console.warn('[AutoGenJob] placeholder insert failed:', insertErr?.message);
      interrupted = true;
      if (insertedTotal === 0 && filledTotal === 0) {
        throw new Error(insertErr?.message || '세부작업 행 저장에 실패했습니다.');
      }
      break;
    }

    insertedTotal += inserted.length;
    const pendingIds = inserted.map((r) => r.id);
    allPending.push(...pendingIds);
    patch({
      phase: 'filling',
      insertedTotal,
      filledTotal,
      receivedTotal: filledTotal,
      pendingIds: [...allPending],
      message: `세부작업 ${inserted.length}행 표시 · 위험요인 병렬 생성 중…`,
    });

    // ── Phase 2: parallel per-row fill + patch ──
    await mapPool(inserted, 4, async (row) => {
      if (state.status !== 'running') {
        interrupted = true;
        return;
      }
      const subTask = row.sub_task || '';
      try {
        const detail = await fetchRiskRowDetail({ ...opts, subTask });
        const lg = detail.likelihood_grade || '중';
        const sg = detail.severity_grade || '중';
        const ilg = detail.improved_likelihood_grade || '하';
        const isg = detail.improved_severity_grade || '하';
        const { error: updErr } = await supabase
          .from('risk_items')
          .update({
            process: detail.process || proc,
            sub_task: detail.sub_task || subTask,
            hazard: detail.hazard,
            hazard_situation: detail.hazard_situation,
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
            legal_basis: detail.legal_basis || [],
            note: null,
          })
          .eq('id', row.id);

        if (updErr) {
          console.warn('[AutoGenJob] row patch failed:', updErr.message);
          interrupted = true;
          return;
        }

        filledTotal += 1;
        const stillPending = allPending.filter((id) => id !== row.id);
        // mutate shared list
        const idx = allPending.indexOf(row.id);
        if (idx >= 0) allPending.splice(idx, 1);

        patch({
          filledTotal,
          receivedTotal: filledTotal,
          pendingIds: [...allPending],
          message: `${filledTotal}/${insertedTotal}행 채움 완료 (${subTask})`,
        });
      } catch (err: any) {
        interrupted = true;
        console.warn('[AutoGenJob] risk_row failed:', subTask, err?.message || err);
        // Leave placeholder so user sees which row failed; clear pending flag later
        const idx = allPending.indexOf(row.id);
        if (idx >= 0) allPending.splice(idx, 1);
        await supabase
          .from('risk_items')
          .update({
            hazard: '생성 실패 — 수동 입력 또는 재시도',
            note: `[AI_ROW_FAILED] ${err?.message || ''}`.slice(0, 200),
          })
          .eq('id', row.id);
        patch({ pendingIds: [...allPending] });
      }
    });

    sourceLabel = 'ai';
  }

  if (insertedTotal === 0 && filledTotal === 0) {
    patch({
      status: 'error',
      error: '결과를 생성하지 못했습니다. 공종명과 장비를 확인해주세요.',
      message: '생성 실패',
      phase: 'idle',
      pendingIds: [],
    });
    return;
  }

  if (interrupted || filledTotal < insertedTotal) {
    patch({
      status: 'partial',
      message: `부분 완료 · ${filledTotal}/${insertedTotal}행 채움 (타임라인 ${insertedTotal}행은 저장됨)`,
      insertedTotal,
      filledTotal,
      receivedTotal: filledTotal,
      pendingIds: [],
      phase: 'idle',
    });
    return;
  }

  patch({
    status: 'done',
    message: `${filledTotal}건 등록 완료 (${sourceLabel})`,
    insertedTotal,
    filledTotal,
    receivedTotal: filledTotal,
    pendingIds: [],
    phase: 'idle',
  });
}

/**
 * Start auto-gen in the background (same tab). Returns false if another job is already running.
 */
export function startRiskAutoGenJob(input: RiskAutoGenJobInput): boolean {
  if (state.status === 'running') return false;

  const processes = input.processes.map((p) => p.trim()).filter(Boolean);
  if (processes.length === 0) return false;

  patch({
    status: 'running',
    runId: input.runId,
    projectId: input.projectId,
    processes,
    processIndex: 0,
    processTotal: processes.length,
    currentProcess: processes[0],
    message: '생성 준비 중…',
    insertedTotal: 0,
    filledTotal: 0,
    receivedTotal: 0,
    pendingIds: [],
    phase: 'timeline',
    elapsedSec: 0,
    error: undefined,
    startedAt: Date.now(),
  });
  startElapsedClock();

  runningPromise = runJob({ ...input, processes })
    .catch((err: any) => {
      if (state.insertedTotal > 0 || state.filledTotal > 0) {
        patch({
          status: 'partial',
          message: `부분 저장됨 · 타임라인 ${state.insertedTotal}행 / 채움 ${state.filledTotal}행`,
          error: undefined,
          pendingIds: [],
          phase: 'idle',
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
    });

  return true;
}

/** Clear terminal state so UI can hide the banner. */
export function acknowledgeRiskAutoGenJob() {
  if (state.status === 'running') return;
  stopElapsedClock();
  state = { ...IDLE };
  emit();
}
