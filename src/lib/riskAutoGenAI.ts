import { supabase } from '@/integrations/supabase/client';
import { calculateRiskGrade, type RiskGrade } from './riskGrade';
import { correctTerms } from './termCorrection';
import { generateRiskItems, type GeneratedRiskItem } from './riskAutoGen';

export type DetailLevel = 'core' | 'comprehensive';

/** KOSHA-style accident case from generate-accident-ai */
export interface AIAccidentCase {
  title: string;
  cause: string;
  result: string;
  prevention?: string;
  occurrence_date?: string;
  location?: string;
  accident_summary?: string;
}

export interface AIGenerateOptions {
  processName: string;
  equipment?: string;
  workDescription?: string;
  workLocation?: string;
  workEnvironment?: string[];
  tags?: string[];
  detailLevel?: DetailLevel;
  deduplicate?: boolean;
  projectId?: string;
}

export interface AIGenerateProgress {
  phase: 'cache_check' | 'generating' | 'fallback' | 'complete' | 'phase' | 'status';
  itemsSoFar: number;
  normalizedEquipment?: string;
  phaseId?: string;
  phaseTitle?: string;
  message?: string;
  elapsedSec?: number;
}

function mapAIItemToGenerated(item: any, processName: string): GeneratedRiskItem {
  const pickGrade = (...vals: unknown[]): RiskGrade | null => {
    for (const v of vals) {
      if (typeof v === 'string' && ['상', '중', '하'].includes(v)) return v as RiskGrade;
    }
    return null;
  };

  const lg = pickGrade(item.likelihood_grade, item.initial_likelihood) ?? '중';
  const sg = pickGrade(item.severity_grade, item.initial_severity) ?? '중';
  const rg = calculateRiskGrade(lg, sg);
  const ilg = pickGrade(item.improved_likelihood_grade, item.residual_likelihood) ?? '하';
  const isg = pickGrade(item.improved_severity_grade, item.residual_severity) ?? '하';
  const irg = calculateRiskGrade(ilg, isg);

  const ppeRaw = item.ppe;
  const ppe = Array.isArray(ppeRaw)
    ? ppeRaw.map(String)
    : typeof ppeRaw === 'string'
      ? ppeRaw.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
      : [];

  return {
    process: correctTerms(item.process || processName),
    sub_task: item.sub_task || item.sub_work || '',
    hazard: item.hazard || item.hazard_factor || '',
    hazard_situation: item.hazard_situation || '',
    existing_measure: item.existing_measure || item.existing_control || '',
    improvement_measure: item.improvement_measure || item.improvement_control || '',
    likelihood_grade: lg,
    severity_grade: sg,
    risk_grade: rg,
    improved_likelihood_grade: ilg,
    improved_severity_grade: isg,
    improved_risk_grade: irg,
    frequency: lg === '상' ? 4 : lg === '중' ? 3 : 2,
    severity: sg === '상' ? 4 : sg === '중' ? 3 : 2,
    improved_frequency: ilg === '상' ? 3 : ilg === '중' ? 2 : 1,
    improved_severity: isg === '상' ? 4 : isg === '중' ? 3 : 2,
    ppe,
    legal_basis: Array.isArray(item.legal_basis) ? item.legal_basis : [],
    department: '',
    assignee: '',
    status: '초안',
    tags: [],
  };
}

function mapErrorMessage(rawMsg: string): string {
  if (/호출 상한|CALL_CAP/i.test(rawMsg)) {
    return 'AI 호출 상한에 도달했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (/크레딧|CREDITS_EXHAUSTED|credit_limit|402|QUOTA_EXHAUSTED|할당량/i.test(rawMsg)) {
    return 'AI 무료 할당량이 소진되었습니다. 관리자에게 문의하거나 잠시 후 다시 시도해주세요.';
  }
  if (/INVALID_KEY|api[_ ]?key|NVIDIA_API_KEY|DEEPSEEK_API_KEY|키가 유효하지/i.test(rawMsg)) {
    return 'AI API 키가 설정되지 않았거나 유효하지 않습니다. 마스터가 NVIDIA_API_KEY를 Supabase Edge Secrets에 등록해야 합니다. (설정 > AI 설정)';
  }
  if (/RATE_LIMIT|429|503|529|too many|너무 많|과부하/i.test(rawMsg)) {
    return 'AI 서버가 일시적으로 바쁩니다. 잠시 후 다시 시도해주세요.';
  }
  if (/TIMEOUT|중단되었|시간.?초과|WORKER_RESOURCE|compute resources|AbortError|504|Gateway Timeout|gateway/i.test(rawMsg)) {
    return 'AI 응답이 너무 오래 걸려 중단되었습니다. 공종을 하나만 넣고 다시 시도해주세요.';
  }
  if (/42501|row-level security|RLS|권한이 없습니다|Forbidden/i.test(rawMsg)) {
    return '위험성평가 항목을 저장할 권한이 없습니다. project_admin / safety_manager / site_manager / site_supervisor(관리감독자) 권한이 필요합니다.';
  }
  return rawMsg || 'AI 생성에 실패했습니다.';
}

