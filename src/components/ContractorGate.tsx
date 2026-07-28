import { ReactNode } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useGlobalProjectAccessOptional } from '@/components/AppLayout';

/**
 * 협력사(contractor) 계정이 접근할 수 있는 라우트만 허용한다.
 * 그 외 URL 은 대시보드(/)로 리다이렉트.
 * 마스터/발주처/GC 등은 그대로 통과.
 */
const CONTRACTOR_ALLOWED_PREFIXES = [
  '/',
  '/work-plans',
  '/work-plan/',
  '/work-permits',
  '/risk-assessment',
  '/assessment-run/',
  '/approvals',
  '/tbm-logs',
  '/incidents',
  '/workers',
  '/profile',
  '/settings/account',
  '/project-library',
  '/education-materials',
  '/manual',
];

function isAllowedForContractor(pathname: string): boolean {
  if (pathname === '/') return true;
  return CONTRACTOR_ALLOWED_PREFIXES.some((p) =>
    p === '/' ? false : pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?'),
  );
}

export default function ContractorGate({ children }: { children: ReactNode }) {
  const ctx = useGlobalProjectAccessOptional();
  const location = useLocation();

  const isContractor =
    ctx && !ctx.isMaster && (ctx.userCompanyType === 'contractor' || ctx.userCompanyType === 'vendor');

  if (isContractor && !isAllowedForContractor(location.pathname)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
