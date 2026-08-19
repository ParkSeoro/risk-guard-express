import { describe, it, expect } from 'vitest';
import {
  companyDocScopeMode,
  mustScopeToOwnCompany,
  applyOwnCompanyFilter,
  collectDescendants,
  filterRunsByCompanyScope,
  resolveAssessmentRunCompanyLabels,
  formatCompanyLabelsShort,
  formatCreatorCompanyLabel,
  pickProjectMemberRow,
  preferredCompanyIdsByRunAuthors,
  resolveAssessmentDocumentCompanies,
  resolveAssessmentRunListCompanyLabel,
  seesProjectWideCompanies,
  buildProjectCompanyLabelMap,
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

  it('treats safety_manager differently by company type (발주/시공/협력)', () => {
    expect(companyDocScopeMode({ role: 'safety_manager', companyType: 'client' })).toBe('all');
    expect(companyDocScopeMode({ role: 'safety_manager', companyType: 'gc' })).toBe('tree');
    expect(companyDocScopeMode({ role: 'safety_manager', companyType: 'contractor' })).toBe('own');
  });
});

describe('seesProjectWideCompanies', () => {
  it('uses accessibleCompanyIds null as project-wide', () => {
    expect(seesProjectWideCompanies({ accessibleCompanyIds: null })).toBe(true);
    expect(seesProjectWideCompanies({ accessibleCompanyIds: ['a'] })).toBe(false);
    expect(seesProjectWideCompanies({ accessibleCompanyIds: [] })).toBe(false);
  });

  it('never treats GC/contractor SM as project-wide without allowlist', () => {
    expect(
      seesProjectWideCompanies({ role: 'safety_manager', companyType: 'gc' }),
    ).toBe(false);
    expect(
      seesProjectWideCompanies({ role: 'safety_manager', companyType: 'contractor' }),
    ).toBe(false);
    expect(
      seesProjectWideCompanies({ role: 'safety_manager', companyType: 'client' }),
    ).toBe(true);
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

describe('pickProjectMemberRow', () => {
  it('prefers selectedCompanyId when dual persona rows exist', () => {
    const rows = [
      { company_id: 'gc-a', role_new: 'site_supervisor' },
      { company_id: 'c1', role_new: 'worker' },
    ];
    expect(pickProjectMemberRow(rows, 'c1')?.company_id).toBe('c1');
  });

  it('picks higher role when no preferred company', () => {
    const rows = [
      { company_id: 'c1', role_new: 'worker' },
      { company_id: 'gc-a', role_new: 'site_supervisor' },
    ];
    expect(pickProjectMemberRow(rows)?.company_id).toBe('gc-a');
  });

  it('returns null for empty', () => {
    expect(pickProjectMemberRow([])).toBeNull();
    expect(pickProjectMemberRow(null)).toBeNull();
  });
});

describe('resolveAssessmentDocumentCompanies', () => {
  const companies = [
    { id: 'client-1', name: '발주A', type: 'client', parent_company_id: null },
    { id: 'gc-a', name: '시공A', type: 'gc', parent_company_id: null },
    { id: 'gc-b', name: '시공B', type: 'gc', parent_company_id: null },
    { id: 'c1', name: '정원이엔씨', type: 'contractor', parent_company_id: 'gc-a' },
    { id: 'c2', name: '다른협력', type: 'contractor', parent_company_id: 'gc-b' },
  ];

  it('uses creator company as 작성 회사 and parent GC only as 시공사', () => {
    const out = resolveAssessmentDocumentCompanies({
      authorCompanyId: 'c1',
      authorCompanyName: '정원이엔씨',
      authorCompanyType: 'contractor',
      companies,
    });
    expect(out.authorCompanyName).toBe('정원이엔씨');
    expect(out.gcCompanyName).toBe('시공A');
    expect(out.clientCompanyName).toBe('발주A');
    expect(out.gcCompanyName).not.toContain('시공B');
    expect(out.gcCompanyName).not.toContain('다른협력');
  });

  it('does not dump all gc/contractor names for master-like viewers', () => {
    const out = resolveAssessmentDocumentCompanies({
      authorCompanyId: 'c1',
      companies,
    });
    expect(out.gcCompanyName).toBe('시공A');
    expect(out.gcCompanyName.split(',').length).toBe(1);
  });

  it('uses the author company itself when the author is GC', () => {
    const out = resolveAssessmentDocumentCompanies({
      authorCompanyId: 'gc-a',
      companies,
    });
    expect(out.authorCompanyName).toBe('시공A');
    expect(out.gcCompanyName).toBe('시공A');
  });

  it('returns 미지정 instead of listing every company when parent GC is unknown', () => {
    const out = resolveAssessmentDocumentCompanies({
      authorCompanyId: 'orphan',
      authorCompanyName: '고아업체',
      companies,
    });
    expect(out.authorCompanyName).toBe('고아업체');
    expect(out.gcCompanyName).toBe('(미지정)');
  });
});

describe('formatCreatorCompanyLabel', () => {
  it('formats name with company type', () => {
    expect(formatCreatorCompanyLabel('진남토건(주)', 'contractor')).toBe('진남토건(주)(협력사)');
    expect(formatCreatorCompanyLabel('대한건설', 'gc')).toBe('대한건설(시공사)');
  });

  it('does not double-append a type already in the company name', () => {
    expect(formatCreatorCompanyLabel('진남토건(주)(협력사)', 'contractor')).toBe('진남토건(주)(협력사)');
  });

  it('returns empty when name missing', () => {
    expect(formatCreatorCompanyLabel('', 'contractor')).toBe('');
  });
});

describe('resolveAssessmentRunListCompanyLabel', () => {
  const companies = buildProjectCompanyLabelMap([
    { id: 'gc-jinnam', name: '진남토건(주)', type: 'gc' },
    { id: 'partner-jinnam', name: '진남토건(주)(협력사)', type: 'contractor' },
    { id: '우리', name: '우리플랜트', type: 'contractor' },
  ]);

  it('prefers target partner company over creator GC membership', () => {
    expect(
      resolveAssessmentRunListCompanyLabel(
        {
          created_by: 'u-gc',
          author_user_id: 'u-gc',
          target_company_ids: ['partner-jinnam'],
        },
        {
          companyLabelById: companies,
          userCompanyLabelById: { 'u-gc': '진남토건(주)(시공사)' },
        },
      ),
    ).toBe('진남토건(주)(협력사)');
  });

  it('falls back to author then creator when no targets', () => {
    expect(
      resolveAssessmentRunListCompanyLabel(
        { created_by: 'u-in', author_user_id: 'u-author', target_company_ids: [] },
        {
          companyLabelById: companies,
          userCompanyLabelById: {
            'u-in': '하이테크엔지니어링(시공사)',
            'u-author': '우리플랜트(협력사)',
          },
        },
      ),
    ).toBe('우리플랜트(협력사)');
  });
});

describe('preferredCompanyIdsByRunAuthors', () => {
  it('indexes target companies by author and creator', () => {
    expect(
      preferredCompanyIdsByRunAuthors([
        { created_by: 'a', author_user_id: 'b', target_company_ids: ['p1'] },
        { created_by: 'a', author_user_id: null, target_company_ids: ['p1', 'p2'] },
      ]),
    ).toEqual({
      a: ['p1', 'p2'],
      b: ['p1'],
    });
  });
});
