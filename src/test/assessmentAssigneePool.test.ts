import { describe, expect, it } from 'vitest';
import {
  buildAssessmentAssigneeOptions,
  formatAssigneeLabel,
  isProjectManagerRole,
  resolveAuthorCompanyIds,
} from '@/lib/assessmentAssigneePool';

describe('assessmentAssigneePool', () => {
  it('resolves author company from created_by membership', () => {
    expect(resolveAuthorCompanyIds({
      createdBy: 'u1',
      creatorMembers: [{ user_id: 'u1', company_id: 'co-cheong' }],
      targetCompanyIds: ['co-other'],
      fallbackCompanyId: 'co-viewer',
    })).toEqual(['co-cheong']);
  });

  it('falls back to target_company_ids then viewer company', () => {
    expect(resolveAuthorCompanyIds({
      createdBy: 'u1',
      creatorMembers: [{ user_id: 'u1', company_id: null }],
      targetCompanyIds: ['co-a'],
    })).toEqual(['co-a']);
    expect(resolveAuthorCompanyIds({
      createdBy: null,
      creatorMembers: [],
      fallbackCompanyId: 'co-viewer',
    })).toEqual(['co-viewer']);
  });

  it('treats admin project roles as managers and workers as not', () => {
    expect(isProjectManagerRole('site_supervisor')).toBe(true);
    expect(isProjectManagerRole('worker')).toBe(false);
  });

  it('drops workers from the pool and keeps org-chart managers without user_id', () => {
    const options = buildAssessmentAssigneeOptions({
      companyIds: ['co-a'],
      poolRows: [
        { source: 'project_member', user_id: 'w1', display_name: '근로자', company_id: 'co-a', role: 'worker' },
        { source: 'project_member', user_id: 'm1', display_name: '현호', company_id: 'co-a', role: 'site_supervisor', position: 'SITE_SUPERVISOR' },
        { source: 'project_member', user_id: 'other', display_name: '타사', company_id: 'co-b', role: 'safety_manager' },
      ],
      companyManagers: [
        { id: 'cm1', name: '조직도이름', user_id: null, department_id: 'd1', company_id: 'co-a', position: 'HSE_MANAGER' },
      ],
      companyNameById: new Map([['co-a', '청원산기']]),
    });
    expect(options.map((o) => o.display_name).sort()).toEqual(['조직도이름', '현호']);
    expect(options.find((o) => o.display_name === '조직도이름')?.key).toBe('mgr:cm1');
  });

  it('formats name with Korean position label', () => {
    expect(formatAssigneeLabel('박현호', 'SITE_SUPERVISOR')).toBe('박현호 / 관리감독자');
  });
});
