import { supabase } from '@/integrations/supabase/client';

/**
 * Merge LLM legal_basis with library matches from legal_references.
 * Prefer concrete article strings; keep unique order (LLM first, then library).
 */
export async function enrichLegalBasis(opts: {
  processName: string;
  hazard?: string;
  hazardSituation?: string;
  existing?: string[] | null;
  limit?: number;
}): Promise<string[]> {
  const existing = (opts.existing || []).map(String).map((s) => s.trim()).filter(Boolean);
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
