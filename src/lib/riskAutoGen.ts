import { supabase } from '@/integrations/supabase/client';
import { calculateRiskGrade, type RiskGrade } from './riskGrade';
import { correctTerms, correctItemTerms, RISK_ITEM_TEXT_FIELDS } from './termCorrection';

export interface GeneratedRiskItem {
  process: string;
  sub_task: string;
  hazard: string;
  hazard_situation: string;
  existing_measure: string;
  improvement_measure: string;
  likelihood_grade: RiskGrade;
  severity_grade: RiskGrade;
  risk_grade: RiskGrade;
  improved_likelihood_grade: RiskGrade;
  improved_severity_grade: RiskGrade;
  improved_risk_grade: RiskGrade;
  frequency: number;
  severity: number;
  improved_frequency: number;
  improved_severity: number;
  ppe: string[];
  legal_basis: string[];
  department: string;
  assignee: string;
  status: string;
  tags: string[];
}

interface GenerateOptions {
  processName: string;
  tags?: string[];
  targetCount?: number;
  deduplicate?: boolean;
}

function scoreMatch(item: any, processName: string, tags: string[]): number {
  const pLower = processName.toLowerCase();
  let score = 0;
  const keywords: string[] = item.keywords || [];
  const synonyms: string[] = item.synonyms || [];
  const allTerms = [...keywords, ...synonyms, item.category_large, item.category_medium, item.category_small, item.sub_task].map(s => (s || '').toLowerCase());

  for (const term of allTerms) {
    if (!term) continue;
    if (pLower.includes(term) || term.includes(pLower)) score += 10;
    const words = pLower.split(/[\s/,]+/);
    for (const w of words) {
      if (w.length >= 2 && term.includes(w)) score += 5;
    }
  }

  const itemTags: string[] = item.tags || [];
  for (const t of tags) {
    if (itemTags.some((it: string) => it.includes(t) || t.includes(it))) score += 8;
  }

  // Higher risk grade items get priority
  const lg = item.default_likelihood_grade || '중';
  const sg = item.default_severity_grade || '중';
  const rg = calculateRiskGrade(lg, sg);
  if (rg === '상') score += 3;
  else if (rg === '중') score += 1;

  return score;
}

export async function generateRiskItems(options: GenerateOptions): Promise<GeneratedRiskItem[]> {
  const { processName, tags = [], targetCount = 50, deduplicate = true } = options;

  const { data: library } = await supabase
    .from('standard_risk_library')
    .select('*')
    .eq('is_active', true);

  if (!library || library.length === 0) return [];

  let scored = library.map(item => ({
    item,
    score: scoreMatch(item, processName, tags),
  })).filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    const fallback = library.filter(item => {
      const pLower = processName.toLowerCase();
      return (item.category_large || '').toLowerCase().includes(pLower) ||
        pLower.includes((item.category_large || '').toLowerCase());
    });
    if (fallback.length === 0) return [];
    scored = fallback.map(item => ({ item, score: 1 }));
  }

  let selected = scored.slice(0, targetCount);

  if (selected.length < targetCount) {
    const usedCategories = new Set(selected.map(s => s.item.category_large));
    const additional = library
      .filter(item => usedCategories.has(item.category_large) && !selected.some(s => s.item.id === item.id))
      .map(item => ({ item, score: 1 }));
    selected = [...selected, ...additional].slice(0, targetCount);
  }

  if (deduplicate) {
    const seen = new Set<string>();
    selected = selected.filter(s => {
      const key = `${s.item.sub_task}|${s.item.hazard}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const { data: legalRefs } = await supabase.from('legal_references').select('*');

  return selected.map(({ item }) => {
    // Apply term corrections to generated text fields
    const correctedItem = correctItemTerms(item, ['sub_task', 'hazard', 'hazard_situation', 'existing_measure', 'improvement_measure']);
    const libLegalRefs: string[] = item.legal_refs || [];
    const matchedLaws = (legalRefs || [])
      .filter(law =>
        (law.process_mappings || []).some((pm: string) =>
          pm === processName || pm === '전체' || processName.includes(pm)
        ) ||
        (item.keywords || []).some((kw: string) =>
          (law.keywords || []).some((lk: string) => lk.includes(kw) || kw.includes(lk))
        )
      )
      .map(law => `${law.law_name} ${law.article}`);

    const allLegal = [...new Set([...libLegalRefs, ...matchedLaws])];

    const lg: RiskGrade = (item as any).default_likelihood_grade || '중';
    const sg: RiskGrade = (item as any).default_severity_grade || '중';
    const rg = calculateRiskGrade(lg, sg);
    // Improved: drop likelihood by one level
    const improvedLg: RiskGrade = lg === '상' ? '중' : lg === '중' ? '하' : '하';
    const improvedRg = calculateRiskGrade(improvedLg, sg);

    return {
      process: correctTerms(processName),
      sub_task: correctedItem.sub_task,
      hazard: correctedItem.hazard,
      hazard_situation: correctedItem.hazard_situation,
      existing_measure: correctedItem.existing_measure || '',
      improvement_measure: correctedItem.improvement_measure || '',
      likelihood_grade: lg,
      severity_grade: sg,
      risk_grade: rg,
      improved_likelihood_grade: improvedLg,
      improved_severity_grade: sg,
      improved_risk_grade: improvedRg,
      frequency: item.default_frequency || 3,
      severity: item.default_severity || 3,
      improved_frequency: Math.max(1, (item.default_frequency || 3) - 1),
      improved_severity: item.default_severity || 3,
      ppe: item.recommended_ppe || [],
      legal_basis: allLegal,
      department: '',
      assignee: '',
      status: '초안',
      tags: item.tags || [],
    };
  });
}

export async function generateFromSchedule(
  processes: { processName: string; subTask?: string }[],
  targetTotal: number = 100
): Promise<GeneratedRiskItem[]> {
  const perProcess = Math.max(5, Math.ceil(targetTotal / processes.length));
  const allItems: GeneratedRiskItem[] = [];

  for (const p of processes) {
    const items = await generateRiskItems({
      processName: p.processName,
      targetCount: perProcess,
      deduplicate: true,
    });
    allItems.push(...items);
  }

  const seen = new Set<string>();
  return allItems.filter(item => {
    const key = `${item.sub_task}|${item.hazard}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, targetTotal);
}
