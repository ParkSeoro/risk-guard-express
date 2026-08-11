import { supabase } from '@/integrations/supabase/client';

/** Match common KR OSH citations embedded in narrative or legal_basis strings. */
export const LEGAL_CITATION_RE =
  /[\[(]?산업안전보건기준에\s*관한\s*규칙\s*제\s*\d+\s*조(?:\s*의\s*\d+)?[\])]?|[\[(]?산안기준규칙\s*제\s*\d+\s*조(?:\s*의\s*\d+)?[\])]?|[\[(]?KOSHA\s*GUIDE[^\])\n,]{0,60}[\])]?/gi;

function stripCiteWrappers(s: string): string {
  return s.replace(/^[\[(]+/, '').replace(/[\])]+$/, '').replace(/\s+/g, ' ').trim();
}

export function harvestLegalCitations(texts: Array<string | null | undefined>): string[] {
  const blob = texts.map((t) => String(t || '')).join('\n');
  if (!blob.trim()) return [];
  const found = blob.match(LEGAL_CITATION_RE);
  if (!found?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of found) {
    const key = stripCiteWrappers(f);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Normalize AI legal_basis which may be string | string[] | Korean key,
 * and harvest citations from narrative when the array is empty.
 */
export function normalizeLegalBasisList(
  raw: unknown,
  harvestFrom: Array<string | null | undefined> = [],
): string[] {
  let out: string[] = [];
  if (Array.isArray(raw)) {
    out = raw.map(String).map((s) => s.trim()).filter(Boolean);
  } else if (typeof raw === 'string' && raw.trim()) {
    out = raw
      .split(/[,，;；\n|/]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (out.length === 0) {
    out = harvestLegalCitations(harvestFrom);
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of out) {
    const key = stripCiteWrappers(s) || s.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(key);
  }
  return deduped;
}

/**
 * Merge LLM legal_basis with library matches from legal_references.
 * Prefer concrete article strings; keep unique order (LLM first, then library).
 */
export async function enrichLegalBasis(opts: {
  processName: string;
  hazard?: string;
  hazardSituation?: string;
  existingMeasure?: string;
  improvementMeasure?: string;
  existing?: string[] | null;
  limit?: number;
}): Promise<string[]> {
  const existing = normalizeLegalBasisList(opts.existing || [], [
    opts.hazardSituation,
    opts.existingMeasure,
    opts.improvementMeasure,
    opts.hazard,
  ]);
  const limit = opts.limit ?? 6;
  const text = `${opts.processName} ${opts.hazard || ''} ${opts.hazardSituation || ''}`.toLowerCase();

  const { data: legalRefs } = await supabase.from('legal_references').select('*').limit(200);
  const matched = ((legalRefs as any[]) || [])
    .filter((law) => {
      const mappings: string[] = law.process_mappings || [];
      const keywords: string[] = law.keywords || [];
      const byProcess = mappings.some(
        (pm) => pm === '전체' || pm === opts.processName || opts.processName.includes(pm) || pm.includes(opts.processName),
      );
      const byKeyword = keywords.some((kw) => {
        const k = String(kw || '').toLowerCase();
        return k && text.includes(k);
      });
      return byProcess || byKeyword;
    })
    .map((law) => `${law.law_name} ${law.article}`.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...existing, ...matched]) {
    const key = s.replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}
