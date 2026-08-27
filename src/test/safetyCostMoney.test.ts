import { describe, expect, it } from 'vitest';
import {
  analyzeSafetyCostCompliance,
  isSafetyCostReportLocked,
  sumLiveSafetyCostAmounts,
} from '@/lib/safetyCost';
import {
  buildDefaultStepsForAuthor,
  isSubmitterApprovalStep,
  SAFETY_COST_APPROVAL_STEPS,
  validateSafetyCostApprovalSteps,
} from '@/lib/approvalRules';

describe('safetyCost money SSOT', () => {
  it('sums live items only', () => {
    expect(sumLiveSafetyCostAmounts([
      { amount: 100, is_deleted: false },
      { amount: 50, is_deleted: true },
      { amount: 20 },
    ])).toBe(120);
  });

  it('uses approved cumulative + current month for budget rate', () => {
    const r = analyzeSafetyCostCompliance(
      [{ amount: 30, classification_status: 'usable', legal_basis: '법' }],
      100,
      { approvedCumulative: 80 },
    );
    expect(r.total).toBe(30);
    expect(r.cumulative).toBe(110);
    expect(r.rate).toBe(110);
    expect(r.issues.some((i) => i.includes('초과'))).toBe(true);
  });

  it('ignores deleted rows in compliance', () => {
    const r = analyzeSafetyCostCompliance(
      [
        { amount: 40, classification_status: 'warning', legal_basis: '법', is_deleted: true },
        { amount: 10, classification_status: 'usable', legal_basis: '법' },
      ],
      100,
    );
    expect(r.warningCount).toBe(0);
    expect(r.total).toBe(10);
  });

  it('locks submitted and approved reports', () => {
    expect(isSafetyCostReportLocked('draft')).toBe(false);
    expect(isSafetyCostReportLocked('submitted')).toBe(true);
    expect(isSafetyCostReportLocked('approved')).toBe(true);
  });
});

describe('safetyCost approval line', () => {
  it('defaults to 작성자 → 검토자 → 현장소장 → 발주처 SM (no CM)', () => {
    expect(SAFETY_COST_APPROVAL_STEPS.map((s) => s.position)).toEqual([
      'contractor_supervisor',
      'contractor_safety_manager',
      'contractor_site_director',
      'owner_sm',
    ]);
    const steps = buildDefaultStepsForAuthor('safety_cost', 'gc');
    expect(steps.some((s) => s.position === 'owner_cm')).toBe(false);
    expect(steps.some((s) => s.position === 'owner_sm')).toBe(true);
  });

  it('requires author, site director and owner SM; consent is optional', () => {
    const base = [
      { position: 'contractor_supervisor', label: '작성자' },
      { position: 'contractor_safety_manager', label: '검토자' },
      { position: 'consent', label: '합의' },
      { position: 'contractor_site_director', label: '현장소장' },
      { position: 'owner_sm', label: '발주처 SM' },
    ];
    expect(validateSafetyCostApprovalSteps(base).ok).toBe(true);
    expect(validateSafetyCostApprovalSteps(base.filter((s) => s.position !== 'consent')).ok).toBe(true);
    expect(validateSafetyCostApprovalSteps(base.filter((s) => s.position !== 'owner_sm')).ok).toBe(false);
    expect(validateSafetyCostApprovalSteps(base.filter((s) => s.position !== 'contractor_site_director')).ok).toBe(false);
  });

  it('treats 작성자 as the submitter step', () => {
    expect(isSubmitterApprovalStep({ position: 'contractor_supervisor', step: '작성자' })).toBe(true);
  });
});
