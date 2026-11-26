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
  /** 프로젝트 링크 또는 회사 전역 상위. 협력사→시공사 결재 범위에 사용. */
  parent_company_id?: string | null;
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
    .select('company_id, parent_company_id, role_in_project, companies:company_id(id, name, type, scope, business_no, contact, address, is_deleted, parent_company_id)')
    .eq('project_id', projectId);

  if (!opts?.includeDeleted) {
    q = q.eq('is_deleted', false);
  }

  const { data, error } = await q;
  if (error) {
    console.warn('fetchProjectCompanies failed, falling back to companies.project_id:', error.message);
    let fallback = supabase
      .from('companies')
      .select('id, name, type, scope, business_no, contact, address, is_deleted, parent_company_id')
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
        type: l.role_in_project || c.type || null,
        // Strictly project-scoped parent: NEVER leak global companies.parent_company_id from another project.
        parent_company_id: l.parent_company_id ?? null,
      } as ProjectCompany;
    })
    .filter((c: ProjectCompany | null): c is ProjectCompany => !!c && (opts?.includeDeleted || c.is_deleted !== true))
    .sort((a: ProjectCompany, b: ProjectCompany) => (a.name || '').localeCompare(b.name || '', 'ko'));
}

export type ProjectCompanyLinkLike = {
  company_id: string;
  role_in_project?: string | null;
  company_type?: string | null;
  is_deleted?: boolean | null;
};

/**
 * Pure SSOT resolver: derives legacy `projects.gc_company_id`, `gc_company_ids`,
 * and `sub_company_ids` from active `project_companies` rows.
 */
export function resolveProjectCompanyColumns(
  links: ProjectCompanyLinkLike[],
  opts?: { preferredPrimaryGcId?: string | null; currentPrimaryGcId?: string | null },
): {
  gc_company_id: string | null;
  gc_company_ids: string[];
  sub_company_ids: string[];
} {
  const gcSet = new Set<string>();
  const subSet = new Set<string>();

  for (const row of links) {
    if (!row?.company_id || row.is_deleted === true) continue;
    const role = String(row.role_in_project || row.company_type || '').toLowerCase();
    if (role === 'gc') {
      gcSet.add(row.company_id);
    } else if (role === 'contractor' || role === 'subcontractor') {
      subSet.add(row.company_id);
    }
  }

  const gc_company_ids = Array.from(gcSet);
  const sub_company_ids = Array.from(subSet).filter((id) => !gcSet.has(id));

  let gc_company_id: string | null = null;
  if (opts?.preferredPrimaryGcId && gcSet.has(opts.preferredPrimaryGcId)) {
    gc_company_id = opts.preferredPrimaryGcId;
  } else if (opts?.currentPrimaryGcId && gcSet.has(opts.currentPrimaryGcId)) {
    gc_company_id = opts.currentPrimaryGcId;
  } else {
    gc_company_id = gc_company_ids[0] || null;
  }

  return { gc_company_id, gc_company_ids, sub_company_ids };
}

/**
 * Synchronizes `projects.gc_company_id`, `gc_company_ids`, and `sub_company_ids`
 * from `project_companies` (the single source of truth).
 */
export async function syncProjectCompanyColumns(
  projectId: string,
  preferredPrimaryGcId?: string | null,
): Promise<{ gc_company_id: string | null; gc_company_ids: string[]; sub_company_ids: string[] } | null> {
  if (!projectId) return null;
  const [{ data: links }, { data: proj }] = await Promise.all([
    (supabase as any)
      .from('project_companies')
      .select('company_id, role_in_project, is_deleted, companies:company_id(type)')
      .eq('project_id', projectId)
      .eq('is_deleted', false),
    supabase
      .from('projects')
      .select('gc_company_id')
      .eq('id', projectId)
      .maybeSingle(),
  ]);

  const normalized: ProjectCompanyLinkLike[] = ((links || []) as any[]).map((l) => ({
    company_id: l.company_id,
    role_in_project: l.role_in_project,
    company_type: l.companies?.type || null,
    is_deleted: l.is_deleted,
  }));

  const resolved = resolveProjectCompanyColumns(normalized, {
    preferredPrimaryGcId,
    currentPrimaryGcId: (proj as any)?.gc_company_id || null,
  });

  await supabase
    .from('projects')
    .update({
      gc_company_id: resolved.gc_company_id,
      gc_company_ids: resolved.gc_company_ids,
      sub_company_ids: resolved.sub_company_ids,
    } as any)
    .eq('id', projectId);

  return resolved;
}
