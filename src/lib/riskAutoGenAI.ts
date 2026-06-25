import { supabase } from '@/integrations/supabase/client';
import { calculateRiskGrade, type RiskGrade } from './riskGrade';
import { correctTerms } from './termCorrection';
import { generateRiskItems, type GeneratedRiskItem } from './riskAutoGen';

export interface AIGenerateOptions {
  processName: string;
  equipment?: string;
  workDescription?: string;
  workLocation?: string;
  workEnvironment?: string[];
  tags?: string[];
  targetCount?: number;
  deduplicate?: boolean;
  projectId?: string;
}

export interface AIGenerateProgress {
  phase: 'cache_check' | 'generating' | 'fallback' | 'complete';
  batchIndex: number;
  totalBatches: number;
  itemsSoFar: number;
  totalTarget: number;
  normalizedEquipment?: string;
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

const BATCH_SIZE = 8;

/**
 * AI-first risk item generation with progressive batch loading.
 * Calls the edge function in batches and invokes onProgress for partial results.
 */
export async function generateRiskItemsHybrid(
  opts: AIGenerateOptions,
  onProgress?: (progress: AIGenerateProgress, partialItems: GeneratedRiskItem[]) => void,
): Promise<{
  items: GeneratedRiskItem[];
  source: 'library' | 'cache' | 'ai' | 'hybrid';
  normalizedEquipment?: string;
}> {
  const targetCount = opts.targetCount || 30;
  const allItems: GeneratedRiskItem[] = [];
  let normalizedEquipment: string | undefined;

  // Report progress
  const report = (phase: AIGenerateProgress['phase'], batchIndex: number, totalBatches: number) => {
    onProgress?.({
      phase,
      batchIndex,
      totalBatches,
      itemsSoFar: allItems.length,
      totalTarget: targetCount,
      normalizedEquipment,
    }, [...allItems]);
  };

  try {
    // Step 1: First call (checks cache internally)
    report('cache_check', 0, 1);

    const { data: firstResult, error: firstError } = await supabase.functions.invoke('generate-risk-ai', {
      body: {
        process_name: opts.processName,
        equipment: opts.equipment || '',
        work_description: opts.workDescription || '',
        work_location: opts.workLocation || '일반',
        work_environment: opts.workEnvironment || [],
        target_count: targetCount,
        project_id: opts.projectId || '',
        batch_size: BATCH_SIZE,
        // No batch_index = cache check + first batch
      },
    });

    if (firstError) throw new Error(firstError.message || 'AI 생성 실패');
    if (firstResult?.error) throw new Error(firstResult.error);

    normalizedEquipment = firstResult?.normalized_equipment;
    const totalBatches = firstResult?.total_batches || 1;
    const source = firstResult?.source || 'ai';

    // Map first batch items
    const firstItems = (firstResult?.items || []).map((item: any) => mapAIItemToGenerated(item, opts.processName));
    allItems.push(...firstItems);

    // If cache hit or single batch, we're done
    if (source === 'cache' || firstResult?.is_complete) {
      report('complete', 0, 1);
      return { items: allItems.slice(0, targetCount), source, normalizedEquipment };
    }

    report('generating', 1, totalBatches);

    // Step 2: Generate remaining batches
    for (let batchIdx = 1; batchIdx < totalBatches && allItems.length < targetCount; batchIdx++) {
      report('generating', batchIdx, totalBatches);

      const { data: batchResult, error: batchError } = await supabase.functions.invoke('generate-risk-ai', {
        body: {
          process_name: opts.processName,
          equipment: opts.equipment || '',
          work_description: opts.workDescription || '',
          work_location: opts.workLocation || '일반',
          work_environment: opts.workEnvironment || [],
          target_count: targetCount,
          project_id: opts.projectId || '',
          batch_index: batchIdx,
          batch_size: BATCH_SIZE,
        },
      });

      if (batchError || batchResult?.error) {
        console.warn(`[AI Engine] Batch ${batchIdx} failed, stopping`);
        break;
      }

      const batchItems = (batchResult?.items || []).map((item: any) => mapAIItemToGenerated(item, opts.processName));
      
      // Deduplicate against already collected items
      const existingKeys = new Set(allItems.map(i => `${i.sub_task}|${i.hazard}`));
      const newItems = batchItems.filter((i: GeneratedRiskItem) => {
        const key = `${i.sub_task}|${i.hazard}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });

      allItems.push(...newItems);

      if (batchResult?.is_complete) break;
    }

    report('complete', totalBatches, totalBatches);
    return { items: allItems.slice(0, targetCount), source: 'ai', normalizedEquipment };
  } catch (err: any) {
    const rawMsg = err?.message || '';
    console.error('[AI Engine] AI 호출 실패:', rawMsg);

    // Surface credit/rate errors immediately — do not silently fall back
    if (/크레딧|CREDITS_EXHAUSTED|credit_limit|402/i.test(rawMsg)) {
      throw new Error('AI 크레딧이 부족합니다. 워크스페이스 크레딧을 충전한 뒤 다시 시도해주세요.');
    }
    if (/RATE_LIMIT|429|too many/i.test(rawMsg)) {
      throw new Error('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    }

    // Fallback to library only for unknown errors
    report('fallback', 0, 1);
    console.log('[AI Engine] AI 실패 → 라이브러리 폴백');
    const libraryItems = await generateRiskItems({
      processName: opts.processName,
      tags: opts.tags || [],
      targetCount,
      deduplicate: opts.deduplicate ?? true,
    });

    if (libraryItems.length > 0) {
      report('complete', 1, 1);
      return { items: libraryItems.slice(0, targetCount), source: 'library' };
    }

    // Library also empty — propagate the real reason
    throw new Error(rawMsg || 'AI 생성에 실패했습니다.');
  }
}
