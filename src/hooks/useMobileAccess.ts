import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type MobileRole = 'master' | 'project_admin' | 'safety_manager' | 'contractor' | 'viewer' | 'user';

/**
 * 모바일 페이지 공통 액세스 훅.
 * - localStorage `selectedProjectId` 를 구독 (다른 탭/페이지에서 바뀌면 자동 반영)
 * - 현재 프로젝트의 member role / company_id 조회
 * - applyCompanyFilter: Master/PA가 아닌 사용자에게 company_id 필터 적용
 *
 * 데스크톱의 useProjectAccess와 동일한 데이터 격리 정책을 따른다.
 */
export function useMobileAccess() {
  const { user, hasRole } = useAuth();
  const isMaster = hasRole('master');
  const [projectId, setProjectIdState] = useState<string>(() => {
    try { return localStorage.getItem("selectedProjectId") || ""; } catch { return ""; }
  });
  const [role, setRole] = useState<MobileRole>('viewer');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // listen for project switch (other tabs / MobileHome)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'selectedProjectId') {
        setProjectIdState(e.newValue || "");
      }
    };
    const onCustom = () => {
      try { setProjectIdState(localStorage.getItem("selectedProjectId") || ""); } catch {}
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mobile:project-changed', onCustom);
    // Also poll once when window regains focus (mobile browser tab return)
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
        if (!cancelled) { setRole('master'); setCompanyId(null); setLoading(false); }
        return;
      }
      if (!user || !projectId) {
        if (!cancelled) { setRole('viewer'); setCompanyId(null); setLoading(false); }
        return;
      }
      const { data } = await supabase
        .from('project_members')
        .select('role, company_id')
        .eq('user_id', user.id)
        .eq('project_id', projectId)
        .maybeSingle();
      if (!cancelled) {
        setRole((data?.role as MobileRole) || 'viewer');
        setCompanyId(data?.company_id || null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, projectId, isMaster]);

  const isProjectAdmin = role === 'project_admin' || isMaster;
  const isContractor = role === 'contractor';

  /** Master/PA: pass-through. Contractor 등: company_id 필터 강제. */
  const applyCompanyFilter = useCallback(<T,>(query: T): T => {
    if (isMaster || isProjectAdmin) return query;
    if (companyId) return (query as any).eq('company_id', companyId);
    return query;
  }, [isMaster, isProjectAdmin, companyId]);

  return {
    projectId,
    setProjectId,
    role,
    companyId,
    isMaster,
    isProjectAdmin,
    isContractor,
    loading,
    applyCompanyFilter,
  };
}
