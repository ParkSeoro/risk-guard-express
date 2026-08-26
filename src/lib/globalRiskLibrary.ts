/**
 * System-wide global risk library (not company/project scoped).
 * Lookup is indexed by process_key and limited — must stay fast.
 */
import { supabase } from '@/integrations/supabase/client';
import type { GeneratedRiskItem } from '@/lib/riskAutoGen';
import { calculateRiskGrade, deriveResidualGrades, isFlattenedResidualPlaceholder, type RiskGrade } from '@/lib/riskGrade';

export function normalizeProcessKey(raw: string): string {
  return (raw || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normKey(s: string): string {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export type GlobalLibraryFetchOpts = {
  processName: string;
  equipmentTags?: string[];
  conditionTags?: string[];
  /** hard cap — keep small for latency */
  limit?: number;
};

function scoreRow(
  row: any,
  equipment: string[],
  conditions: string[],
): number {
  let score = 10 + (Number(row.use_count) || 0) + (Number(row.quality_score) || 0) / 10;
  const eq = (row.equipment_keys || []) as string[];
  const cond = (row.condition_keys || []) as string[];
  for (const e of equipment) {
    const k = normKey(e);
    if (!k) continue;
    if (eq.some((x) => normKey(x).includes(k) || k.includes(normKey(x)))) score += 12;
  }
  for (const c of conditions) {
    const k = normKey(c);
    if (!k) continue;
    if (cond.some((x) => normKey(x).includes(k) || k.includes(normKey(x)))) score += 8;
  }
  // Prefer common (no equipment filter) rows slightly when no equipment selected
  if (equipment.length === 0 && eq.length === 0) score += 4;
  if ((row.risk_grade || '') === '상') score += 3;
  return score;
}

export function mapGlobalLibraryRow(row: any): GeneratedRiskItem & {
  hazard_type?: string;
  work_phase?: string;
} {
  const lg = (row.likelihood_grade || '중') as RiskGrade;
  const sg = (row.severity_grade || '중') as RiskGrade;
  const derived = deriveResidualGrades(lg, sg);
  const flattened = isFlattenedResidualPlaceholder({
    likelihood_grade: lg,
    severity_grade: sg,
    risk_grade: row.risk_grade,
    improved_likelihood_grade: row.improved_likelihood_grade,
    improved_severity_grade: row.improved_severity_grade,
    improved_risk_grade: row.improved_risk_grade,
  });
  const ilg = flattened ? derived.likelihood : ((row.improved_likelihood_grade || derived.likelihood) as RiskGrade);
  const isg = flattened ? derived.severity : ((row.improved_severity_grade || derived.severity) as RiskGrade);
  return {
    process: row.process_label || row.process_key || '',
    sub_task: row.sub_task || '',
    hazard: row.hazard || '',
    hazard_situation: row.hazard_situation || '',
    existing_measure: row.existing_measure || '',
    improvement_measure: row.improvement_measure || '',
    frequency: row.frequency ?? 2,
    severity: row.severity ?? 2,
    improved_frequency: row.improved_frequency ?? 1,
    improved_severity: row.improved_severity ?? 1,
    likelihood_grade: lg,
    severity_grade: sg,
    risk_grade: (row.risk_grade as RiskGrade) || calculateRiskGrade(lg, sg),
    improved_likelihood_grade: ilg,
    improved_severity_grade: isg,
    improved_risk_grade: flattened
      ? derived.risk
      : ((row.improved_risk_grade as RiskGrade) || calculateRiskGrade(ilg, isg)),
    ppe: Array.isArray(row.ppe) ? row.ppe : [],
    legal_basis: Array.isArray(row.legal_basis) ? row.legal_basis : [],
    department: '',
    assignee: '',
    status: '초안',
    tags: Array.isArray(row.condition_keys) ? row.condition_keys : [],
    hazard_type: row.hazard_type || undefined,
    work_phase: row.work_phase || undefined,
  };
}

/**
 * Fast process-keyed fetch. Never loads the whole library.
 */
export async function fetchGlobalRiskLibraryItems(
  opts: GlobalLibraryFetchOpts,
): Promise<(GeneratedRiskItem & { hazard_type?: string; work_phase?: string })[]> {
  const processName = (opts.processName || '').trim();
  if (!processName) return [];
  const key = normalizeProcessKey(processName);
  const limit = Math.min(Math.max(opts.limit ?? 48, 8), 80);
  const equipment = (opts.equipmentTags || []).map((x) => x.trim()).filter(Boolean);
  const conditions = (opts.conditionTags || []).map((x) => x.trim()).filter(Boolean);

  // Indexed equality on process_key; fallback ilike prefix only if exact miss.
  let { data, error } = await supabase
    .from('global_risk_library' as any)
    .select('*')
    .eq('is_active', true)
    .eq('process_key', key)
    .order('use_count', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[globalRiskLibrary] fetch failed:', error.message);
    return [];
  }

  if (!data?.length) {
    const fuzzy = await supabase
      .from('global_risk_library' as any)
      .select('*')
      .eq('is_active', true)
      .ilike('process_key', `%${key.slice(0, Math.min(key.length, 24))}%`)
      .order('use_count', { ascending: false })
      .limit(limit);
    if (fuzzy.error) return [];
    data = fuzzy.data || [];
  }

  const scored = (data as any[])
    .map((row) => ({ row, score: scoreRow(row, equipment, conditions) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => mapGlobalLibraryRow(x.row));

  return scored;
}

export async function ingestApprovedRunsToLibrary(limit = 30): Promise<{ runs: number; upserted: number }> {
  const { data, error } = await supabase.rpc('ingest_approved_runs_to_global_library' as any, {
    _limit: limit,
  });
  if (error) throw error;
  const d = data as any;
  return { runs: Number(d?.runs || 0), upserted: Number(d?.upserted || 0) };
}

export async function createLibraryImportDraft(input: {
  sourceKind: 'excel' | 'pdf';
  fileName?: string;
  rows: Record<string, unknown>[];
  notes?: string;
}): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('global_risk_library_imports' as any)
    .insert({
      status: 'draft',
      source_kind: input.sourceKind,
      file_name: input.fileName || null,
      row_count: input.rows.length,
      payload: input.rows,
      notes: input.notes || null,
      created_by: userData.user?.id || null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as any).id as string;
}

export async function publishLibraryImport(importId: string): Promise<{ upserted: number }> {
  const { data, error } = await supabase.rpc('publish_global_risk_library_import' as any, {
    _import_id: importId,
  });
  if (error) throw error;
  return { upserted: Number((data as any)?.upserted || 0) };
}

/** Infer hazard_type from Korean hazard text (shared taxonomy). */
export function inferHazardType(hazard: string): string {
  const h = hazard || '';
  if (/추락|고소|비계|안전대/.test(h)) return '추락';
  if (/낙하|비래/.test(h)) return '낙하·비래';
  if (/협착|끼임|크러시/.test(h)) return '협착·끼임';
  if (/충돌|부딪|선회/.test(h)) return '충돌';
  if (/전도|도괴/.test(h)) return '전도·도괴';
  if (/감전|전기|활선/.test(h)) return '감전';
  if (/화재|폭발|인화|용접/.test(h)) return '화재·폭발';
  if (/질식|산소|밀폐/.test(h)) return '질식';
  if (/중독|화학|유기용제|분진/.test(h)) return '화학·중독';
  if (/붕괴|매몰|굴착면/.test(h)) return '붕괴·매몰';
  if (/절단|베임|찔림/.test(h)) return '절단·베임';
  if (/근골격|중량물|들기/.test(h)) return '근골격';
  return '기타';
}

export function inferWorkPhase(subTask: string): string {
  const s = subTask || '';
  if (/준비|반입|조립|설치 전|점검|이동|양중 준비/.test(s)) return '준비';
  if (/해체|철수|정리|복구|종료|마감/.test(s)) return '마무리';
  if (/비상|이상|긴급|대피/.test(s)) return '이상시';
  return '본작업';
}
