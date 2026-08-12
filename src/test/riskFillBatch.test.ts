import { describe, it, expect } from 'vitest';
import { RISK_FILL_CHUNK, AI_SCOPE_DRAFT_NOTE, isAiScopeDraftItem } from '@/lib/riskAutoGenAI';

describe('risk fill batch constants', () => {
  it('keeps a modest chunk size for one Edge call', () => {
    expect(RISK_FILL_CHUNK).toBeGreaterThanOrEqual(3);
    expect(RISK_FILL_CHUNK).toBeLessThanOrEqual(8);
  });

  it('still tags scope drafts', () => {
    expect(isAiScopeDraftItem({ note: AI_SCOPE_DRAFT_NOTE })).toBe(true);
  });
});
