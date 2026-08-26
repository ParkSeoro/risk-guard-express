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
  /** Edge fill stage — narrative must not overwrite grades when applied. */
  fill_stage?: 'narrative' | 'meta' | 'all' | 'derive';
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

  // --- Risk grade distribution enforcement ---
  // High-risk keywords: items matching these get '상'
  const HIGH_RISK_KEYWORDS = ['추락', '감전', '질식', '밀폐', '화기', '폭발', '붕괴', '낙하', '고소', '화재', '중독', '협착', '끼임'];
  const LOW_RISK_KEYWORDS = ['정리정돈', '청소', '보관', '표지', '안내', '기록', '점검표', '보고'];

  const totalCount = selected.length;
  const maxHigh = Math.ceil(totalCount * 0.30); // max 30% high
  const minMed = Math.ceil(totalCount * 0.40);  // min 40% medium
  let highCount = 0;
  let consecutiveHighInProcess: Record<string, number> = {};

  const result = selected.map(({ item }) => {
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

    // Determine risk grade with distribution control
    let lg: RiskGrade = (item as any).default_likelihood_grade || '중';
    let sg: RiskGrade = (item as any).default_severity_grade || '중';
    let rg = calculateRiskGrade(lg, sg);

    const itemText = `${item.sub_task || ''} ${item.hazard || ''} ${item.hazard_situation || ''}`.toLowerCase();
    const isHighRiskContent = HIGH_RISK_KEYWORDS.some(kw => itemText.includes(kw));
    const isLowRiskContent = LOW_RISK_KEYWORDS.some(kw => itemText.includes(kw));

    // Force distribution: cap high-risk items
    if (rg === '상') {
      const procKey = correctedItem.sub_task || processName;
      consecutiveHighInProcess[procKey] = (consecutiveHighInProcess[procKey] || 0) + 1;

      // If exceeding max high count, or 2+ consecutive highs in same process, downgrade
      if (!isHighRiskContent || highCount >= maxHigh || consecutiveHighInProcess[procKey] > 2) {
        lg = '중';
        rg = calculateRiskGrade(lg, sg);
        consecutiveHighInProcess[procKey] = 0;
      } else {
        highCount++;
      }
    }

    // Boost low-risk content items to '하'
    if (isLowRiskContent && rg !== '하') {
      lg = '하';
      sg = '중';
      rg = calculateRiskGrade(lg, sg);
    }

    // Improved: drop likelihood by one level
    const improvedLg: RiskGrade = lg === '상' ? '중' : lg === '중' ? '하' : '하';
    const improvedSg: RiskGrade = sg;
    const improvedRg = calculateRiskGrade(improvedLg, improvedSg);

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
      improved_severity_grade: improvedSg,
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

  return result;
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
