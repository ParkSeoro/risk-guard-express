import { supabase } from '@/integrations/supabase/client';
import { calculateRiskGrade, type RiskGrade } from './riskGrade';
import { correctTerms } from './termCorrection';
import { generateRiskItems, type GeneratedRiskItem } from './riskAutoGen';

export type DetailLevel = 'core' | 'comprehensive';

export interface AIAccidentCase {
  title: string;
  cause: string;
  result: string;
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
  phase: 'cache_check' | 'generating' | 'fallback' | 'complete' | 'phase';
  itemsSoFar: number;
  normalizedEquipment?: string;
  phaseId?: string;
  phaseTitle?: string;
}

function mapAIItemToGenerated(item: any, processName: string): GeneratedRiskItem {
  const lg: RiskGrade = (['상', '중', '하'].includes(item.likelihood_grade) ? item.likelihood_grade : '중') as RiskGrade;
  const sg: RiskGrade = (['상', '중', '하'].includes(item.severity_grade) ? item.severity_grade : '중') as RiskGrade;
  const rg = calculateRiskGrade(lg, sg);
  const ilg: RiskGrade = (['상', '중', '하'].includes(item.improved_likelihood_grade) ? item.improved_likelihood_grade : '하') as RiskGrade;
  const isg: RiskGrade = (['상', '중', '하'].includes(item.improved_severity_grade) ? item.improved_severity_grade : '하') as RiskGrade;
  const irg = calculateRiskGrade(ilg, isg);

  return {
    process: correctTerms(item.process || processName),
    sub_task: item.sub_task || '',
    hazard: item.hazard || '',
    hazard_situation: item.hazard_situation || '',
    existing_measure: item.existing_measure || '',
    improvement_measure: item.improvement_measure || '',
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
    ppe: Array.isArray(item.ppe) ? item.ppe : [],
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
  if (/INVALID_KEY|api[_ ]?key|NVIDIA_API_KEY|키가 유효하지/i.test(rawMsg)) {
    return 'AI API 키가 설정되지 않았거나 유효하지 않습니다. 마스터가 설정 > 시크릿에서 확인해야 합니다.';
  }
  if (/RATE_LIMIT|429|too many|너무 많/i.test(rawMsg)) {
    return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
  }
  if (/시간.?초과|WORKER_RESOURCE|compute resources/i.test(rawMsg)) {
    return 'AI 생성 연결이 중단되었습니다. 이미 생성된 항목은 유지됩니다. 다시 시도하거나 공종을 나눠 주세요.';
  }
  return rawMsg || 'AI 생성에 실패했습니다.';
}

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');
  return token;
}

/**
 * Stream risk items from generate-risk-ai (SSE).
 * Uses TextDecoder('utf-8', { stream: true }) so Korean chunks never corrupt.
 */
