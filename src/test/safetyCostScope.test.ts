import { describe, expect, it } from 'vitest';
import { groupSafetyCostByCompany, isSafetyCostExecCompany } from '@/lib/safetyCostScope';

describe('isSafetyCostExecCompany', () => {
  it('treats gc / contractor / vendor as exec, not client', () => {
    expect(isSafetyCostExecCompany('gc')).toBe(true);
    expect(isSafetyCostExecCompany('시공사')).toBe(true);
    expect(isSafetyCostExecCompany('contractor')).toBe(true);
    expect(isSafetyCostExecCompany('vendor')).toBe(true);
    expect(isSafetyCostExecCompany('client')).toBe(false);
    expect(isSafetyCostExecCompany('발주처')).toBe(false);
  });
});

describe('groupSafetyCostByCompany', () => {
  const companies = [
    { id: 'client', name: '에어리퀴드', type: 'client' },
    { id: 'gc-a', name: '진남토건', type: 'gc' },
    { id: 'co-a', name: '청원산기', type: 'contractor' },
    { id: 'co-b', name: '정엔지니어링', type: 'contractor' },
  ];
  const constructions = [
    { id: 'c1', company_id: 'co-a', construction_name: '기계설치' },
  ];

  it('overseer sees every 시공사/협력사 even without a construction', () => {
    const groups = groupSafetyCostByCompany(companies, constructions, { includeEmptyExecCompanies: true });
    expect(groups.map((g) => g.companyName)).toEqual(['정엔지니어링', '진남토건', '청원산기']);
    expect(groups.find((g) => g.companyId === 'co-a')?.constructions).toHaveLength(1);
    expect(groups.find((g) => g.companyId === 'co-b')?.constructions).toHaveLength(0);
    expect(groups.some((g) => g.companyId === 'client')).toBe(false);
  });

  it('non-overseer only sees companies that already have a construction', () => {
    const groups = groupSafetyCostByCompany(companies, constructions, { includeEmptyExecCompanies: false });
    expect(groups.map((g) => g.companyId)).toEqual(['co-a']);
  });
});
