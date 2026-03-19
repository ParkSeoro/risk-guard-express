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
}

function buildCacheKey(opts: AIGenerateOptions): string {
  const equip = opts.equipment || '없음';
  const desc = opts.workDescription || opts.processName + ' 관련 작업';
  const loc = opts.workLocation || '일반';
  const env = (opts.workEnvironment && opts.workEnvironment.length > 0)
    ? opts.workEnvironment.join(', ')
    : '일반 작업 환경';
  return `${opts.processName}|${equip}|${desc}|${loc}|${env}`.toLowerCase().trim();
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

async function fetchFromCache(cacheKey: string): Promise<GeneratedRiskItem[] | null> {
  const { data } = await supabase
    .from('ai_risk_cache')
    .select('*')
    .eq('cache_key', cacheKey)
    .maybeSingle();

  if (!data) return null;

  // Increment hit count
  await supabase
    .from('ai_risk_cache')
    .update({ hit_count: (data.hit_count || 0) + 1 } as any)
    .eq('id', data.id);

  const items = (data.generated_items as any[]) || [];
  return items.map(item => mapAIItemToGenerated(item, data.process_name));
}

async function fetchFromAI(opts: AIGenerateOptions): Promise<GeneratedRiskItem[]> {
  const { data, error } = await supabase.functions.invoke('generate-risk-ai', {
    body: {
      process_name: opts.processName,
      equipment: opts.equipment || '',
      work_description: opts.workDescription || '',
      work_location: opts.workLocation || '일반',
      work_environment: opts.workEnvironment || [],
      target_count: opts.targetCount || 30,
    },
  });

  if (error) throw new Error(error.message || 'AI 생성 실패');
  
  if (data?.error) {
    throw new Error(data.error);
  }

  const items = data?.items || [];
  return items.map((item: any) => mapAIItemToGenerated(item, opts.processName));
}

/**
 * Hybrid risk item generation:
 * 1. Try standard library first
 * 2. If insufficient, check AI cache
 * 3. If still insufficient, call AI
 */
export async function generateRiskItemsHybrid(opts: AIGenerateOptions): Promise<{
  items: GeneratedRiskItem[];
  source: 'library' | 'cache' | 'ai' | 'hybrid';
}> {
  const targetCount = opts.targetCount || 30;

  // Step 1: Try library
  const libraryItems = await generateRiskItems({
    processName: opts.processName,
    tags: opts.tags || [],
    targetCount,
    deduplicate: opts.deduplicate ?? true,
  });

  if (libraryItems.length >= targetCount) {
    return { items: libraryItems.slice(0, targetCount), source: 'library' };
  }

  // Step 2: Check AI cache
  const cacheKey = buildCacheKey(opts);
  const cachedItems = await fetchFromCache(cacheKey);

  if (cachedItems && cachedItems.length > 0) {
    // Merge library + cache, deduplicate
    const merged = deduplicateItems([...libraryItems, ...cachedItems]);
    return { items: merged.slice(0, targetCount), source: libraryItems.length > 0 ? 'hybrid' : 'cache' };
  }

  // Step 3: Call AI
  const aiItems = await fetchFromAI(opts);

  if (aiItems.length > 0) {
    const merged = deduplicateItems([...libraryItems, ...aiItems]);
    return { items: merged.slice(0, targetCount), source: libraryItems.length > 0 ? 'hybrid' : 'ai' };
  }

  // Fallback: return whatever library had
  return { items: libraryItems, source: 'library' };
}

function deduplicateItems(items: GeneratedRiskItem[]): GeneratedRiskItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.sub_task}|${item.hazard}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
