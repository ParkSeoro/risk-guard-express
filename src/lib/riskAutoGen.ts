import { supabase } from '@/integrations/supabase/client';

export interface GeneratedRiskItem {
  process: string;
  sub_task: string;
  hazard: string;
  hazard_situation: string;
  existing_measure: string;
  improvement_measure: string;
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

  // Direct keyword match
  const keywords: string[] = item.keywords || [];
  const synonyms: string[] = item.synonyms || [];
  const allTerms = [...keywords, ...synonyms, item.category_large, item.category_medium, item.category_small, item.sub_task].map(s => (s || '').toLowerCase());

  for (const term of allTerms) {
    if (!term) continue;
    if (pLower.includes(term) || term.includes(pLower)) score += 10;
    // Partial word match
    const words = pLower.split(/[\s/,]+/);
    for (const w of words) {
      if (w.length >= 2 && term.includes(w)) score += 5;
    }
  }

  // Tag matching
  const itemTags: string[] = item.tags || [];
  for (const t of tags) {
    if (itemTags.some((it: string) => it.includes(t) || t.includes(it))) score += 8;
  }

  // Higher risk items get slight priority
  const risk = (item.default_frequency || 3) * (item.default_severity || 3);
  if (risk >= 16) score += 3;
  else if (risk >= 9) score += 1;

  return score;
}

export async function generateRiskItems(options: GenerateOptions): Promise<GeneratedRiskItem[]> {
  const { processName, tags = [], targetCount = 50, deduplicate = true } = options;

  // 1. Fetch all active library items
  const { data: library } = await supabase
    .from('standard_risk_library')
    .select('*')
    .eq('is_active', true);

  if (!library || library.length === 0) return [];

  // 2. Score and sort by relevance
  const scored = library.map(item => ({
    item,
    score: scoreMatch(item, processName, tags),
  })).filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // Fallback: use category_large matching
    const fallback = library.filter(item => {
      const pLower = processName.toLowerCase();
      return (item.category_large || '').toLowerCase().includes(pLower) ||
        pLower.includes((item.category_large || '').toLowerCase());
    });
    if (fallback.length === 0) return [];
    scored.push(...fallback.map(item => ({ item, score: 1 })));
  }

  // 3. Take up to targetCount items
  let selected = scored.slice(0, targetCount);

  // If not enough, pad with related category items
  if (selected.length < targetCount) {
    const usedCategories = new Set(selected.map(s => s.item.category_large));
    const additional = library
      .filter(item => usedCategories.has(item.category_large) && !selected.some(s => s.item.id === item.id))
      .map(item => ({ item, score: 1 }));
    selected = [...selected, ...additional].slice(0, targetCount);
  }

  // 4. Deduplicate by sub_task + hazard combination
  if (deduplicate) {
    const seen = new Set<string>();
    selected = selected.filter(s => {
      const key = `${s.item.sub_task}|${s.item.hazard}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // 5. Fetch legal references for auto-mapping
  const { data: legalRefs } = await supabase
    .from('legal_references')
    .select('*');

  // 6. Map to output format
  return selected.map(({ item }) => {
    // Merge library legal_refs with DB legal references
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

    return {
      process: processName,
      sub_task: item.sub_task,
      hazard: item.hazard,
      hazard_situation: item.hazard_situation,
      existing_measure: item.existing_measure || '',
      improvement_measure: item.improvement_measure || '',
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

// Generate from multiple process names (schedule upload)
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

  // Global dedup
  const seen = new Set<string>();
  return allItems.filter(item => {
    const key = `${item.sub_task}|${item.hazard}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, targetTotal);
}
