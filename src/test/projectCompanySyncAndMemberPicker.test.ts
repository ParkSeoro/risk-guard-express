import { describe, expect, it } from 'vitest';
import { resolveProjectCompanyColumns } from '@/lib/projectCompanies';
import {
  filterAndSortMemberCandidates,
  matchCompanyIdByName,
} from '@/components/project/ProjectMemberMultiPickerDialog';

describe('Project company SSOT sync (resolveProjectCompanyColumns)', () => {
  it('derives gc_company_id, gc_company_ids, and sub_company_ids from active links', () => {
    const res = resolveProjectCompanyColumns([
      { company_id: 'c-client', role_in_project: 'client', is_deleted: false },
      { company_id: 'c-gc-1', role_in_project: 'gc', is_deleted: false },
      { company_id: 'c-gc-2', role_in_project: 'gc', is_deleted: false },
      { company_id: 'c-sub-1', role_in_project: 'contractor', is_deleted: false },
      { company_id: 'c-gc-del', role_in_project: 'gc', is_deleted: true },
    ]);
    expect(res.gc_company_id).toBe('c-gc-1');
    expect(res.gc_company_ids).toEqual(['c-gc-1', 'c-gc-2']);
    expect(res.sub_company_ids).toEqual(['c-sub-1']);
  });

  it('preserves preferred or current primary GC when still linked', () => {
    const res = resolveProjectCompanyColumns(
      [
        { company_id: 'c-gc-1', role_in_project: 'gc' },
        { company_id: 'c-gc-2', role_in_project: 'gc' },
      ],
      { preferredPrimaryGcId: 'c-gc-2' },
    );
    expect(res.gc_company_id).toBe('c-gc-2');
  });

  it('falls back to first remaining GC when previous primary GC is removed', () => {
    const res = resolveProjectCompanyColumns(
      [{ company_id: 'c-gc-2', role_in_project: 'gc' }],
      { currentPrimaryGcId: 'c-gc-removed' },
    );
    expect(res.gc_company_id).toBe('c-gc-2');
  });
});

describe('ProjectMemberMultiPickerDialog search & matching', () => {
  const profiles = [
    { user_id: 'u1', display_name: '홍길동', company: '청원산기(주)', phone: '010-1111-2222' },
    { user_id: 'u2', display_name: '김철수', company: '진남토건(주)', phone: '010-3333-4444' },
    { user_id: 'u3', display_name: '박서로', company: '에어리퀴드코리아', phone: '010-5555-6666' },
  ];

  it('filters by Korean name, company name, or phone digits and sorts alphabetically', () => {
    const byCompany = filterAndSortMemberCandidates(profiles, new Set(['u3']), {
      query: '청원',
      scope: 'all',
      projectCompanyNames: new Set(),
    });
    expect(byCompany.map((p) => p.user_id)).toEqual(['u1']);

    const byPhone = filterAndSortMemberCandidates(profiles, new Set(), {
      query: '4444',
      scope: 'all',
      projectCompanyNames: new Set(),
    });
    expect(byPhone.map((p) => p.user_id)).toEqual(['u2']);

    const sortedAll = filterAndSortMemberCandidates(profiles, new Set(), {
      query: '',
      scope: 'all',
      projectCompanyNames: new Set(),
    });
    expect(sortedAll.map((p) => p.display_name)).toEqual(['김철수', '박서로', '홍길동']);
  });

  it('filters to project companies scope and auto-matches company id', () => {
    const scoped = filterAndSortMemberCandidates(profiles, new Set(), {
      query: '',
      scope: 'project_companies',
      projectCompanyNames: new Set(['청원산기(주)']),
    });
    expect(scoped.map((p) => p.user_id)).toEqual(['u1']);

    expect(
      matchCompanyIdByName('청원산기(주)', [
        { id: 'c1', name: '진남토건(주)', type: 'gc' },
        { id: 'c2', name: '청원산기(주)', type: 'gc' },
      ]),
    ).toBe('c2');
  });
});
