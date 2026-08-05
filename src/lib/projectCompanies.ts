import { supabase } from '@/integrations/supabase/client';
import { normalizeCompanyType, resolveProjectCompanyType } from '@/lib/companyTypes';

export type ProjectCompany = {
  id: string;
  name: string;
  type: string | null;
  scope?: string | null;
  business_no?: string | null;
  contact?: string | null;
  address?: string | null;
  is_deleted?: boolean | null;
  /** project_companies.id — unique per persona row */
  project_company_id?: string;
  role_in_project?: string | null;
  parent_company_id?: string | null;
  /** When false: org-chart only; must not grant access via this edge */
  access_edge?: boolean;
};

export type ProjectCompanyLink = {
  project_company_id: string;
  company_id: string;
  role_in_project: string;
  parent_company_id: string | null;
  access_edge: boolean;
  company: ProjectCompany;
};

/**
 * Load companies linked to a project via project_companies (SSOT).
 * Prefer this over companies.eq('project_id') — project_id on companies is legacy.
 *
 * Dedupes by company_id (keeps access_edge / primary persona) for dropdowns.
 * Use fetchProjectCompanyLinks when the hierarchy needs dual personas.
 */
export async function fetchProjectCompanies(
  projectId: string,
  opts?: { includeDeleted?: boolean }
): Promise<ProjectCompany[]> {
  const links = await fetchProjectCompanyLinks(projectId, opts);
  return dedupeProjectCompaniesByCompanyId(links.map((l) => l.company));
}

/** All persona rows (same legal company may appear more than once). */
export async function fetchProjectCompanyLinks(
  projectId: string,
  opts?: { includeDeleted?: boolean }
): Promise<ProjectCompanyLink[]> {
  if (!projectId) return [];

  let q = (supabase as any)
    .from('project_companies')
    .select(
      'id, company_id, role_in_project, parent_company_id, access_edge, companies:company_id(id, name, type, scope, business_no, contact, address, is_deleted)',
    )
    .eq('project_id', projectId);

  if (!opts?.includeDeleted) {
    q = q.eq('is_deleted', false);
  }

  const { data, error } = await q;
  if (error) {
    console.warn('fetchProjectCompanyLinks failed, falling back to companies.project_id:', error.message);
    let fallback = supabase
      .from('companies')
      .select('id, name, type, scope, business_no, contact, address, is_deleted')
      .eq('project_id', projectId)
      .order('name');
    if (!opts?.includeDeleted) fallback = fallback.eq('is_deleted', false) as typeof fallback;
    const { data: rows } = await fallback;
    return ((rows || []) as ProjectCompany[])
      .filter((c) => opts?.includeDeleted || c.is_deleted !== true)
      .map((c) => ({
        project_company_id: c.id,
        company_id: c.id,
        role_in_project: String(c.type || 'contractor'),
        parent_company_id: null,
        access_edge: true,
        company: { ...c, project_company_id: c.id, access_edge: true },
      }));
  }

  return (data || [])
    .map((l: any): ProjectCompanyLink | null => {
      const c = l.companies;
      if (!c) return null;
      if (!opts?.includeDeleted && c.is_deleted === true) return null;
      const role = resolveProjectCompanyType(l.role_in_project, c.type);
      const company: ProjectCompany = {
        ...c,
        type: role,
        project_company_id: l.id,
        role_in_project: l.role_in_project,
        parent_company_id: l.parent_company_id ?? null,
        access_edge: l.access_edge !== false,
      };
      return {
        project_company_id: l.id as string,
        company_id: c.id as string,
        role_in_project: String(l.role_in_project || role),
        parent_company_id: (l.parent_company_id as string | null) ?? null,
        access_edge: l.access_edge !== false,
        company,
      };
    })
    .filter((x: ProjectCompanyLink | null): x is ProjectCompanyLink => !!x)
    .sort((a, b) => (a.company.name || '').localeCompare(b.company.name || '', 'ko'));
}

/** Keep one row per legal company — prefer access_edge persona. */
export function dedupeProjectCompaniesByCompanyId(rows: ProjectCompany[]): ProjectCompany[] {
  const byId = new Map<string, ProjectCompany>();
  for (const c of rows) {
    const prev = byId.get(c.id);
    if (!prev) {
      byId.set(c.id, c);
      continue;
    }
    const prevEdge = prev.access_edge !== false;
    const nextEdge = c.access_edge !== false;
    if (!prevEdge && nextEdge) byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
}

/**
 * Link a persona into a project without upsert-overwrite.
 * - Same role+parent already active → no-op
 * - Same company, different role/parent → insert secondary (access_edge=false)
 * - First link → access_edge=true
 * Never mutates companies.type (keeps approval/RLS SSOT intact).
 */
export async function linkProjectCompanyPersona(opts: {
  projectId: string;
  companyId: string;
  roleInProject: string;
  parentCompanyId?: string | null;
}): Promise<{ ok: true; projectCompanyId: string; created: boolean; secondary: boolean } | { ok: false; error: string }> {
  const role = normalizeCompanyType(opts.roleInProject) || opts.roleInProject || 'contractor';
  const parent = opts.parentCompanyId || null;

  const { data: existing, error: readErr } = await (supabase as any)
    .from('project_companies')
    .select('id, role_in_project, parent_company_id, access_edge, is_deleted')
    .eq('project_id', opts.projectId)
    .eq('company_id', opts.companyId);

  if (readErr) return { ok: false, error: readErr.message };

  const rows = (existing || []) as any[];
  const active = rows.filter((r) => !r.is_deleted);
  const same = active.find(
    (r) =>
      (normalizeCompanyType(r.role_in_project) || r.role_in_project) === role &&
      (r.parent_company_id || null) === parent,
  );
  if (same) {
    return { ok: true, projectCompanyId: same.id, created: false, secondary: same.access_edge === false };
  }

  // Revive soft-deleted identical persona if present
  const softSame = rows.find(
    (r) =>
      r.is_deleted &&
      (normalizeCompanyType(r.role_in_project) || r.role_in_project) === role &&
      (r.parent_company_id || null) === parent,
  );
  if (softSame) {
    const hasAccess = active.some((r) => r.access_edge !== false);
    const { error } = await (supabase as any)
      .from('project_companies')
      .update({
        is_deleted: false,
        access_edge: !hasAccess,
        role_in_project: role,
        parent_company_id: parent,
      })
      .eq('id', softSame.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, projectCompanyId: softSame.id, created: true, secondary: hasAccess };
  }

  const hasAccess = active.some((r) => r.access_edge !== false);
  const { data: inserted, error } = await (supabase as any)
    .from('project_companies')
    .insert({
      project_id: opts.projectId,
      company_id: opts.companyId,
      role_in_project: role,
      parent_company_id: parent,
      is_deleted: false,
      access_edge: !hasAccess,
    })
    .select('id, access_edge')
    .single();

  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    projectCompanyId: inserted.id,
    created: true,
    secondary: inserted.access_edge === false,
  };
}
