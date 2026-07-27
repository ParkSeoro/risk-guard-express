import { supabase } from '@/integrations/supabase/client';
import { calculateRiskGrade, type RiskGrade } from './riskGrade';
import { correctTerms } from './termCorrection';
import { generateRiskItems, type GeneratedRiskItem } from './riskAutoGen';

export type DetailLevel = 'core' | 'comprehensive';

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
  phase: 'cache_check' | 'generating' | 'fallback' | 'complete';
  itemsSoFar: number;
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

/**
 * AI-first risk item generation.
 * Sends a single request with detail_level instead of a fixed target count —
 * the AI decides how many items to return based on the requested depth.
 */
export async function generateRiskItemsHybrid(
  opts: AIGenerateOptions,
  onProgress?: (progress: AIGenerateProgress, partialItems: GeneratedRiskItem[]) => void,
): Promise<{
  items: GeneratedRiskItem[];
  source: 'library' | 'cache' | 'ai' | 'hybrid';
  normalizedEquipment?: string;
}> {
  const detailLevel: DetailLevel = opts.detailLevel || 'comprehensive';
  let normalizedEquipment: string | undefined;

  try {
    onProgress?.({ phase: 'cache_check', itemsSoFar: 0 }, []);

    const { data: result, error } = await supabase.functions.invoke('generate-risk-ai', {
      body: {
        process_name: opts.processName,
        equipment: opts.equipment || '',
        work_description: opts.workDescription || '',
        work_location: opts.workLocation || '일반',
        work_environment: opts.workEnvironment || [],
        detail_level: detailLevel,
        project_id: opts.projectId || '',
      },
    });

    if (error) throw new Error(error.message || 'AI 생성 실패');
    if (result?.error) throw new Error(result.error);

    normalizedEquipment = result?.normalized_equipment;
    const source = result?.source || 'ai';
    const items = (result?.items || []).map((item: any) => mapAIItemToGenerated(item, opts.processName));

    onProgress?.({ phase: 'complete', itemsSoFar: items.length, normalizedEquipment }, items);
    return { items, source, normalizedEquipment };
  } catch (err: any) {
    const rawMsg = err?.message || '';
    console.error('[AI Engine] AI 호출 실패:', rawMsg);

    if (/크레딧|CREDITS_EXHAUSTED|credit_limit|402|QUOTA_EXHAUSTED|할당량/i.test(rawMsg)) {
      throw new Error('AI 무료 할당량이 소진되었습니다. 관리자에게 문의하거나 잠시 후 다시 시도해주세요.');
    }
    if (/INVALID_KEY|api[_ ]?key|NVIDIA_API_KEY/i.test(rawMsg)) {
      throw new Error('AI API 키가 설정되지 않았거나 유효하지 않습니다. 마스터가 설정 > 시크릿에서 확인해야 합니다.');
    }
    if (/RATE_LIMIT|429|too many/i.test(rawMsg)) {
      throw new Error('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    }

    // Fallback to library only for unknown errors
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
      return { items: libraryItems, source: 'library' };
    }

    throw new Error(rawMsg || 'AI 생성에 실패했습니다.');
  }
}