export async function generateRiskItemsStreaming(
  opts: AIGenerateOptions,
  handlers?: {
    onProgress?: (progress: AIGenerateProgress, partialItems: GeneratedRiskItem[]) => void;
    onItem?: (item: GeneratedRiskItem, itemsSoFar: GeneratedRiskItem[]) => void | Promise<void>;
    onAccident?: (accident: AIAccidentCase) => void;
    signal?: AbortSignal;
  },
): Promise<{
  items: GeneratedRiskItem[];
  source: 'library' | 'cache' | 'ai' | 'hybrid';
  normalizedEquipment?: string;
  accidentCases?: AIAccidentCase[];
}> {
  const detailLevel: DetailLevel = opts.detailLevel || 'comprehensive';
  const items: GeneratedRiskItem[] = [];
  const accidentCases: AIAccidentCase[] = [];
  let source: 'library' | 'cache' | 'ai' | 'hybrid' = 'ai';
  let normalizedEquipment: string | undefined;
  const seen = new Set<string>();

  handlers?.onProgress?.({ phase: 'generating', itemsSoFar: 0 }, []);

  const token = await getAccessToken();
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  const resp = await fetch(`${baseUrl}/functions/v1/generate-risk-ai`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      process_name: opts.processName,
      equipment: opts.equipment || '',
      work_description: opts.workDescription || '',
      work_location: opts.workLocation || '일반',
      work_environment: opts.workEnvironment || [],
      detail_level: detailLevel,
      project_id: opts.projectId || '',
      stream: true,
    }),
    signal: handlers?.signal,
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
  const decoder = new TextDecoder('utf-8', { stream: true });
  let carry = '';
  let streamError: string | null = null;

  const handleEvent = async (payload: any) => {
    if (!payload || typeof payload !== 'object') return;
    const type = payload.type;

    if (type === 'meta') {
      if (payload.normalized_equipment) normalizedEquipment = payload.normalized_equipment;
      if (payload.source === 'cache' || payload.source === 'ai') source = payload.source;
      return;
    }

    if (type === 'phase') {
      handlers?.onProgress?.(
        {
          phase: 'phase',
          itemsSoFar: items.length,
          phaseId: payload.phase,
          phaseTitle: payload.title,
          normalizedEquipment,
        },
        items,
      );
      return;
    }

    if (type === 'item' && payload.item) {
      const mapped = mapAIItemToGenerated(payload.item, opts.processName);
      const key = `${mapped.sub_task}|${mapped.hazard}`;
      if (opts.deduplicate !== false && seen.has(key)) return;
      seen.add(key);
      items.push(mapped);
      await handlers?.onItem?.(mapped, items);
      handlers?.onProgress?.(
        { phase: 'generating', itemsSoFar: items.length, normalizedEquipment },
        items,
      );
      return;
    }

    if (type === 'accident' && payload.accident) {
      const a: AIAccidentCase = {
        title: payload.accident.title || '',
        cause: payload.accident.cause || '',
        result: payload.accident.result || '',
      };
      if (a.title || a.cause) {
        accidentCases.push(a);
        handlers?.onAccident?.(a);
      }
      return;
    }

    if (type === 'done') {
      if (payload.source === 'cache' || payload.source === 'ai') source = payload.source;
      if (payload.normalized_equipment) normalizedEquipment = payload.normalized_equipment;
      if (Array.isArray(payload.accident_cases)) {
        for (const c of payload.accident_cases) {
          const a: AIAccidentCase = { title: c.title || '', cause: c.cause || '', result: c.result || '' };
          if ((a.title || a.cause) && !accidentCases.some((x) => x.title === a.title)) {
            accidentCases.push(a);
          }
        }
      }
      return;
    }

    if (type === 'error') {
      streamError = String(payload.error || 'AI 생성 실패');
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });

    // SSE frames separated by blank line
    const frames = carry.split('\n\n');
    carry = frames.pop() || '';

    for (const frame of frames) {
      const lines = frame.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const payload = JSON.parse(data);
          await handleEvent(payload);
        } catch {
          // incomplete JSON in frame — rare with \n\n framing
        }
      }
    }
  }

  // Flush decoder + leftover
  carry += decoder.decode();
  if (carry.trim()) {
    for (const line of carry.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        await handleEvent(JSON.parse(data));
      } catch { /* ignore */ }
    }
  }

  if (streamError && items.length === 0) {
    throw new Error(mapErrorMessage(streamError));
  }

  if (items.length === 0) {
    throw new Error('AI가 유효한 항목을 반환하지 않았습니다.');
  }

  handlers?.onProgress?.({ phase: 'complete', itemsSoFar: items.length, normalizedEquipment }, items);
  return {
    items,
    source,
    normalizedEquipment,
    accidentCases: accidentCases.slice(0, 3),
  };
}

/**
 * AI-first risk item generation (streaming by default).
 * Falls back to library only when streaming fails with zero items.
 */
export async function generateRiskItemsHybrid(
  opts: AIGenerateOptions,
  onProgress?: (progress: AIGenerateProgress, partialItems: GeneratedRiskItem[]) => void,
): Promise<{
  items: GeneratedRiskItem[];
  source: 'library' | 'cache' | 'ai' | 'hybrid';
  normalizedEquipment?: string;
  accidentCases?: AIAccidentCase[];
}> {
  const detailLevel: DetailLevel = opts.detailLevel || 'comprehensive';

  try {
    return await generateRiskItemsStreaming(opts, { onProgress });
  } catch (err: any) {
    const rawMsg = err?.message || '';
    console.error('[AI Engine] stream 실패:', rawMsg);

    const mapped = mapErrorMessage(rawMsg);
    if (/할당량|API 키|너무 많/.test(mapped) && mapped !== rawMsg) {
      throw new Error(mapped);
    }
    if (/할당량|API 키|너무 많|키가 유효하지/.test(rawMsg)) {
      throw new Error(mapped);
    }

    onProgress?.({ phase: 'fallback', itemsSoFar: 0 }, []);
    const fallbackTarget = detailLevel === 'core' ? 15 : 30;
    const libraryItems = await generateRiskItems({
      processName: opts.processName,
      tags: opts.tags || [],
      targetCount: fallbackTarget,
      deduplicate: opts.deduplicate ?? true,
    });

    if (libraryItems.length > 0) {
      onProgress?.({ phase: 'complete', itemsSoFar: libraryItems.length }, libraryItems);
      return { items: libraryItems, source: 'library', accidentCases: [] };
    }

    throw new Error(mapped || 'AI 생성에 실패했습니다. 표준 위험성평가 라이브러리가 비어 있어 대체 생성도 불가합니다.');
  }
}
