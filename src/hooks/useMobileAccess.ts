import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type MobileRole = 'master' | 'project_admin' | 'safety_manager' | 'site_manager' | 'supervisor' | 'worker' | 'viewer' | 'contractor';

/**
 * 모바일 페이지 공통 액세스 훅.
 * - localStorage `selectedProjectId` 를 구독 (다른 탭/페이지에서 바뀌면 자동 반영)
 * - 현재 프로젝트의 member role / company_id 조회
 * - applyCompanyFilter: 데스크톱 useProjectAccess 와 동일 정책
 *   (master/PA/SM 전체 조회, site_manager/supervisor 는 RLS, worker/viewer 만 company_id)
 *
 * 주의: assessment_runs 처럼 company_id 컬럼이 없는 테이블에는 적용하지 말 것.
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
        .select('role_new, company_id')
        .eq('user_id', user.id)
        .eq('project_id', projectId)
        .maybeSingle();
      if (!cancelled) {
        // legacy 'contractor' role_new → treat as worker for filter policy
        const raw = (data?.role_new as MobileRole) || 'viewer';
        setRole(raw === 'contractor' ? 'worker' : raw);
        setCompanyId(data?.company_id || null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, projectId, isMaster]);

  // Parity with useProjectAccess / DB is_project_admin(): master + PA + SM
  const isProjectAdmin = role === 'project_admin' || isMaster || role === 'safety_manager';
  const isContractor = role === 'worker' || role === 'contractor';

  /** Owner-side roles: pass-through. worker/viewer: company_id 강제. SM/supervisor: RLS. */
  const applyCompanyFilter = useCallback(<T,>(query: T): T => {
    if (isMaster || role === 'project_admin' || role === 'safety_manager') return query;
    if (role === 'worker' || role === 'viewer' || role === 'contractor') {
      if (companyId) return (query as any).eq('company_id', companyId);
      return (query as any).eq('company_id', '00000000-0000-0000-0000-000000000000');
    }
    // site_manager / supervisor: rely on RLS descendant filtering
    return query;
  }, [isMaster, role, companyId]);

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
