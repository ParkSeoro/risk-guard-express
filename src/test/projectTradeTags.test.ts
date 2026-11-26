import { describe, it, expect } from 'vitest';
import {
  collectSuggestedTagsFromCompanies,
  mapLegacyProjectTab,
  normalizeTradeTags,
  STANDARD_TRADE_TAGS,
} from '@/lib/projectTradeTags';

describe('projectTradeTags', () => {
  it('maps legacy project detail tabs safely to renewed 4-tab structure', () => {
    expect(mapLegacyProjectTab('basic-info')).toBe('basic-info');
    expect(mapLegacyProjectTab('companies')).toBe('companies');
    expect(mapLegacyProjectTab('members')).toBe('members');
    expect(mapLegacyProjectTab('integrations')).toBe('integrations');
    // Legacy redirects
    expect(mapLegacyProjectTab('approval-routes')).toBe('integrations');
    expect(mapLegacyProjectTab('invites')).toBe('members');
    expect(mapLegacyProjectTab('tags')).toBe('basic-info');
    expect(mapLegacyProjectTab(null)).toBe('basic-info');
    expect(mapLegacyProjectTab('unknown-tab', 'companies')).toBe('companies');
  });

  it('normalizes and deduplicates trade tags case-insensitively', () => {
    expect(normalizeTradeTags(['배관', ' 철골 ', '배관', ''])).toEqual(['배관', '철골']);
    expect(normalizeTradeTags('Tank, tank, 배관,  ')).toEqual(['Tank', '배관']);
    expect(normalizeTradeTags(null)).toEqual([]);
  });

  it('extracts unique trade tag suggestions from company construction_type', () => {
    const companies = [
      { construction_type: '배관, 기계설치' },
      { construction_type: '철골 / 보온' },
      { construction_type: null },
    ];
    const suggestions = collectSuggestedTagsFromCompanies(companies, ['배관']);
    expect(suggestions).toEqual(['기계설치', '철골', '보온']);
    expect(STANDARD_TRADE_TAGS.length).toBeGreaterThanOrEqual(10);
  });
});
