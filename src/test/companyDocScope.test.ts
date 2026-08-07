import { describe, it, expect } from 'vitest';
import {
  companyDocScopeMode,
  mustScopeToOwnCompany,
  applyOwnCompanyFilter,
  collectDescendants,
  filterRunsByCompanyScope,
  resolveAssessmentRunCompanyLabels,
  formatCompanyLabelsShort,
} from '@/lib/companyDocScope';

describe('companyDocScopeMode', () => {
  it('scopes GC including PA to tree (not all)', () => {
    expect(companyDocScopeMode({ role: 'project_admin', companyType: 'gc' })).toBe('tree');
    expect(companyDocScopeMode({ role: 'site_manager', companyType: '시공사' })).toBe('tree');
    expect(companyDocScopeMode({ role: 'worker', companyType: 'gc' })).toBe('own');
  });

  it('keeps client PA as all', () => {
    expect(companyDocScopeMode({ role: 'project_admin', companyType: 'client' })).toBe('all');
    expect(companyDocScopeMode({ role: 'master', isMaster: true })).toBe('all');
  });

  it('scopes contractor/vendor to own', () => {
    expect(companyDocScopeMode({ role: 'site_manager', companyType: 'contractor' })).toBe('own');
    expect(companyDocScopeMode({ role: 'project_admin', companyType: 'vendor' })).toBe('own');
  });
});

describe('mustScopeToOwnCompany', () => {
  it('true for GC (needs filter)', () => {
    expect(mustScopeToOwnCompany({ role: 'project_admin', companyType: 'gc' })).toBe(true);
  });
  it('false for client PA', () => {
    expect(mustScopeToOwnCompany({ role: 'project_admin', companyType: 'client' })).toBe(false);
  });
});

describe('collectDescendants', () => {
  it('includes root and children', () => {
    const ids = collectDescendants(
      [
        { id: 'gc-a', parent_id: null },
        { id: 'gc-b', parent_id: null },
        { id: 'c1', parent_id: 'gc-a' },
        { id: 'c2', parent_id: 'c1' },
        { id: 'c3', parent_id: 'gc-b' },
      ],
      'gc-a',
    );
    expect(ids.sort()).toEqual(['c1', 'c2', 'gc-a'].sort());
    expect(ids).not.toContain('gc-b');
    expect(ids).not.toContain('c3');
  });
});

describe('applyOwnCompanyFilter', () => {
  it('uses in() for tree with accessible ids', () => {
    const calls: any[] = [];
    const q = {
      eq: (k: string, v: string) => {
        calls.push(['eq', k, v]);
        return q;
      },
      in: (k: string, v: string[]) => {
        calls.push(['in', k, v]);
        return q;
      },
    };
    applyOwnCompanyFilter(q, {
      role: 'project_admin',
      companyType: 'gc',
      companyId: 'gc-a',
      accessibleCompanyIds: ['gc-a', 'c1'],
    });
    expect(calls[0][0]).toBe('in');
    expect(calls[0][2]).toEqual(['gc-a', 'c1']);
  });
});

describe('filterRunsByCompanyScope', () => {
  it('keeps runs targeting accessible companies', () => {
    const rows = [
      { id: '1', created_by: 'u1', target_company_ids: ['gc-b'] },
      { id: '2', created_by: 'u2', target_company_ids: ['gc-a', 'c1'] },
      { id: '3', created_by: 'me', target_company_ids: null },
    ];
    const out = filterRunsByCompanyScope(rows as any, {
      userId: 'me',
      accessibleCompanyIds: ['gc-a', 'c1'],
    });
    expect(out.map((r: any) => r.id).sort()).toEqual(['2', '3']);
  });
});

describe('resolveAssessmentRunCompanyLabels', () => {
  it('resolves ids via name map', () => {
    expect(resolveAssessmentRunCompanyLabels(
      { target_company_ids: ['c1', 'c2'] },
      { c1: '가협력', c2: '나협력' },
    )).toEqual(['가협력', '나협력']);
  });

  it('falls back to legacy contractor names', () => {
    expect(resolveAssessmentRunCompanyLabels(
      { target_company_ids: [], target_contractors: ['옛업체'] },
      {},
    )).toEqual(['옛업체']);
  });

  it('shortens long company lists', () => {
    expect(formatCompanyLabelsShort(['A', 'B', 'C', 'D'], 2)).toBe('A, B 외 2');
  });
});
