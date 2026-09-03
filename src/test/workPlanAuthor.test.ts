import { describe, expect, it } from 'vitest';
import {
  canAssistWorkPlanWrite,
  defaultAuthorUserId,
  hasWorkPlanLegalAuthor,
  isSiteSupervisorRole,
  prefillOverviewSupervisor,
  workPlanAuthorDisplayMessage,
  workPlanAuthorCompanyIds,
  filterMembersByCompanyIds,
} from '@/lib/workPlanAuthor';
import {
  preferredSubmitterUserId,
  seedSubmitterStep,
} from '@/lib/approvalSubmitterSeed';
import {
  WORK_PLAN_APPROVAL_STEPS,
  WORK_PLAN_POSITION_OPTIONS,
  buildDefaultStepsForAuthor,
  usesAuthorComposedApproval,
  validateWorkPlanApprovalSteps,
} from '@/lib/approvalRules';

describe('workPlanAuthor', () => {
  it('uses the same legal-author rule as risk assessment', () => {
    expect(isSiteSupervisorRole('site_supervisor')).toBe(true);
    expect(isSiteSupervisorRole('safety_manager')).toBe(false);
    expect(canAssistWorkPlanWrite('safety_manager')).toBe(true);
    expect(defaultAuthorUserId({ userId: 'sm-1', role: 'safety_manager' })).toBe('');
    expect(defaultAuthorUserId({ userId: 'sup-1', role: 'site_supervisor' })).toBe('sup-1');
  });

  it('requires an author only so the name can print — does not lock who writes', () => {
    expect(hasWorkPlanLegalAuthor(null)).toBe(false);
    expect(workPlanAuthorDisplayMessage(null)).toMatch(/인쇄·PDF/);
    expect(workPlanAuthorDisplayMessage('sup-1')).toBeNull();
    expect(canAssistWorkPlanWrite('safety_manager')).toBe(true);
  });

  it('prefills empty overview supervisor without overwriting', () => {
    const empty = [{ key: 'overview', content: JSON.stringify({ work_name: '양중', supervisor: '' }) }];
    const filled = prefillOverviewSupervisor(empty, '김감독');
    expect(JSON.parse(filled[0].content).supervisor).toBe('김감독');
    const kept = prefillOverviewSupervisor(
      [{ key: 'overview', content: JSON.stringify({ supervisor: '박기사' }) }],
      '김감독',
    );
    expect(JSON.parse(kept[0].content).supervisor).toBe('박기사');
  });

  it('lists supervisors for the document/own company only — not the GC tree', () => {
    expect(workPlanAuthorCompanyIds({
      userCompanyId: 'gc-1',
      selectedCompanyId: 'sub-9',
    })).toEqual(['gc-1']);
    expect(workPlanAuthorCompanyIds({
      documentCompanyId: 'co-1',
      userCompanyId: 'gc-1',
    })).toEqual(['co-1']);
    expect(filterMembersByCompanyIds(
      [
        { user_id: 'a', company_id: 'gc-1' },
        { user_id: 'b', company_id: 'sub-9' },
      ],
      ['gc-1'],
    ).map((r) => r.user_id)).toEqual(['a']);
  });

  it('does not copy a missing or blank name', () => {
    const sections = [{ key: 'overview', content: '' }];
    expect(prefillOverviewSupervisor(sections, '  ')).toBe(sections);
  });
});

describe('approval submitter seed', () => {
  it('prefers the legal author over the logged-in assistant', () => {
    expect(preferredSubmitterUserId({
      authorUserId: 'sup-1',
      loggedInUserId: 'sm-1',
    })).toBe('sup-1');
    expect(preferredSubmitterUserId({
      authorUserId: null,
      loggedInUserId: 'sm-1',
    })).toBe('sm-1');
  });

  it('seeds an empty contractor_supervisor step with the author', () => {
    const steps = seedSubmitterStep(
      [
        { position: 'contractor_supervisor', user_id: '', user_name: '', company_id: null, company_name: '' },
        { position: 'owner_cm', user_id: 'cm-1', user_name: 'CM', company_id: 'c2', company_name: '발주처' },
      ],
      [{
        out_user_id: 'sup-1',
        out_display_name: '김감독',
        out_company_id: 'c1',
        out_company_name: '협력사',
      }],
      'sup-1',
    );
    expect(steps[0].user_id).toBe('sup-1');
    expect(steps[0].user_name).toBe('김감독');
    expect(steps[1].user_id).toBe('cm-1');
  });

  it('does not overwrite a step that already has an assignee', () => {
    const steps = seedSubmitterStep(
      [{ position: 'contractor_supervisor', user_id: 'other', user_name: '기존' }],
      [{ out_user_id: 'sup-1', out_display_name: '김감독', out_company_id: null, out_company_name: '' }],
      'sup-1',
    );
    expect(steps[0].user_id).toBe('other');
  });
});

describe('work plan approval line is author-composed', () => {
  it('starts with only the author step — CM and SM are optional add-ons', () => {
    expect(usesAuthorComposedApproval('work_plan')).toBe(true);
    expect(WORK_PLAN_APPROVAL_STEPS).toEqual([
      { label: '작성자', position: 'contractor_supervisor' },
    ]);
    const defaults = buildDefaultStepsForAuthor('work_plan', 'contractor');
    expect(defaults.map((s) => s.position)).toEqual(['contractor_supervisor']);
    expect(WORK_PLAN_POSITION_OPTIONS.map((o) => o.value)).toContain('owner_cm');
    expect(WORK_PLAN_POSITION_OPTIONS.map((o) => o.value)).toContain('owner_sm');
  });

  it('accepts any mix after the author — including CM without SM and SM without CM', () => {
    const author = { position: 'contractor_supervisor', label: '작성자' };
    const cm = { position: 'owner_cm', label: '발주처 CM' };
    const sm = { position: 'owner_sm', label: '발주처 SM' };
    const extraCm = { position: 'owner_cm', label: '발주처 CM2' };
    expect(validateWorkPlanApprovalSteps([author]).ok).toBe(true);
    expect(validateWorkPlanApprovalSteps([author, cm]).ok).toBe(true);
    expect(validateWorkPlanApprovalSteps([author, sm]).ok).toBe(true);
    expect(validateWorkPlanApprovalSteps([author, cm, extraCm, sm]).ok).toBe(true);
    expect(validateWorkPlanApprovalSteps([cm, sm]).ok).toBe(false);
  });
});
