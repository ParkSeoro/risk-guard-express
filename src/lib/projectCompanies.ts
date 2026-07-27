import { supabase } from '@/integrations/supabase/client';

export type ProjectCompany = {
  id: string;
  name: string;
  type: string | null;
  scope?: string | null;
  business_no?: string | null;
  contact?: string | null;
  address?: string | null;
  is_deleted?: boolean | null;
};

/**
 * Load companies linked to a project via project_companies (SSOT).
 * Prefer this over companies.eq('project_id') — project_id on companies is legacy.
 */
export async function fetchProjectCompanies(
  projectId: string,
  opts?: { includeDeleted?: boolean }
): Promise<ProjectCompany[]> {
  if (!projectId) return [];

  let q = (supabase as any)
    .from('project_companies')
    .select('company_id, role_in_project, companies:company_id(id, name, type, scope, business_no, contact, address, is_deleted)')
    .eq('project_id', projectId);

  if (!opts?.includeDeleted) {
    q = q.eq('is_deleted', false);
  }

  const { data, error } = await q;
  if (error) {
    console.warn('fetchProjectCompanies failed, falling back to companies.project_id:', error.message);
    let fallback = supabase
      .from('companies')
      .select('id, name, type, scope, business_no, contact, address, is_deleted')
      .eq('project_id', projectId)
      .order('name');
    if (!opts?.includeDeleted) fallback = fallback.eq('is_deleted', false) as typeof fallback;
    const { data: rows } = await fallback;
    return ((rows || []) as ProjectCompany[]).filter((c) => opts?.includeDeleted || c.is_deleted !== true);
  }

  return (data || [])
    .map((l: any) => {
      const c = l.companies;
      if (!c) return null;
      return {
        ...c,
        type: c.type || l.role_in_project || null,
      } as ProjectCompany;
    })
    .filter((c: ProjectCompany | null): c is ProjectCompany => !!c && (opts?.includeDeleted || c.is_deleted !== true))
    .sort((a: ProjectCompany, b: ProjectCompany) => (a.name || '').localeCompare(b.name || '', 'ko'));
}
