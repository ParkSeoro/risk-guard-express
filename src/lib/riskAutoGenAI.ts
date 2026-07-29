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
  if (/크레딧|CREDITS_EXHAUSTED|credit_limit|402|QUOTA_EXHAUSTED|할당량/i.test(rawMsg)) {
    return 'AI 무료 할당량이 소진되었습니다. 관리자에게 문의하거나 잠시 후 다시 시도해주세요.';
  }
  if (/INVALID_KEY|api[_ ]?key|NVIDIA_API_KEY|DEEPSEEK_API_KEY|키가 유효하지/i.test(rawMsg)) {
    return 'AI API 키가 설정되지 않았거나 유효하지 않습니다. 마스터가 DEEPSEEK_API_KEY(위험성평가) / NVIDIA_API_KEY를 Edge Secrets에 등록해야 합니다.';
  }
  if (/RATE_LIMIT|429|too many|너무 많/i.test(rawMsg)) {
    return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
  }
  if (/TIMEOUT|중단되었|시간.?초과|WORKER_RESOURCE|compute resources/i.test(rawMsg)) {
    return 'AI 생성 연결이 중단되었습니다. 이미 생성된 항목은 유지됩니다. 다시 시도하거나 공종을 나눠 주세요.';
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
      message: 'DeepSeek JSA 스트리밍 연결 중…',
      normalizedEquipment: bag.normalizedEquipment.value,
    },
    bag.items,
  );

  // Soft client timeout — stop infinite spinner if Edge/DeepSeek never completes
  const timeoutMs = 140_000;
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
    return await generateRiskItemsStreaming(opts, { onProgress });
  } catch (err: any) {
    const rawMsg = err?.message || '';
    console.error('[AI Engine] oneshot 실패:', rawMsg);

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
