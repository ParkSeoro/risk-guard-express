import { describe, it, expect } from 'vitest';
import { AI_SCOPE_DRAFT_NOTE, isAiScopeDraftItem, isFillableRiskItem, shouldReplaceRiskField } from '@/lib/riskAutoGenAI';

describe('isAiScopeDraftItem', () => {
  it('detects scope draft note', () => {
    expect(isAiScopeDraftItem({ note: AI_SCOPE_DRAFT_NOTE })).toBe(true);
    expect(isAiScopeDraftItem({ note: `${AI_SCOPE_DRAFT_NOTE} extra` })).toBe(true);
    expect(isAiScopeDraftItem({ note: null })).toBe(false);
    expect(isAiScopeDraftItem({ note: '[AI_PENDING]' })).toBe(false);
  });
});

describe('isFillableRiskItem', () => {
  it('fills library/reuse rows that are missing improvement, PPE, or legal', () => {
    expect(
      isFillableRiskItem({
        source_type: 'library',
        hazard_situation: '후진 중 보행자 충돌',
        existing_measure: '유도자 배치',
        improvement_measure: '',
        ppe: [],
        legal_basis: [],
      }),
    ).toBe(true);
  });

  it('skips complete rows regardless of source', () => {
    expect(
      isFillableRiskItem({
        source_type: 'reuse',
        hazard_situation: '상황',
        existing_measure: '기존',
        improvement_measure: '과속방지 제한속도 준수 및 유도로 확보',
        ppe: ['안전모'],
        legal_basis: ['산업안전보건기준에 관한 규칙 제171조'],
      }),
    ).toBe(false);
  });

  it('does not overwrite-needed pending rows', () => {
    expect(isFillableRiskItem({ hazard: '…생성중', note: '[AI_PENDING]' })).toBe(false);
  });
});

describe('shouldReplaceRiskField', () => {
  it('keeps existing text unless forceAll', () => {
    expect(shouldReplaceRiskField('이미 있는 기존대책', false)).toBe(false);
    expect(shouldReplaceRiskField('', false)).toBe(true);
    expect(shouldReplaceRiskField('이미 있는 기존대책', true)).toBe(true);
    expect(shouldReplaceRiskField([], false)).toBe(true);
    expect(shouldReplaceRiskField(['안전모'], false)).toBe(false);
  });
});
