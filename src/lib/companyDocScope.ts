/**
 * Company document isolation SSOT.
 *
 * Rules:
 * - master / 발주처(client) PA·SM: project-wide
 * - 시공사(gc): own company + descendant companies only (never peer GCs)
 * - 협력사/공급사: own company only
 * - worker/viewer: own company only
 */
import { isContractorType, isClientType, isGcType, normalizeCompanyType } from '@/lib/companyTypes';
import { supabase } from '@/integrations/supabase/client';

const NIL_COMPANY = '00000000-0000-0000-0000-000000000000';

export type CompanyScopeRole =
  | 'master'
  | 'project_admin'
  | 'safety_manager'
  | 'site_manager'
  | 'supervisor'
  | 'site_supervisor'
  | 'worker'
  | 'viewer'
  | 'contractor'
  | string;

export type CompanyDocScopeMode = 'all' | 'own' | 'tree';

export function companyDocScopeMode(opts: {
  role?: CompanyScopeRole | null;
  companyType?: string | null;
  isMaster?: boolean;
}): CompanyDocScopeMode {
  if (opts.isMaster || opts.role === 'master') return 'all';

  const role = (opts.role || '').toLowerCase();
  const t = normalizeCompanyType(opts.companyType);

  // 협력사 / 공급사 — 자사만 (역할 무관)
  if (isContractorType(opts.companyType) || t === 'contractor' || t === 'vendor') {
    return 'own';
  }

  // 시공사 — 자사 + 하위 협력사만 (PA/SM 포함, 타 시공사 불가)
  if (isGcType(opts.companyType) || t === 'gc') {
    if (role === 'worker' || role === 'viewer') return 'own';
    return 'tree';
  }

  // 발주처 — PA/SM은 전체, 그 외는 자사
  if (isClientType(opts.companyType) || t === 'client') {
    if (role === 'project_admin' || role === 'safety_manager') return 'all';
    if (role === 'worker' || role === 'viewer') return 'own';
    // client site_manager: treat as tree of whole? Usually client sees all via PA.
    // Fail safe: site_manager on client → all for practical owner oversight
    if (role === 'site_manager' || role === 'supervisor' || role === 'site_supervisor') return 'all';
    return 'own';
  }

  if (role === 'worker' || role === 'viewer' || role === 'contractor') return 'own';

  // Unknown type: restrict
  return 'own';
}

/** @deprecated use companyDocScopeMode === 'own' || needs filter */
export function mustScopeToOwnCompany(opts: {
  role?: CompanyScopeRole | null;
  companyType?: string | null;
  isMaster?: boolean;
}): boolean {
  return companyDocScopeMode(opts) !== 'all';
}

/**
 * Resolve company ids the user may see for a project.
 * - all → null (no filter)
 * - own → [companyId]
 * - tree → [companyId, ...descendants via project_companies.parent_company_id]
 */
export async function resolveAccessibleCompanyIds(opts: {
  projectId: string;
  companyId?: string | null;
  companyType?: string | null;
  role?: CompanyScopeRole | null;
  isMaster?: boolean;
}): Promise<string[] | null> {
  const mode = companyDocScopeMode(opts);
  if (mode === 'all') return null;
  if (!opts.companyId) return [NIL_COMPANY];
  if (mode === 'own') return [opts.companyId];

  // tree
  const { data, error } = await (supabase as any)
    .from('project_companies')
    .select('company_id, parent_company_id')
    .eq('project_id', opts.projectId)
    .eq('is_deleted', false);

  if (error || !data?.length) {
    // Fallback: companies.parent_company_id
    const { data: cos } = await supabase
      .from('companies')
      .select('id, parent_company_id')
      .eq('is_deleted', false);
    return collectDescendants(
      (cos || []).map((c: any) => ({ id: c.id, parent_id: c.parent_company_id })),
      opts.companyId,
    );
  }

  return collectDescendants(
    (data as any[]).map((r) => ({
      id: r.company_id as string,
      parent_id: (r.parent_company_id as string | null) || null,
    })),
    opts.companyId,
  );
}

export function collectDescendants(
  rows: { id: string; parent_id: string | null }[],
  rootId: string,
): string[] {
  const children = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parent_id) continue;
    const list = children.get(r.parent_id) || [];
    list.push(r.id);
    children.set(r.parent_id, list);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of children.get(cur) || []) {
      if (out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return [...out];
}

/** Apply company_id scope to a supabase query builder. */
export function applyOwnCompanyFilter(
  query: any,
  opts: {
    role?: CompanyScopeRole | null;
    companyType?: string | null;
    companyId?: string | null;
    isMaster?: boolean;
    /** Precomputed ids for tree mode; if missing, falls back to own-only for GC */
    accessibleCompanyIds?: string[] | null;
    /**
     * Also select company_id IS NULL rows (legacy orphans).
     * Caller must filter by normalizeCompanyLabel — do not use for unrelated modules.
     */
    includeOrphans?: boolean;
  },
): any {
  const mode = companyDocScopeMode(opts);
  if (mode === 'all') return query;

  if (mode === 'tree' && opts.accessibleCompanyIds && opts.accessibleCompanyIds.length > 0) {
    if (opts.includeOrphans) {
      const ids = opts.accessibleCompanyIds.join(',');
      return query.or(`company_id.in.(${ids}),company_id.is.null`);
    }
    return query.in('company_id', opts.accessibleCompanyIds);
  }

  // own, or tree without ids loaded yet → own only (safe).
  if (opts.companyId) {
    if (opts.includeOrphans) {
      return query.or(`company_id.eq.${opts.companyId},company_id.is.null`);
    }
    return query.eq('company_id', opts.companyId);
  }
  return query.eq('company_id', NIL_COMPANY);
}

/** Filter assessment_runs-like rows that use target_company_ids instead of company_id. */
export function filterRunsByCompanyScope<T extends {
  created_by?: string | null;
  target_company_ids?: string[] | null;
}>(
  rows: T[],
  opts: {
    userId?: string | null;
    accessibleCompanyIds: string[] | null; // null = all
  },
): T[] {
  if (opts.accessibleCompanyIds === null) return rows;
  const allow = new Set(opts.accessibleCompanyIds);
  return rows.filter((r) => {
    if (opts.userId && r.created_by === opts.userId) return true;
    const targets = r.target_company_ids;
    if (!Array.isArray(targets) || targets.length === 0) return false;
    return targets.some((id) => allow.has(id));
  });
}
