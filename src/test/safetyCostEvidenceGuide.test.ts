import { describe, expect, it } from 'vitest';
import {
  SAFETY_COST_EVIDENCE_GUIDE,
  evidenceGuideSummary,
  getEvidenceGuide,
} from '@/lib/safetyCostEvidenceGuide';

describe('safetyCostEvidenceGuide', () => {
  it('covers categories 1-9', () => {
    expect(SAFETY_COST_EVIDENCE_GUIDE.map((g) => g.code)).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    );
  });

  it('returns required evidence for a known category', () => {
    const g = getEvidenceGuide('3');
    expect(g?.name).toContain('보호구');
    expect(g?.requiredEvidence.length).toBeGreaterThan(0);
    expect(evidenceGuideSummary('3')).toContain('필요 증빙');
  });

  it('handles empty category', () => {
    expect(getEvidenceGuide(null)).toBeNull();
    expect(evidenceGuideSummary('')).toContain('분류를 선택');
  });
});
