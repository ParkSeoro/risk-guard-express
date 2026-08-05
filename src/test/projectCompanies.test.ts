import { describe, it, expect } from 'vitest';
import { dedupeProjectCompaniesByCompanyId, type ProjectCompany } from '@/lib/projectCompanies';

describe('dedupeProjectCompaniesByCompanyId', () => {
  it('keeps a single row per company_id', () => {
    const rows: ProjectCompany[] = [
      { id: 'jinnam', name: '진남토건', type: 'gc', access_edge: true, project_company_id: 'pc-a' },
      { id: 'jinnam', name: '진남토건', type: 'contractor', access_edge: false, project_company_id: 'pc-b' },
      { id: 'hitech', name: '하이테크', type: 'gc', access_edge: true, project_company_id: 'pc-c' },
    ];
    const out = dedupeProjectCompaniesByCompanyId(rows);
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.id === 'jinnam')?.access_edge).toBe(true);
    expect(out.find((c) => c.id === 'jinnam')?.type).toBe('gc');
  });

  it('prefers access_edge when order is reversed', () => {
    const rows: ProjectCompany[] = [
      { id: 'jinnam', name: '진남토건', type: 'contractor', access_edge: false, project_company_id: 'pc-b' },
      { id: 'jinnam', name: '진남토건', type: 'gc', access_edge: true, project_company_id: 'pc-a' },
    ];
    const out = dedupeProjectCompaniesByCompanyId(rows);
    expect(out).toHaveLength(1);
    expect(out[0].project_company_id).toBe('pc-a');
    expect(out[0].type).toBe('gc');
  });
});
