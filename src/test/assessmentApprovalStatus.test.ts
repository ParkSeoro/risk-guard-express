import { describe, expect, it } from 'vitest';
import {
  dedupeApprovalSteps,
  isSubmitterApprovalStep,
  sortStepsByHierarchy,
} from '@/lib/approvalRules';

/**
 * Assessment submit must pass the full approval line (incl. 상신),
 * matching SubmitApprovalDialog — not slice(1).
 */
describe('assessment approval submit line', () => {
  it('keeps 상신 as first step after hierarchy sort + dedupe', () => {
    const lines = [
      { label: '협력사 관리감독자 (상신)', position: 'contractor_supervisor', user_id: 'u1' },
      { label: '협력사 안전관리자 (검토)', position: 'contractor_safety_manager', user_id: 'u2' },
      { label: '발주처 SM (승인)', position: 'owner_sm', user_id: 'u3' },
    ];
    const ordered = dedupeApprovalSteps(sortStepsByHierarchy(lines as any));
    expect(ordered[0].position).toBe('contractor_supervisor');
    expect(isSubmitterApprovalStep(ordered[0])).toBe(true);
    expect(ordered.length).toBe(3);
  });

  it('does not drop 상신 when building full line (unlike legacy slice(1))', () => {
    const lines = [
      { label: '상신', position: 'contractor_supervisor', user_id: 'u1' },
      { label: '검토', position: 'contractor_safety_manager', user_id: 'u2' },
    ];
    const full = lines.map((l) => ({ ...l }));
    const legacyApproversOnly = lines.slice(1);
    expect(full.length).toBe(2);
    expect(legacyApproversOnly.length).toBe(1);
    expect(isSubmitterApprovalStep(full[0])).toBe(true);
  });
});