/** @deprecated Phases removed — one-shot generation only. Kept for import compatibility. */
export function riskGenPhases(_detailLevel: DetailLevel): { id: string; title: string }[] {
  return [{ id: 'oneshot', title: 'JSA 전공정 생성' }];
}

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');
  return token;
}

/** Placeholder hazard while Phase-2 row fill is in flight */
export const AI_PENDING_HAZARD = '…생성중';

/** Rows from Phase A (세부작업+위험요인) awaiting user review before fill */
export const AI_SCOPE_DRAFT_NOTE = '[AI_SCOPE_DRAFT]';

export function isAiPendingRiskItem(item: { hazard?: string | null; note?: string | null }): boolean {
  return item.hazard === AI_PENDING_HAZARD || (item.note || '').includes('[AI_PENDING]');
}

export function isAiScopeDraftItem(item: { note?: string | null }): boolean {
  return (item.note || '').includes(AI_SCOPE_DRAFT_NOTE);
}

/**
 * Rows that [나머지 채우기] should process:
 * - Phase A drafts tagged [AI_SCOPE_DRAFT]
 * - Incomplete AI rows (empty situation/measures) from older flows
 */
export function isFillableRiskItem(item: {
  note?: string | null;
  source_type?: string | null;
  hazard_situation?: string | null;
  existing_measure?: string | null;
  improvement_measure?: string | null;
  hazard?: string | null;
}): boolean {
  if (isAiScopeDraftItem(item)) return true;
  if (isAiPendingRiskItem(item)) return false;
  if ((item.note || '').includes('[AI_ROW_FAILED]')) return true;
  const src = (item.source_type || '').toLowerCase();
  if (src !== 'ai' && src !== 'ai_opinion') return false;
  const situation = (item.hazard_situation || '').trim();
  const existing = (item.existing_measure || '').trim();
  const improve = (item.improvement_measure || '').trim();
  return !situation || !existing || !improve;
}

async function invokeRiskJson<T = any>(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const token = await getAccessToken();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const url = `${baseUrl}/functions/v1/generate-risk-ai`;
  console.log('[AI Engine] fetch generate-risk-ai', { mode: body.mode, process_name: body.process_name, url });

  // Prefer publishable key (same as supabase-js client). Fallback to invoke if raw fetch fails hard.
  const doFetch = async (apikey: string) => {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey,
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    let payload: any = null;
    const contentType = resp.headers.get('content-type') || '';
    let text = '';
    try {
      text = await resp.text();
      if (text?.trim()) payload = JSON.parse(text);
    } catch (e) {
      console.error('[AI Engine] response JSON parse failed', resp.status, contentType, e);
      payload = null;
    }
    return { resp, payload, contentType, text };
  };

  let { resp, payload, contentType, text } = await doFetch(publishableKey);

  // Rare gateway mismatch: retry once via supabase.functions.invoke
  if (!resp.ok && (resp.status === 401 || resp.status === 403)) {
    console.warn('[AI Engine] raw fetch auth failed, retrying via functions.invoke', resp.status);
    const { data, error } = await supabase.functions.invoke('generate-risk-ai', { body });
    if (error) {
      throw new Error(mapErrorMessage(error.message || `AI 서버 오류 (${resp.status})`));
    }
    payload = data;
    if (payload?.error && !payload.items && !payload.item && !payload.sub_tasks) {
      throw new Error(mapErrorMessage(String(payload.error)));
    }
    console.log('[AI Engine] generate-risk-ai ok (invoke fallback)', { mode: body.mode });
    return payload as T;
  }

  if (!resp.ok) {
    console.error('[AI Engine] generate-risk-ai error', resp.status, payload);
    throw new Error(mapErrorMessage(payload?.error || `AI 서버 오류 (${resp.status})`));
  }
  if (payload == null || typeof payload !== 'object') {
    console.error('[AI Engine] generate-risk-ai empty/non-JSON body', resp.status, contentType, text.slice(0, 120));
    if (/event-stream/i.test(contentType) || text.startsWith('data:') || text.startsWith(': ')) {
      throw new Error(
        'AI 서버가 구버전입니다(SSE). generate-risk-ai Edge Function을 최신으로 재배포해주세요.',
      );
    }
    throw new Error('AI 서버 응답이 비어 있습니다. Edge Function(generate-risk-ai) 배포·API 키를 확인해주세요.');
  }
  if (payload.error && !payload.items && !payload.item && !payload.sub_tasks) {
    throw new Error(mapErrorMessage(String(payload.error)));
  }
  console.log('[AI Engine] generate-risk-ai ok', { mode: body.mode, keys: Object.keys(payload) });
  return payload as T;
}

