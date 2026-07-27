import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalProjectAccessOptional } from '@/components/AppLayout';

type Allowed = 'master' | 'project_admin' | 'safety_manager' | 'site_manager' | 'supervisor';

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

  // Hard block: contractor/vendor company accounts and worker role
  const companyType = ctx?.userCompanyType;
  const isContractorCo = companyType === 'contractor' || companyType === 'vendor';
  const isWorker = hasRole('worker') || (roles.length > 0 && roles.every((r) => r === 'worker' || r === 'viewer' || r === 'contractor'));

  if (isContractorCo || isWorker) return <Navigate to="/" replace />;

  const ok = allowed.some((r) => hasRole(r as any));
  if (!ok) return <Navigate to="/" replace />;

  return <>{children}</>;
}
