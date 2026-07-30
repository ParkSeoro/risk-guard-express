/**
 * Company document isolation SSOT — client query filters.
 * Contractors/vendors must only see their own company rows regardless of project role.
 */
import { isContractorType, isClientType, isGcType, normalizeCompanyType } from '@/lib/companyTypes';

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

/**
 * True when queries must be restricted to the member's company_id.
 * - contractor / vendor companies: always (even site_manager / PA)
 * - worker / viewer: always
 * - master / PA / SM on client·gc: false (see all in project)
 * - site_manager / supervisor on gc·client: false (RLS descendant tree)
 * - unknown company type with a company_id: restrict (fail closed)
 */
export function mustScopeToOwnCompany(opts: {
  role?: CompanyScopeRole | null;
  companyType?: string | null;
  isMaster?: boolean;
}): boolean {
  if (opts.isMaster || opts.role === 'master') return false;

  // Subcontractors / suppliers — never see peer companies
  if (isContractorType(opts.companyType)) return true;

  const role = (opts.role || '').toLowerCase();
  if (role === 'worker' || role === 'viewer' || role === 'contractor') return true;

  // Owner-side admins
  if (role === 'project_admin' || role === 'safety_manager') {
    // Mis-assigned PA/SM on a contractor company still must not see peers
    if (isContractorType(opts.companyType)) return true;
    return false;
  }

  // GC / client site managers rely on RLS for descendant companies
  if (role === 'site_manager' || role === 'supervisor' || role === 'site_supervisor') {
    if (isGcType(opts.companyType) || isClientType(opts.companyType)) return false;
    // Unknown or subordinate → own company only
    return true;
  }

  // Fail closed for unrecognized roles when a company type isn't owner-side
  const t = normalizeCompanyType(opts.companyType);
  if (t === 'client' || t === 'gc') return false;
  return true;
}

/** Apply .eq('company_id', …) when required. No-op for owner-side. */
export function applyOwnCompanyFilter(
  query: any,
  opts: {
    role?: CompanyScopeRole | null;
    companyType?: string | null;
    companyId?: string | null;
    isMaster?: boolean;
  },
): any {
  if (!mustScopeToOwnCompany(opts)) return query;
  if (opts.companyId) return query.eq('company_id', opts.companyId);
  return query.eq('company_id', NIL_COMPANY);
}
