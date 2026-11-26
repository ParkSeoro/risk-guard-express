import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { companyDocScopeMode } from '@/lib/companyDocScope';
import { resolveProjectCompanyType } from '@/lib/companyTypes';

describe('Cross-project company role & hierarchy isolation', () => {
  it('resolves the same company as GC (tree) in Project A and contractor (own) in Project B', () => {
    const globalCompanyType = 'gc';

    // Project A: role_in_project = 'gc' -> tree scope (own + Project A descendants)
    const typeInProjectA = resolveProjectCompanyType('gc', globalCompanyType);
    expect(typeInProjectA).toBe('gc');
    expect(companyDocScopeMode({ role: 'safety_manager', companyType: typeInProjectA })).toBe('tree');

    // Project B: same company participates as role_in_project = 'contractor' -> own scope only
    const typeInProjectB = resolveProjectCompanyType('contractor', globalCompanyType);
    expect(typeInProjectB).toBe('contractor');
    expect(companyDocScopeMode({ role: 'safety_manager', companyType: typeInProjectB })).toBe('own');
  });

  it('guards useProjectAccess, useMobileAccess, projectCompanies, and companyDocScope against global leaks', () => {
    const projectAccess = readFileSync('src/hooks/useProjectAccess.ts', 'utf8');
    const mobileAccess = readFileSync('src/hooks/useMobileAccess.ts', 'utf8');
    const projectCompanies = readFileSync('src/lib/projectCompanies.ts', 'utf8');
    const docScope = readFileSync('src/lib/companyDocScope.ts', 'utf8');

    expect(projectAccess).toContain('fetchProjectCompanyLinkMeta');
    expect(projectAccess).toContain('resolveProjectCompanyType');
    expect(mobileAccess).toContain('fetchProjectCompanyLinkMeta');
    expect(mobileAccess).toContain('resolveProjectCompanyType');
    expect(projectCompanies).not.toContain('l.parent_company_id ?? c.parent_company_id');
    expect(docScope).not.toContain("// Fallback: companies.parent_company_id");
  });
});
