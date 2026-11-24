import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildEquipmentContextSummary,
  isAiDraftableSection,
  isBatchAiDraftSection,
  isSectionEmptyForAiDraft,
} from '@/lib/workPlanAiDraft';
import { emptyLegalRiskRows } from '@/lib/workPlanLegalRisk';

describe('Work-Plan All-Type AI Draft Helpers', () => {
  it('allows per-section AI drafting across all body sections while keeping overview/equipment out of batch overwrite', () => {
    expect(isAiDraftableSection({ key: 'overview', type: 'text' })).toBe(true);
    expect(isAiDraftableSection({ key: 'loto', type: 'text' })).toBe(true);
    expect(isAiDraftableSection({ key: 'signal', type: 'text' })).toBe(true);
    expect(isAiDraftableSection({ key: 'rigging', type: 'rigging' })).toBe(false);
    expect(isAiDraftableSection({ key: '_checklist', type: 'text' })).toBe(false);
    expect(isAiDraftableSection({ key: '_legal_calc', type: 'calc' })).toBe(false);

    expect(isBatchAiDraftSection({ key: 'overview', type: 'text' })).toBe(false);
    expect(isBatchAiDraftSection({ key: 'equipment', type: 'table' })).toBe(false);
    expect(isBatchAiDraftSection({ key: 'method', type: 'text' })).toBe(true);
    expect(isBatchAiDraftSection({ key: 'loto', type: 'text' })).toBe(true);
  });

  it('accurately detects empty vs user-filled sections so batch AI never overwrites user edits', () => {
    expect(isSectionEmptyForAiDraft({ key: 'loto', content: '' })).toBe(true);
    expect(isSectionEmptyForAiDraft({ key: 'signal', content: JSON.stringify({ signal_person: '', radio_channel: '' }) })).toBe(true);
    expect(isSectionEmptyForAiDraft({ key: 'method', content: JSON.stringify([{ order: 1, description: '', safety_measure: '' }]) })).toBe(true);
    expect(isSectionEmptyForAiDraft({ key: 'risk', content: JSON.stringify(emptyLegalRiskRows()) })).toBe(true);

    // User-filled content must NEVER be considered empty
    expect(isSectionEmptyForAiDraft({ key: 'loto', content: '차단기 잠금 완료' })).toBe(false);
    expect(isSectionEmptyForAiDraft({ key: 'signal', content: JSON.stringify({ signal_person: '홍길동', radio_channel: '' }) })).toBe(false);
    expect(isSectionEmptyForAiDraft({ key: 'method', content: JSON.stringify([{ order: 1, description: '반입', safety_measure: '' }]) })).toBe(false);
  });

  it('builds equipment context summary from equipment section and rigging', () => {
    const sections = [
      {
        key: 'equipment',
        content: JSON.stringify([{ name: '50톤 크레인', model: 'KATO-50', capacity: '50' }]),
      },
    ];
    expect(buildEquipmentContextSummary(sections, { crane_model: '25톤 크레인', crane_capacity: 25 }))
      .toBe('50톤 크레인 [KATO-50] (50t), 25톤 크레인 (25t)');
  });

  it('wires batch AI draft and all-section AI buttons into WorkPlanDetail', () => {
    const src = readFileSync(resolve(__dirname, '../pages/WorkPlanDetail.tsx'), 'utf-8');
    expect(src).toContain('handleAiDraftEmptySections');
    expect(src).toContain('isAiDraftableSection');
    expect(src).toContain('buildEquipmentContextSummary');
  });
});