/** Phase 1 — fast JSA sub_task timeline (JSON). */
export async function fetchJsaTimeline(
  opts: AIGenerateOptions,
  signal?: AbortSignal,
): Promise<{ subTasks: string[]; normalizedEquipment?: string }> {
  const detailLevel: DetailLevel = opts.detailLevel || 'core';
  const data = await invokeRiskJson<{
    sub_tasks?: string[];
    normalized_equipment?: string;
    error?: string;
  }>(
    {
      mode: 'jsa_timeline',
      process_name: opts.processName,
      equipment: opts.equipment || '',
      work_description: opts.workDescription || '',
      work_location: opts.workLocation || '일반',
      work_environment: opts.workEnvironment || [],
      detail_level: detailLevel,
      project_id: opts.projectId || '',
    },
    signal,
  );
  const subTasks = (data?.sub_tasks || [])
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  if (subTasks.length === 0) {
    throw new Error(mapErrorMessage(data?.error || '세부작업 목록이 비어 있습니다.'));
  }
  return { subTasks, normalizedEquipment: data?.normalized_equipment };
}

export type ScopeDraftItem = {
  sub_task: string;
  hazard: string;
  work_phase?: string;
  hazard_type?: string;
};

/** Phase A — 공종(입력) + 세부작업 + 위험요인만 (대책·법적근거 없음). */
export async function fetchScopeDraft(
  opts: AIGenerateOptions,
  signal?: AbortSignal,
): Promise<{ items: ScopeDraftItem[]; normalizedEquipment?: string }> {
  const detailLevel: DetailLevel = opts.detailLevel || 'core';
  const data = await invokeRiskJson<{
    items?: any[];
    normalized_equipment?: string;
    error?: string;
  }>(
    {
      mode: 'scope_draft',
      process_name: opts.processName,
      equipment: opts.equipment || '',
      work_description: opts.workDescription || '',
      work_location: opts.workLocation || '일반',
      work_environment: opts.workEnvironment || [],
      detail_level: detailLevel,
      project_id: opts.projectId || '',
    },
    signal,
  );
  const items: ScopeDraftItem[] = (data?.items || [])
    .map((it) => ({
      sub_task: String(it?.sub_task || '').trim(),
      hazard: String(it?.hazard || '').trim(),
      work_phase: String(it?.work_phase || '').trim() || undefined,
      hazard_type: String(it?.hazard_type || '').trim() || undefined,
    }))
    .filter((it) => it.sub_task);
  if (items.length === 0) {
    throw new Error(mapErrorMessage(data?.error || '세부작업·위험요인 초안이 비어 있습니다.'));
  }
  return { items, normalizedEquipment: data?.normalized_equipment };
}

/** Phase B batch size — keep small so Edge/gateway doesn't 504 (6 rows often timed out). */
export const RISK_FILL_CHUNK = 3;

export type RiskFillStage = 'narrative' | 'meta' | 'all';

export type ScopeDraftItemRich = ScopeDraftItem & {
  hazard_situation?: string;
  existing_measure?: string;
  improvement_measure?: string;
};

/** One fill stage — narrative (상황·대책) or meta (등급·PPE·법규). */
export async function fetchRiskFillBatch(
  opts: AIGenerateOptions & {
    draftItems: ScopeDraftItemRich[];
    fillStage?: RiskFillStage;
  },
  signal?: AbortSignal,
): Promise<GeneratedRiskItem[]> {
  const detailLevel: DetailLevel = opts.detailLevel || 'core';
  const fillStage: RiskFillStage = opts.fillStage || 'all';
  const draft_items = (opts.draftItems || [])
    .map((it) => ({
      sub_task: String(it.sub_task || '').trim(),
      hazard: String(it.hazard || '').trim(),
      hazard_situation: String(it.hazard_situation || '').trim(),
      existing_measure: String(it.existing_measure || '').trim(),
      improvement_measure: String(it.improvement_measure || '').trim(),
    }))
    .filter((it) => it.sub_task)
    .slice(0, RISK_FILL_CHUNK);

  if (draft_items.length === 0) return [];

  const data = await invokeRiskJson<{ items?: any[]; error?: string }>(
    {
      mode: 'risk_fill',
      fill_stage: fillStage,
      process_name: opts.processName,
      draft_items,
      equipment: opts.equipment || '',
      work_description: opts.workDescription || '',
      work_location: opts.workLocation || '일반',
      work_environment: opts.workEnvironment || [],
      detail_level: detailLevel,
      project_id: opts.projectId || '',
    },
    signal,
  );

  const items = (data?.items || [])
    .map((it) => mapAIItemToGenerated(it, opts.processName))
    .filter((it) => it.sub_task);

  if (items.length === 0) {
    throw new Error(mapErrorMessage(data?.error || '채움 결과가 비어 있습니다.'));
  }
  return items;
}

/**
 * Fill one chunk in a single Edge call (fill_stage=all).
 * Previously narrative→meta (2 sequential calls) which doubled wait even when the model was fine.
 * Name kept for callers; falls back to two-stage only if the one-shot returns empty.
 */
