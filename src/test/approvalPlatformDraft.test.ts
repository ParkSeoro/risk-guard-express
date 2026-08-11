import { describe, expect, it } from 'vitest';
import { validateDraftSteps } from '@/lib/approvalPlatform/validateDraftSteps';
import { getEntityApprovalPolicy } from '@/lib/approvalPlatform/entityPolicies';
import { buildAssessmentSubmitPreflight } from '@/lib/assessmentSubmitPreflight';

describe('approval platform — entity policies', () => {
  it('assessment_run uses platform draft; work_permit does not', () => {
    expect(getEntityApprovalPolicy('assessment_run').usesPlatformDraft).toBe(true);
    expect(getEntityApprovalPolicy('work_permit').usesPlatformDraft).toBe(false);
  });
});

describe('approval platform — validateDraftSteps', () => {
  const base = [
    {
      label: '담당자(시공)',
      position: 'contractor_supervisor',
      user_id: 'u1',
      user_name: 'A',
      company_id: 'c1',
      company_name: '진남',
    },
    {
      label: '담당자(안전)',
      position: 'contractor_safety_manager',
      user_id: 'u2',
      user_name: 'B',
      company_id: 'c1',
      company_name: '진남',
    },
    {
      label: '책임자(소장)',
      position: 'contractor_site_director',
      user_id: 'u3',
      user_name: 'C',
      company_id: 'c1',
      company_name: '진남',
    },
  ];

  it('rejects assessment_run without owner CM/SM', () => {
    const r = validateDraftSteps('assessment_run', base);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('발주처'))).toBe(true);
  });

  it('accepts assessment_run with SM only (no CM)', () => {
    const withSm = [
      ...base,
      {
        label: '담당자(SM)',
        position: 'owner_sm',
        user_id: 'u4',
        user_name: 'SM',
        company_id: 'c0',
        company_name: '에어리퀴드',
      },
    ];
    const r = validateDraftSteps('assessment_run', withSm);
    expect(r.ready).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('rejects unsaved-style incomplete step', () => {
    const r = validateDraftSteps('assessment_run', [
      ...base,
      {
        label: '담당자(SM)',
        position: 'owner_sm',
        user_id: '',
        user_name: '',
        company_id: null,
        company_name: '',
      },
    ]);
    expect(r.ok).toBe(false);
  });
});

describe('assessment submit preflight — draft gate', () => {
  it('blocks submit when draft not ready even if line count looks ok', () => {
    const r = buildAssessmentSubmitPreflight({
      itemCount: 3,
      opinionRequired: false,
      healthRequired: false,
      opinions: 0,
      healths: 0,
      unreviewedAi: 0,
      unreviewedHealth: 0,
      approvalLineCount: 4,
      approvalDraftReady: false,
      approvalDraftDetail: '미저장',
    });
    expect(r.ready).toBe(false);
    expect(r.items.find((i) => i.id === 'approval')?.ok).toBe(false);
  });

  it('allows when draft ready and document checks pass', () => {
    const r = buildAssessmentSubmitPreflight({
      itemCount: 3,
      opinionRequired: false,
      healthRequired: false,
      opinions: 0,
      healths: 0,
      unreviewedAi: 0,
      unreviewedHealth: 0,
      approvalLineCount: 4,
      approvalDraftReady: true,
    });
    expect(r.ready).toBe(true);
  });
});
