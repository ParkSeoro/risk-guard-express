import { describe, it, expect } from 'vitest';
import { mustScopeToOwnCompany, applyOwnCompanyFilter } from '@/lib/companyDocScope';

describe('mustScopeToOwnCompany', () => {
  it('forces contractor/vendor regardless of role', () => {
    expect(mustScopeToOwnCompany({ role: 'site_manager', companyType: 'contractor' })).toBe(true);
    expect(mustScopeToOwnCompany({ role: 'project_admin', companyType: 'vendor' })).toBe(true);
    expect(mustScopeToOwnCompany({ role: 'supervisor', companyType: '협력사' })).toBe(true);
  });

  it('allows gc/client PA and SM to see all', () => {
    expect(mustScopeToOwnCompany({ role: 'project_admin', companyType: 'gc' })).toBe(false);
    expect(mustScopeToOwnCompany({ role: 'safety_manager', companyType: 'client' })).toBe(false);
    expect(mustScopeToOwnCompany({ role: 'master', companyType: null, isMaster: true })).toBe(false);
  });

  it('scopes workers/viewers', () => {
    expect(mustScopeToOwnCompany({ role: 'worker', companyType: 'gc' })).toBe(true);
    expect(mustScopeToOwnCompany({ role: 'viewer', companyType: 'client' })).toBe(true);
  });

  it('gc site_manager does not force client filter (RLS tree)', () => {
    expect(mustScopeToOwnCompany({ role: 'site_manager', companyType: 'gc' })).toBe(false);
  });
});

describe('applyOwnCompanyFilter', () => {
  it('adds company_id eq for contractors', () => {
    const calls: any[] = [];
    const q = {
      eq: (k: string, v: string) => {
        calls.push([k, v]);
        return q;
      },
    };
    applyOwnCompanyFilter(q, {
      role: 'site_manager',
      companyType: 'contractor',
      companyId: 'co-1',
    });
    expect(calls).toEqual([['company_id', 'co-1']]);
  });

  it('no-ops for gc admin', () => {
    let called = false;
    const q = {
      eq: () => {
        called = true;
        return q;
      },
    };
    const out = applyOwnCompanyFilter(q, {
      role: 'project_admin',
      companyType: 'gc',
      companyId: 'co-1',
    });
    expect(called).toBe(false);
    expect(out).toBe(q);
  });
});
