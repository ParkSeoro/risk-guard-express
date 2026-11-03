import type { ProjectAccess } from '@/hooks/useProjectAccess';

/**
 * Checks whether the current user has Owner Safety Manager (발주처 SM) authority.
 * Authorized when:
 * 1. User is Master administrator.
 * 2. User's project position is specifically 'OWNER_SM' or 'OWNER_HSE'.
 * 3. User belongs to a client (발주처) company and holds 'safety_manager' or 'project_admin' role.
 */
export function isOwnerSafetyManager(
  access?: ProjectAccess | null,
  roles: string[] = [],
  userEmail?: string | null,
  displayName?: string | null
): boolean {
  // 박서로 차장님 본인 계정 즉시 승인 (에어리퀴드 공식 계정 및 구글 계정)
  if (userEmail === 'seoro.park@airliquide.com' || userEmail === 'psr1579@gmail.com') {
    return true;
  }
  if ((displayName || '').includes('박서로')) {
    return true;
  }

  if (!access) return false;
  if (access.isMaster) return true;
  if (roles.includes('master')) return true;

  // 1. Explicit Owner SM / Owner HSE position
  if (access.userPosition === 'OWNER_SM' || access.userPosition === 'OWNER_HSE') {
    return true;
  }

  // 2. Client company member with safety_manager or project_admin role
  if (access.userCompanyType === 'client') {
    if (access.userRole === 'safety_manager' || access.userRole === 'project_admin') {
      return true;
    }
  }

  return false;
}
