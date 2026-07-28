import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalProjectAccessOptional } from '@/components/AppLayout';

type Allowed = 'master' | 'project_admin' | 'safety_manager' | 'site_manager' | 'supervisor' | 'site_supervisor';

/**
 * Blocks worker / contractor / vendor accounts from admin-only routes.
 * Redirects to `/` when the current user does not hold one of `allowed` roles.
 */
export default function RoleGuard({
  children,
  allowed = ['master', 'project_admin', 'safety_manager'],
  masterOnly = false,
}: {
  children: ReactNode;
  allowed?: Allowed[];
  masterOnly?: boolean;
}) {
  const { hasRole, roles, loading } = useAuth();
  const ctx = useGlobalProjectAccessOptional();

  if (loading) return null;

  const isMaster = hasRole('master');
  if (isMaster) return <>{children}</>;
  if (masterOnly) return <Navigate to="/" replace />;

  // Hard block: contractor/vendor company accounts, or contractor/worker/viewer-only roles
  const companyType = ctx?.userCompanyType;
  const isContractorCo = companyType === 'contractor' || companyType === 'vendor';
  const LOW = new Set(['contractor', 'worker', 'viewer', 'user']);
  const isLowPriv = roles.length === 0 || roles.every((r) => LOW.has(r as string));

  if (isContractorCo || isLowPriv) return <Navigate to="/" replace />;

  const ok = allowed.some((r) => hasRole(r as any));
  if (!ok) return <Navigate to="/" replace />;

  return <>{children}</>;
}
