import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { applyOwnCompanyFilter } from "@/lib/companyDocScope";
import { normalizeCompanyType, type CompanyTypeCode } from "@/lib/companyTypes";

export type MobileRole = 'master' | 'project_admin' | 'safety_manager' | 'site_manager' | 'supervisor' | 'site_supervisor' | 'worker' | 'viewer' | 'contractor';

/**
 * 모바일 페이지 공통 액세스 훅.
 * - localStorage `selectedProjectId` 구독
 * - applyCompanyFilter: 협력사/공급사는 역할과 무관하게 자사 company_id만
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
          setLoading(false);
        }
        return;
      }
      if (!user || !projectId) {
        if (!cancelled) {
          setRole('viewer');
          setCompanyId(null);
          setCompanyType(null);
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
      if (!cancelled) {
        const d = data as any;
        const raw = (d?.role_new as MobileRole) || 'viewer';
        setRole(raw === 'contractor' ? 'worker' : raw);
        setCompanyId(d?.company_id || null);
        setCompanyType(normalizeCompanyType(d?.companies?.type) || null);
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
    }) as T;
  }, [isMaster, role, companyId, companyType]);

  return {
    projectId,
    setProjectId,
    role,
    companyId,
    companyType,
    isMaster,
    isProjectAdmin,
    isContractor,
    loading,
    applyCompanyFilter,
  };
}
