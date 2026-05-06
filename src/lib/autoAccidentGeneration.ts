import { supabase } from '@/integrations/supabase/client';
import {
  detectHighRiskCategories,
  getSearchTermsForCategories,
  HIGH_RISK_RULES,
  type HighRiskCategory,
  type RiskItemLike,
} from './highRiskDetection';

export interface AutoAccidentResult {
  categories: HighRiskCategory[];
  inserted: number;
  skipped: number;
}

/**
 * 위험성평가의 risk_items를 분석하여 고위험 작업이 식별되면
 * accident_cases 라이브러리에서 매칭되는 사고사례를 자동으로
 * assessment_accidents 테이블에 추가합니다.
 * (이미 동일 카테고리로 등록된 사례는 건너뜁니다.)
 */
export async function autoGenerateAccidentCases(params: {
  runId: string;
  projectId: string;
  items: RiskItemLike[];
  userId?: string;
  perCategoryLimit?: number;
}): Promise<AutoAccidentResult> {
  const { runId, projectId, items, userId, perCategoryLimit = 2 } = params;
  const categories = detectHighRiskCategories(items);
  if (categories.length === 0) {
    return { categories: [], inserted: 0, skipped: 0 };
  }

  // 기존 자동 생성된 케이스를 카테고리별로 확인
  const { data: existing } = await supabase
    .from('assessment_accidents' as any)
    .select('reference_case_id, accident_type, source_type')
    .eq('run_id', runId);

  const existingRefs = new Set(
    ((existing as any[]) || [])
      .map(e => e.reference_case_id)
      .filter(Boolean)
  );

  let inserted = 0;
  let skipped = 0;

  for (const category of categories) {
    const rule = HIGH_RISK_RULES.find(r => r.category === category);
    if (!rule) continue;

    // 사고 라이브러리에서 검색
    const orFilters = rule.searchTerms
      .map(t => `accident_type.ilike.%${t}%,process_category.ilike.%${t}%,cause.ilike.%${t}%`)
      .join(',');

    const { data: cases } = await supabase
      .from('accident_cases')
      .select('*')
      .or(orFilters)
      .limit(perCategoryLimit * 3);

    const candidates = ((cases as any[]) || [])
      .filter(c => !existingRefs.has(c.id))
      .slice(0, perCategoryLimit);

    if (candidates.length === 0) {
      skipped++;
      continue;
    }

    const inserts = candidates.map(c => ({
      run_id: runId,
      project_id: projectId,
      process: category,
      accident_type: c.accident_type || category,
      cause: c.cause || '',
      result: c.result || '',
      prevention: Array.isArray(c.prevention_measures)
        ? c.prevention_measures.join(', ')
        : '',
      description: c.description || '',
      occurrence_date: c.occurrence_date || null,
      reference_case_id: c.id,
      source_type: 'auto',
      created_by: userId,
    }));

    const { error } = await supabase
      .from('assessment_accidents' as any)
      .insert(inserts);

    if (!error) inserted += inserts.length;
  }

  return { categories, inserted, skipped };
}
