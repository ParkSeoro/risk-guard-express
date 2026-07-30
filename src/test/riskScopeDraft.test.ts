import { describe, it, expect } from 'vitest';
import { AI_SCOPE_DRAFT_NOTE, isAiScopeDraftItem } from '@/lib/riskAutoGenAI';

describe('isAiScopeDraftItem', () => {
  it('detects scope draft note', () => {
    expect(isAiScopeDraftItem({ note: AI_SCOPE_DRAFT_NOTE })).toBe(true);
    expect(isAiScopeDraftItem({ note: `${AI_SCOPE_DRAFT_NOTE} extra` })).toBe(true);
    expect(isAiScopeDraftItem({ note: null })).toBe(false);
    expect(isAiScopeDraftItem({ note: '[AI_PENDING]' })).toBe(false);
  });
});
