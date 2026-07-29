/**
 * Module-level risk auto-gen job — survives dialog close / SPA remount in the same tab.
 * Browser cannot continue work in a different tab's JS context; this keeps the original tab alive.
 */
import { supabase } from '@/integrations/supabase/client';
import { generateRiskItemsStreaming, type AIGenerateOptions, type DetailLevel } from '@/lib/riskAutoGenAI';

export type RiskAutoGenJobState = {
  status: 'idle' | 'running' | 'done' | 'error';
  runId: string | null;
  projectId: string | null;
  processes: string[];
  processIndex: number;
  processTotal: number;
  currentProcess: string;
  message: string;
  insertedTotal: number;
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
  elapsedSec: 0,
  startedAt: null,
};

let state: RiskAutoGenJobState = { ...IDLE };
const listeners = new Set<Listener>();
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let runningPromise: Promise<void> | null = null;

function emit() {
  const snap = { ...state };
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch (e) {
      console.warn('[AutoGenJob] listener error', e);
    }
  });
}

function patch(partial: Partial<RiskAutoGenJobState>) {
  state = { ...state, ...partial };
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
  return { ...state };
}

export function subscribeRiskAutoGenJob(fn: Listener): () => void {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

export function isRiskAutoGenRunning(runId?: string): boolean {
  if (state.status !== 'running') return false;
  if (runId) return state.runId === runId;
  return true;
}

async function runJob(input: RiskAutoGenJobInput): Promise<void> {
  const equipJoined = input.equipmentTags.join(', ');
  const insertSeen = new Set<string>();
  let sortCursor = input.sortStart;
  let insertedTotal = 0;
  let sourceLabel = 'ai';

  const toRow = (g: any) => {
    const key = `${g.sub_task}|${g.hazard}`;
    if (insertSeen.has(key)) return null;
    insertSeen.add(key);
    return {
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
    };
  };

  const bulkPersist = async (generated: any[]) => {
    const rows = generated.map(toRow).filter(Boolean) as Record<string, unknown>[];
    if (rows.length === 0) return 0;
    const { data, error } = await supabase.from('risk_items').insert(rows).select();
    if (error) throw new Error(error.message || '일괄 저장에 실패했습니다.');
    return data?.length || 0;
  };

  for (let i = 0; i < input.processes.length; i++) {
    if (state.status !== 'running') return;
    const proc = input.processes[i].trim();
    patch({
      processIndex: i + 1,
      currentProcess: proc,
      message: `공종 「${proc}」 JSA 스트리밍 생성 중…`,
    });

    if (!input.useAI) {
      const { generateRiskItems } = await import('@/lib/riskAutoGen');
      const libraryItems = await generateRiskItems({
        processName: proc,
        tags: input.conditionTags,
        targetCount: input.detailLevel === 'core' ? 12 : 20,
        deduplicate: true,
      });
      patch({ message: `공종 「${proc}」 저장 중…` });
      const n = await bulkPersist(libraryItems);
      insertedTotal += n;
      patch({ insertedTotal, message: `공종 「${proc}」 ${n}건 저장 완료` });
      sourceLabel = 'library';
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

    let received = 0;
    const result = await generateRiskItemsStreaming(opts, {
      onItem: async (_item, soFar) => {
        received = soFar.length;
        patch({
          message: `공종 「${proc}」 ${received}건 수신… (완료 후 일괄 저장)`,
        });
      },
      onProgress: (progress) => {
        const msg = progress.message
          || progress.phaseTitle
          || `공종 「${proc}」 생성 중…`;
        patch({
          message: String(msg),
        });
      },
    });

    if (result.items.length === 0) {
      throw new Error(`공종 「${proc}」 생성 결과가 비어 있습니다.`);
    }

    patch({ message: `공종 「${proc}」 ${result.items.length}건 일괄 저장 중…` });
    const n = await bulkPersist(result.items);
    insertedTotal += n;
    patch({
      insertedTotal,
      message: `공종 「${proc}」 ${n}건 저장 완료 (${result.source})`,
    });
    sourceLabel = result.source;
  }

  if (insertedTotal === 0) {
    patch({
      status: 'error',
      error: '결과를 생성하지 못했습니다. 공종명과 장비를 확인해주세요.',
      message: '생성 실패',
      insertedTotal: 0,
    });
    return;
  }

  patch({
    status: 'done',
    message: `${insertedTotal}건 등록 완료 (${sourceLabel})`,
    insertedTotal,
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
    elapsedSec: 0,
    error: undefined,
    startedAt: Date.now(),
  });
  startElapsedClock();

  runningPromise = runJob({ ...input, processes })
    .catch((err: any) => {
      patch({
        status: 'error',
        error: err?.message || '자동 생성 실패',
        message: err?.message || '자동 생성 실패',
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