export async function fetchRiskFillTwoStage(
  opts: AIGenerateOptions & { draftItems: ScopeDraftItem[] },
  signal?: AbortSignal,
): Promise<GeneratedRiskItem[]> {
  try {
    const oneshot = await fetchRiskFillBatch(
      { ...opts, draftItems: opts.draftItems, fillStage: 'all' },
      signal,
    );
    if (oneshot.length > 0) return oneshot;
  } catch (err) {
    console.warn('[AI Engine] risk_fill all-stage failed, trying narrative→meta:', (err as any)?.message || err);
  }

  const narratives = await fetchRiskFillBatch(
    { ...opts, draftItems: opts.draftItems, fillStage: 'narrative' },
    signal,
  );
  const forMeta: ScopeDraftItemRich[] = opts.draftItems.map((d, i) => {
    const n =
      narratives.find((x) => (x.sub_task || '').trim() === (d.sub_task || '').trim()) ||
      narratives[i];
    return {
      sub_task: d.sub_task,
      hazard: d.hazard || n?.hazard || '',
      hazard_situation: n?.hazard_situation || '',
      existing_measure: n?.existing_measure || '',
      improvement_measure: n?.improvement_measure || '',
    };
  });
  const metas = await fetchRiskFillBatch(
    { ...opts, draftItems: forMeta, fillStage: 'meta' },
    signal,
  );

  return forMeta.map((d, i) => {
    const n =
      narratives.find((x) => (x.sub_task || '').trim() === (d.sub_task || '').trim()) ||
      narratives[i];
    const m =
      metas.find((x) => (x.sub_task || '').trim() === (d.sub_task || '').trim()) || metas[i];
    const base = n || mapAIItemToGenerated({ sub_task: d.sub_task, hazard: d.hazard }, opts.processName);
    if (!m) return base;
    return {
      ...base,
      likelihood_grade: m.likelihood_grade || base.likelihood_grade,
      severity_grade: m.severity_grade || base.severity_grade,
      risk_grade: m.risk_grade || base.risk_grade,
      improved_likelihood_grade: m.improved_likelihood_grade || base.improved_likelihood_grade,
      improved_severity_grade: m.improved_severity_grade || base.improved_severity_grade,
      improved_risk_grade: m.improved_risk_grade || base.improved_risk_grade,
      frequency: m.frequency ?? base.frequency,
      severity: m.severity ?? base.severity,
      improved_frequency: m.improved_frequency ?? base.improved_frequency,
      improved_severity: m.improved_severity ?? base.improved_severity,
      ppe: m.ppe?.length ? m.ppe : base.ppe,
      legal_basis: m.legal_basis?.length ? m.legal_basis : base.legal_basis,
    };
  });
}

/** Phase 2 (legacy single-row) — used for [재시도] of one failed row. */
export async function fetchRiskRowDetail(
  opts: AIGenerateOptions & { subTask: string },
  signal?: AbortSignal,
): Promise<GeneratedRiskItem> {
  const detailLevel: DetailLevel = opts.detailLevel || 'core';
  const data = await invokeRiskJson<{ item?: any; error?: string }>(
    {
      mode: 'risk_row',
      process_name: opts.processName,
      sub_task: opts.subTask,
      equipment: opts.equipment || '',
      work_description: opts.workDescription || '',
      work_location: opts.workLocation || '일반',
      work_environment: opts.workEnvironment || [],
      detail_level: detailLevel,
      project_id: opts.projectId || '',
    },
    signal,
  );
  if (!data?.item) {
    throw new Error(mapErrorMessage(data?.error || '행 상세 생성에 실패했습니다.'));
  }
  const mapped = mapAIItemToGenerated(data.item, opts.processName);
  mapped.sub_task = mapped.sub_task || opts.subTask;
  return mapped;
}

/** Max auto-retries for a single risk_row call (attempt 1 + 2 retries = 3 total). */
export const RISK_ROW_MAX_ATTEMPTS = 3;

/**
 * Hard ceiling on Edge invocations for one two-step / fill batch (all rows).
 * Per-row still uses RISK_ROW_MAX_ATTEMPTS; this stops runaway across many rows.
 * Edge-side NVIDIA HTTP is separately capped (nvidiaChat DEFAULT_MAX_LLM_CALLS_PER_REQUEST=6).
 */
export const RISK_AI_MAX_EDGE_CALLS_PER_BATCH = 36;

/** Strict parallel cap for Phase-2 row fills (avoids NVIDIA/Edge rate limits). */
export const RISK_ROW_CONCURRENCY = 2;

export type LlmCallBudget = { used: number; max: number };

export function createLlmCallBudget(max: number): LlmCallBudget {
  return { used: 0, max: Math.max(1, Math.floor(max)) };
}

