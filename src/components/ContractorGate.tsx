import { ReactNode } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useGlobalProjectAccessOptional } from '@/components/AppLayout';
import {
  ADMIN_APP_BASE,
  isAllowedForContractor,
} from '@/lib/contractorRouteAccess';

/**
 * 협력사(contractor/vendor) 계정이 접근할 수 있는 관리 화면만 허용.
 * 권한(RLS)·작성 가능 범위는 그대로 두고, URL만 막는다.
 * 마스터/발주처/GC 등은 통과.
 */
export default function ContractorGate({ children }: { children: ReactNode }) {
  const ctx = useGlobalProjectAccessOptional();
  const location = useLocation();

  // Company type still loading — don't redirect yet (avoids false deny → loop).
  if (ctx?.loading) {
    return <>{children}</>;
  }

  const isContractor =
    ctx && !ctx.isMaster && (ctx.userCompanyType === 'contractor' || ctx.userCompanyType === 'vendor');

  if (isContractor && !isAllowedForContractor(location.pathname)) {
    // Stay inside admin shell — never bounce to `/` (that remounts RoleAwareRootRedirect → loop).
    return <Navigate to={ADMIN_APP_BASE} replace />;
  }
  return <>{children}</>;
}
