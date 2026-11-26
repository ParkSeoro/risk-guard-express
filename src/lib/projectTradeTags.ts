/**
 * Standard construction/plant trade tags & legacy project-detail tab mapping.
 * Pure, unit-testable helpers shared by ProjectDetail and ProjectCreationWizardDialog.
 */

export const STANDARD_TRADE_TAGS: readonly string[] = [
  '배관',
  '철골',
  '탱크',
  '토목/굴착',
  '전기/계장',
  '비계/고소',
  '보온/도장',
  '중장비/양중',
  '기계설치',
  '건축',
  '화기/용접',
  '밀폐공간',
] as const;

export type ProjectDetailTabId = 'basic-info' | 'companies' | 'members' | 'integrations';

export const PROJECT_DETAIL_TABS: readonly ProjectDetailTabId[] = [
  'basic-info',
  'companies',
  'members',
  'integrations',
] as const;

/**
 * Maps legacy deep-link ?tab= params safely into the renewed 4-tab structure
 * so existing bookmarks/notifications never break.
 */
export function mapLegacyProjectTab(
  rawTab: string | null | undefined,
  fallback: ProjectDetailTabId = 'basic-info',
): ProjectDetailTabId {
  const t = String(rawTab || '').trim();
  if ((PROJECT_DETAIL_TABS as readonly string[]).includes(t)) {
    return t as ProjectDetailTabId;
  }
  if (t === 'approval-routes') return 'integrations';
  if (t === 'invites') return 'members';
  if (t === 'tags') return 'basic-info';
  return fallback;
}

/** Deduplicates and trims a list of trade tags preserving order. */
export function normalizeTradeTags(raw: string[] | string | null | undefined): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    const clean = String(item || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/**
 * Extracts trade-tag suggestions from participating companies' construction_type
 * (company_construction_info) that are not already selected on the project.
 */
export function collectSuggestedTagsFromCompanies(
  companies: Array<{ construction_type?: string | null }>,
  currentTags: string[],
): string[] {
  const existing = new Set(currentTags.map((t) => t.trim().toLowerCase()));
  const suggestions: string[] = [];
  const seen = new Set<string>();
  for (const c of companies) {
    const raw = String(c?.construction_type || '').trim();
    if (!raw) continue;
    for (const part of raw.split(/[,/·]/)) {
      const clean = part.trim();
      if (!clean || clean.length > 24) continue;
      const key = clean.toLowerCase();
      if (existing.has(key) || seen.has(key)) continue;
      seen.add(key);
      suggestions.push(clean);
    }
  }
  return suggestions;
}