export function resolveBatchEdgeCallBudget(rowCount: number): LlmCallBudget {
  const perRows = Math.max(RISK_ROW_MAX_ATTEMPTS, rowCount * RISK_ROW_MAX_ATTEMPTS);
  return createLlmCallBudget(Math.min(RISK_AI_MAX_EDGE_CALLS_PER_BATCH, perRows));
}

export const AI_ROW_FAILED_HAZARD = 'API 과부하로 생성 지연. [재시도] 버튼을 눌러주세요';
export const AI_ROW_FAILED_NOTE_PREFIX = '[AI_ROW_FAILED]';

export function isAiFailedRiskItem(item: { hazard?: string | null; note?: string | null }): boolean {
  const h = item.hazard || '';
  const n = item.note || '';
  return n.includes(AI_ROW_FAILED_NOTE_PREFIX) || h.includes('API 과부하로 생성 지연') || h.startsWith('생성 실패');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Retry wrapper — up to RISK_ROW_MAX_ATTEMPTS, with backoff.
 * Rate-limit / timeout errors wait longer before the next attempt.
 * Optional `budget` counts each attempt (Edge invoke); stops clearly at ceiling.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    attempts?: number;
    signal?: AbortSignal;
    label?: string;
    budget?: LlmCallBudget;
  },
): Promise<T> {
  const attempts = Math.max(1, opts?.attempts ?? RISK_ROW_MAX_ATTEMPTS);
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (opts?.budget && opts.budget.used >= opts.budget.max) {
      throw new Error(
        `AI 호출 상한(${opts.budget.max}회)에 도달했습니다. 더 이상 재시도하지 않습니다.`,
      );
    }
    if (opts?.budget) opts.budget.used += 1;
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || err || '');
      // CALL_CAP / 호출 상한: do not burn more retries (edge already stopped)
      const hitCap = /호출 상한|CALL_CAP/i.test(msg);
      const retryable =
        !hitCap &&
        /RATE_LIMIT|429|TIMEOUT|중단|과부하|NETWORK|fetch|서버 오류|5\d\d/i.test(msg);
      console.warn(`[AI Engine] retry ${i}/${attempts}${opts?.label ? ` (${opts.label})` : ''}:`, msg);
      if (i >= attempts || !retryable) throw err;
      const delayMs = /RATE_LIMIT|429|과부하/i.test(msg)
        ? 1500 * i
        : 800 * i;
      await sleep(delayMs, opts?.signal);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchRiskRowDetailWithRetry(
  opts: AIGenerateOptions & { subTask: string },
  signal?: AbortSignal,
  budget?: LlmCallBudget,
): Promise<GeneratedRiskItem> {
  return withRetry(() => fetchRiskRowDetail(opts, signal), {
    attempts: RISK_ROW_MAX_ATTEMPTS,
    signal,
    label: opts.subTask,
    budget,
  });
}

/** Run async tasks with a concurrency cap. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Two-step risk generation:
 * 1) timeline → caller inserts placeholder rows
 * 2) parallel per-row detail fill
 */
export async function generateRiskItemsTwoStep(
  opts: AIGenerateOptions,
  handlers?: {
    onTimeline?: (subTasks: string[]) => void | Promise<void>;
    onRow?: (item: GeneratedRiskItem, index: number, subTask: string) => void | Promise<void>;
    onProgress?: (progress: AIGenerateProgress, partialItems: GeneratedRiskItem[]) => void;
    onRowError?: (subTask: string, index: number, error: Error) => void;
    concurrency?: number;
    signal?: AbortSignal;
  },
): Promise<{
  items: GeneratedRiskItem[];
  source: 'ai';
  normalizedEquipment?: string;
  interrupted?: boolean;
}> {
  handlers?.onProgress?.(
    { phase: 'generating', itemsSoFar: 0, message: 'JSA 세부작업 타임라인 도출 중…' },
    [],
  );

  const { subTasks, normalizedEquipment } = await fetchJsaTimeline(opts, handlers?.signal);
  await handlers?.onTimeline?.(subTasks);
  handlers?.onProgress?.(
    {
      phase: 'status',
      itemsSoFar: 0,
      message: `세부작업 ${subTasks.length}건 확보 · 행별 병렬 생성 시작…`,
      normalizedEquipment,
    },
    [],
  );

  const items: GeneratedRiskItem[] = [];
  let interrupted = false;
  const concurrency = Math.max(1, Math.min(handlers?.concurrency ?? RISK_ROW_CONCURRENCY, 3));
  const edgeBudget = resolveBatchEdgeCallBudget(subTasks.length);

  await mapPool(subTasks, concurrency, async (subTask, index) => {
    if (handlers?.signal?.aborted) {
      interrupted = true;
      return null as any;
    }
    try {
      const row = await fetchRiskRowDetailWithRetry(
        { ...opts, subTask },
        handlers?.signal,
        edgeBudget,
      );
      items.push(row);
      await handlers?.onRow?.(row, index, subTask);
      handlers?.onProgress?.(
        {
          phase: 'generating',
          itemsSoFar: items.length,
          message: `${items.length}/${subTasks.length}행 채움 완료`,
          normalizedEquipment,
        },
        [...items],
      );
      return row;
    } catch (err: any) {
      interrupted = true;
      const e = err instanceof Error ? err : new Error(String(err?.message || err));
      handlers?.onRowError?.(subTask, index, e);
      console.warn('[AI Engine] risk_row failed after retries:', subTask, e.message);
      return null as any;
    }
  });

  if (items.length === 0) {
    throw new Error('AI가 유효한 항목을 반환하지 않았습니다.');
  }

  handlers?.onProgress?.(
    {
      phase: 'complete',
      itemsSoFar: items.length,
      message: interrupted
        ? `부분 완료 · ${items.length}/${subTasks.length}행`
        : `완료 · ${items.length}행`,
      normalizedEquipment,
    },
    items,
  );

  return { items, source: 'ai', normalizedEquipment, interrupted };
}

