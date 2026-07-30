import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { applyOwnCompanyFilter, resolveAccessibleCompanyIds } from "@/lib/companyDocScope";
import { normalizeCompanyType, type CompanyTypeCode } from "@/lib/companyTypes";

export type MobileRole = 'master' | 'project_admin' | 'safety_manager' | 'site_manager' | 'supervisor' | 'site_supervisor' | 'worker' | 'viewer' | 'contractor';

/**
 * 모바일 페이지 공통 액세스 훅.
 * 시공사(gc): 자사+하위만 / 협력사: 자사만 / 발주처 PA: 전체
 */
export function useMobileAccess() {
  const { user, hasRole } = useAuth();
  const isMaster = hasRole('master');
  const [projectId, setProjectIdState] = useState<string>(() => {
    try { return localStorage.getItem("selectedProjectId") || ""; } catch { return ""; }
  });
  const [role, setRole] = useState<MobileRole>('viewer');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyType, setCompanyType] = useState<CompanyTypeCode | null>(null);
  const [accessibleCompanyIds, setAccessibleCompanyIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'selectedProjectId') setProjectIdState(e.newValue || "");
    };
    const onCustom = () => {
      try { setProjectIdState(localStorage.getItem("selectedProjectId") || ""); } catch {}
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mobile:project-changed', onCustom);
    window.addEventListener('focus', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mobile:project-changed', onCustom);
      window.removeEventListener('focus', onCustom);
    };
  }, []);

  const setProjectId = useCallback((id: string) => {
    setProjectIdState(id);
    try { localStorage.setItem("selectedProjectId", id); } catch {}
    try { window.dispatchEvent(new Event('mobile:project-changed')); } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (isMaster) {
        if (!cancelled) {
          setRole('master');
          setCompanyId(null);
          setCompanyType(null);
          setAccessibleCompanyIds(null);
          setLoading(false);
        }
        return;
      }
      if (!user || !projectId) {
        if (!cancelled) {
          setRole('viewer');
          setCompanyId(null);
          setCompanyType(null);
          setAccessibleCompanyIds([]); // restrictive until known
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from('project_members')
        .select('role_new, company_id, companies(type)' as any)
        .eq('user_id', user.id)
        .eq('project_id', projectId)
        .maybeSingle();
      if (cancelled) return;
      const d = data as any;
      const raw = (d?.role_new as MobileRole) || 'viewer';
      const nextRole = raw === 'contractor' ? 'worker' : raw;
      const nextCid = d?.company_id || null;
      const nextType = normalizeCompanyType(d?.companies?.type) || null;
      setRole(nextRole);
      setCompanyId(nextCid);
      setCompanyType(nextType);
      const ids = await resolveAccessibleCompanyIds({
        projectId,
        companyId: nextCid,
        companyType: nextType,
        role: nextRole,
        isMaster: false,
      });
      if (!cancelled) {
        setAccessibleCompanyIds(ids);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, projectId, isMaster]);

  const isProjectAdmin = role === 'project_admin' || isMaster || role === 'safety_manager';
  const isContractor = role === 'worker' || role === 'contractor';

  const applyCompanyFilter = useCallback(<T,>(query: T): T => {
    return applyOwnCompanyFilter(query, {
      role,
      companyType,
      companyId,
      isMaster,
      accessibleCompanyIds,
    }) as T;
  }, [isMaster, role, companyId, companyType, accessibleCompanyIds]);

  return {
    projectId,
    setProjectId,
    role,
    companyId,
    companyType,
    accessibleCompanyIds,
    isMaster,
    isProjectAdmin,
    isContractor,
    loading,
    applyCompanyFilter,
  };
}