function mapAccidentPayload(raw: any): AIAccidentCase | null {
  if (!raw || typeof raw !== 'object') return null;
  const a: AIAccidentCase = {
    title: raw.title || raw.accident_type || '',
    cause: raw.cause || '',
    result: raw.result || '',
    prevention: raw.prevention || '',
    occurrence_date: raw.occurrence_date || '',
    location: raw.location || '',
    accident_summary: raw.accident_summary || raw.description || '',
  };
  if (!(a.title || a.cause || a.accident_summary)) return null;
  return a;
}

async function consumeSse(
  url: string,
  body: Record<string, unknown>,
  handlers: {
    onEvent?: (payload: any) => void | Promise<void>;
  },
  signal?: AbortSignal,
): Promise<void> {
  const token = await getAccessToken();
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    let detail = '';
    try {
      const errBody = await resp.json();
      detail = errBody?.error || errBody?.message || '';
      if (errBody?.code === 'WORKER_RESOURCE_LIMIT') {
        detail = 'AI 생성 연결이 중단되었습니다. 이미 생성된 항목은 유지됩니다.';
      }
    } catch { /* ignore */ }
    throw new Error(mapErrorMessage(detail || `AI 서버 오류 (${resp.status})`));
  }

  if (!resp.body) throw new Error('AI 스트림 응답이 비어 있습니다.');

  const reader = resp.body.getReader();
  // stream:true keeps multi-byte Hangul across chunk boundaries
  const decoder = new TextDecoder('utf-8', { stream: true } as TextDecoderOptions);
  let carry = '';
  let streamError: string | null = null;
  let gotItems = false;

  const handleEvent = async (payload: any) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.type === 'error') {
      streamError = String(payload.error || 'AI 생성 실패');
    }
    if (payload.type === 'item' || payload.type === 'accident') {
      gotItems = true;
    }
    await handlers.onEvent?.(payload);
  };

  const parseDataLine = async (data: string) => {
    if (!data || data === '[DONE]') return;
    try {
      await handleEvent(JSON.parse(data));
    } catch (error) {
      // Bulletproof: one bad SSE frame must NOT kill the whole stream
      console.error('Stream parsing failed. Raw buffer:', data.slice(0, 500), error);
      // Try to salvage a complete {...} envelope from noisy data
      const start = data.indexOf('{');
      const end = data.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          await handleEvent(JSON.parse(data.slice(start, end + 1)));
        } catch (error2) {
          console.error('Stream parsing failed (salvage). Raw buffer:', data.slice(0, 500), error2);
        }
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const frames = carry.split('\n\n');
    carry = frames.pop() || '';
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data:')) continue;
        await parseDataLine(trimmed.slice(5).trim());
      }
    }
  }

  carry += decoder.decode();
  if (carry.trim()) {
    for (const line of carry.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      await parseDataLine(trimmed.slice(5).trim());
    }
  }

  if (streamError && !gotItems) {
    throw new Error(mapErrorMessage(streamError));
  }
  if (streamError) {
    console.warn('[AI Engine] stream ended with error after partial items:', streamError);
  }
}

async function fetchRiskItemsOneShot(
  opts: AIGenerateOptions,
  handlers: {
    onProgress?: (progress: AIGenerateProgress, partialItems: GeneratedRiskItem[]) => void;
    onItem?: (item: GeneratedRiskItem, itemsSoFar: GeneratedRiskItem[]) => void | Promise<void>;
    signal?: AbortSignal;
  },
  bag: {
    items: GeneratedRiskItem[];
    seen: Set<string>;
    source: { value: 'library' | 'cache' | 'ai' | 'hybrid' };
    normalizedEquipment: { value?: string };
  },
): Promise<void> {
  const detailLevel: DetailLevel = opts.detailLevel || 'core';
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;

  handlers.onProgress?.(
    {
      phase: 'generating',
      itemsSoFar: 0,
      phaseId: 'oneshot',
      phaseTitle: 'JSA One-Shot SSE',
      message: '위험성평가 AI 스트리밍 연결 중…',
      normalizedEquipment: bag.normalizedEquipment.value,
    },
    bag.items,
  );

  // Soft client timeout — Edge wall ~150s; leave a little headroom for last SSE frames
  const timeoutMs = 155_000;
  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const onOuterAbort = () => timeoutCtrl.abort();
  handlers.signal?.addEventListener('abort', onOuterAbort);

  try {
    await consumeSse(
      `${baseUrl}/functions/v1/generate-risk-ai`,
      {
        process_name: opts.processName,
        equipment: opts.equipment || '',
        work_description: opts.workDescription || '',
        work_location: opts.workLocation || '일반',
        work_environment: opts.workEnvironment || [],
        detail_level: detailLevel,
        project_id: opts.projectId || '',
        stream: true,
        mode: 'risk',
      },
      {
        onEvent: async (payload) => {
          const type = payload?.type;
          if (type === 'meta') {
            if (payload.normalized_equipment) bag.normalizedEquipment.value = payload.normalized_equipment;
            bag.source.value = 'ai';
            handlers.onProgress?.(
              {
                phase: 'generating',
                itemsSoFar: bag.items.length,
                message: 'JSA 스트리밍 생성 중…',
                normalizedEquipment: bag.normalizedEquipment.value,
              },
              bag.items,
            );
            return;
          }
          if (type === 'status') {
            handlers.onProgress?.(
              {
                phase: 'status',
                itemsSoFar: typeof payload.items_so_far === 'number'
                  ? payload.items_so_far
                  : bag.items.length,
                message: String(payload.message || '생성 중…'),
                elapsedSec: typeof payload.elapsed_sec === 'number' ? payload.elapsed_sec : undefined,
                normalizedEquipment: bag.normalizedEquipment.value,
              },
              bag.items,
            );
            return;
          }
          if (type === 'item' && payload.item) {
            try {
              const mapped = mapAIItemToGenerated(payload.item, opts.processName);
              const key = `${mapped.sub_task}|${mapped.hazard}`;
              if (opts.deduplicate !== false && bag.seen.has(key)) return;
              if (!mapped.sub_task || !mapped.hazard) {
                console.error('Stream parsing failed. Raw buffer:', payload.item, 'missing sub_task/hazard');
                return;
              }
              bag.seen.add(key);
              bag.items.push(mapped);
              await handlers.onItem?.(mapped, bag.items);
              handlers.onProgress?.(
                {
                  phase: 'generating',
                  itemsSoFar: bag.items.length,
                  message: `${bag.items.length}건 수신…`,
                  normalizedEquipment: bag.normalizedEquipment.value,
                },
                bag.items,
              );
            } catch (error) {
              console.error('Stream parsing failed. Raw buffer:', payload.item, error);
            }
            return;
          }
          if (type === 'done') {
            bag.source.value = 'ai';
            if (payload.normalized_equipment) bag.normalizedEquipment.value = payload.normalized_equipment;
            handlers.onProgress?.(
              {
                phase: 'complete',
                itemsSoFar: bag.items.length,
                message: `스트림 완료 · ${bag.items.length}건`,
                normalizedEquipment: bag.normalizedEquipment.value,
              },
              bag.items,
            );
          }
        },
      },
      timeoutCtrl.signal,
    );
  } catch (err: any) {
    if (err?.name === 'AbortError' || /aborted/i.test(String(err?.message || ''))) {
      if (bag.items.length > 0) {
        console.warn('[AI Engine] stream aborted with partial items:', bag.items.length);
        return;
      }
      throw new Error('AI 생성 연결이 중단되었습니다. 이미 생성된 항목은 유지됩니다. 다시 시도하거나 공종을 나눠 주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    handlers.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * One-shot risk generation via generate-risk-ai SSE (single phase, no prep/main/finish).
 * Callers should save-as-you-go via onItem; partial streams return items already received.
 */
export async function generateRiskItemsStreaming(
  opts: AIGenerateOptions,
  handlers?: {
    onProgress?: (progress: AIGenerateProgress, partialItems: GeneratedRiskItem[]) => void;
    onItem?: (item: GeneratedRiskItem, itemsSoFar: GeneratedRiskItem[]) => void | Promise<void>;
    signal?: AbortSignal;
  },
): Promise<{
  items: GeneratedRiskItem[];
  source: 'library' | 'cache' | 'ai' | 'hybrid';
  normalizedEquipment?: string;
  interrupted?: boolean;
}> {
  const bag = {
    items: [] as GeneratedRiskItem[],
    seen: new Set<string>(),
    source: { value: 'ai' as 'library' | 'cache' | 'ai' | 'hybrid' },
    normalizedEquipment: { value: undefined as string | undefined },
  };

  handlers?.onProgress?.({ phase: 'generating', itemsSoFar: 0 }, []);

  let interrupted = false;
  try {
    await fetchRiskItemsOneShot(opts, handlers || {}, bag);
  } catch (err: any) {
    if (bag.items.length > 0) {
      interrupted = true;
      console.warn('[AI Engine] partial stream kept:', bag.items.length, err?.message || err);
    } else {
      throw err;
    }
  }

  if (bag.items.length === 0) {
    throw new Error('AI가 유효한 항목을 반환하지 않았습니다.');
  }

  handlers?.onProgress?.(
    {
      phase: 'complete',
      itemsSoFar: bag.items.length,
      message: interrupted
        ? `연결 중단 · ${bag.items.length}건까지 수신`
        : `스트림 완료 · ${bag.items.length}건`,
      normalizedEquipment: bag.normalizedEquipment.value,
    },
    bag.items,
  );
  return {
    items: bag.items,
    source: bag.source.value,
    normalizedEquipment: bag.normalizedEquipment.value,
    interrupted,
  };
}

/**
 * Stream KOSHA-style accident cases from generate-accident-ai (SSE).
 * Uses TextDecoder('utf-8', { stream: true }) so Korean chunks never corrupt.
 */
export async function generateAccidentCasesStreaming(
  opts: {
    processName: string;
    equipment?: string;
    workDescription?: string;
    workLocation?: string;
    projectId?: string;
  },
  handlers?: {
    onAccident?: (accident: AIAccidentCase, soFar: AIAccidentCase[]) => void | Promise<void>;
    onProgress?: (count: number) => void;
    signal?: AbortSignal;
  },
): Promise<{ accidents: AIAccidentCase[]; source: 'ai' }> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const accidents: AIAccidentCase[] = [];
  const seen = new Set<string>();

  await consumeSse(
    `${baseUrl}/functions/v1/generate-accident-ai`,
    {
      process_name: opts.processName,
      equipment: opts.equipment || '',
      work_description: opts.workDescription || '',
      work_location: opts.workLocation || '',
      project_id: opts.projectId || '',
      stream: true,
      mode: 'accident',
    },
    {
      onEvent: async (payload) => {
        if (payload.type === 'accident' && payload.accident) {
          const a = mapAccidentPayload(payload.accident);
          if (!a) return;
          if (a.title && seen.has(a.title)) return;
          if (a.title) seen.add(a.title);
          if (accidents.length >= 4) return;
          accidents.push(a);
          await handlers?.onAccident?.(a, accidents);
          handlers?.onProgress?.(accidents.length);
          return;
        }
        if (payload.type === 'done' && Array.isArray(payload.accident_cases)) {
          for (const c of payload.accident_cases) {
            const a = mapAccidentPayload(c);
            if (!a) continue;
            if (a.title && seen.has(a.title)) continue;
            if (a.title) seen.add(a.title);
            if (accidents.length >= 4) break;
            accidents.push(a);
            await handlers?.onAccident?.(a, accidents);
          }
          handlers?.onProgress?.(accidents.length);
        }
      },
    },
    handlers?.signal,
  );

  if (accidents.length === 0) {
    throw new Error('AI가 유효한 사고사례를 반환하지 않았습니다.');
  }

  return { accidents: accidents.slice(0, 4), source: 'ai' };
}

/**
 * AI-first risk item generation (one-shot JSON by default).
 * Falls back to library only when generation fails with zero items.
 */
export async function generateRiskItemsHybrid(
  opts: AIGenerateOptions,
  onProgress?: (progress: AIGenerateProgress, partialItems: GeneratedRiskItem[]) => void,
): Promise<{
  items: GeneratedRiskItem[];
  source: 'library' | 'cache' | 'ai' | 'hybrid';
  normalizedEquipment?: string;
}> {
  const detailLevel: DetailLevel = opts.detailLevel || 'core';

  try {
    return await generateRiskItemsTwoStep(opts, { onProgress, concurrency: RISK_ROW_CONCURRENCY });
  } catch (err: any) {
    const rawMsg = err?.message || '';
    console.error('[AI Engine] two-step 실패:', rawMsg);

    const mapped = mapErrorMessage(rawMsg);
    if (/할당량|API 키|너무 많/.test(mapped) && mapped !== rawMsg) {
      throw new Error(mapped);
    }
    if (/할당량|API 키|너무 많|키가 유효하지/.test(rawMsg)) {
      throw new Error(mapped);
    }

    onProgress?.({ phase: 'fallback', itemsSoFar: 0 }, []);
    const fallbackTarget = detailLevel === 'core' ? 12 : 20;
    const libraryItems = await generateRiskItems({
      processName: opts.processName,
      tags: opts.tags || [],
      targetCount: fallbackTarget,
      deduplicate: opts.deduplicate ?? true,
    });

    if (libraryItems.length > 0) {
      onProgress?.({ phase: 'complete', itemsSoFar: libraryItems.length }, libraryItems);
      return { items: libraryItems, source: 'library' };
    }

    throw new Error(mapped || 'AI 생성에 실패했습니다. 표준 위험성평가 라이브러리가 비어 있어 대체 생성도 불가합니다.');
  }
}
