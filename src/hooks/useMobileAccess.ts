import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  applyOwnCompanyFilter,
  pickProjectMemberRow,
  readPreferredCompanyId,
  resolveAccessibleCompanyIds,
  seesProjectWideCompanies,
} from "@/lib/companyDocScope";
import { normalizeCompanyType, type CompanyTypeCode } from "@/lib/companyTypes";
import { usePreview } from "@/contexts/PreviewContext";
import { resolveGlobalMobileRole } from "@/lib/mobileShell";
import {
  ACTIVE_PROJECT_CHANGED_EVENT,
  isActiveProjectStorageKey,
  readActiveProjectId,
  writeActiveProjectId,
} from "@/lib/activeProject";

export type MobileRole = 'master' | 'project_admin' | 'safety_manager' | 'site_manager' | 'supervisor' | 'site_supervisor' | 'worker' | 'viewer' | 'contractor';

/**
 * 모바일 페이지 공통 액세스 훅.
 * 시공사(gc): 자사+하위만 / 협력사: 자사만 / 발주처 PA: 전체
 * PreviewContext가 있으면 합성 역할·프로젝트를 사용 (마스터 PC 프리뷰).
 */
export function useMobileAccess() {
  const { user, hasRole } = useAuth();
  const preview = usePreview();
  const isMaster = preview.isPreview ? preview.syntheticRole === "master" : hasRole('master');
  const [projectId, setProjectIdState] = useState<string>(() => {
    if (preview.isPreview && preview.previewProjectId) return preview.previewProjectId;
    try { return readActiveProjectId(); } catch { return ""; }
  });
  const [role, setRole] = useState<MobileRole>(
    preview.isPreview ? preview.syntheticRole : 'viewer',
  );
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyType, setCompanyType] = useState<CompanyTypeCode | null>(null);
  // [] until resolved — never flash "all" for non-master
  const [accessibleCompanyIds, setAccessibleCompanyIds] = useState<string[] | null>([]);
  const [scopeStatus, setScopeStatus] = useState<'pending' | 'ready'>(preview.isPreview ? 'ready' : 'pending');
  const [loading, setLoading] = useState(!preview.isPreview);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (isActiveProjectStorageKey(e.key) || e.key == null) {
        setProjectIdState(readActiveProjectId());
      }
    };
    const onCustom = () => {
      try { setProjectIdState(readActiveProjectId()); } catch {}
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, onCustom);
    window.addEventListener('focus', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, onCustom);
      window.removeEventListener('focus', onCustom);
    };
  }, []);

  const setProjectId = useCallback((id: string) => {
    setProjectIdState(id);
    writeActiveProjectId(id);
  }, []);

  useEffect(() => {
    if (preview.isPreview && preview.previewProjectId) {
      setProjectIdState(preview.previewProjectId);
    }
  }, [preview.isPreview, preview.previewProjectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Master PC preview: synthetic role, unscoped company filter (UI-only)
      if (preview.isPreview) {
        if (!cancelled) {
          setRole(preview.syntheticRole);
          setCompanyId(null);
          setCompanyType(null);
          // Preview shows real project rows for UX review; writes are blocked separately.
          setAccessibleCompanyIds(null);
          setScopeStatus('ready');
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setScopeStatus('pending');
      if (isMaster) {
        if (!cancelled) {
          setRole('master');
          setCompanyId(null);
          setCompanyType(null);
          setAccessibleCompanyIds(null);
          setScopeStatus('ready');
          setLoading(false);
        }
        return;
      }
      if (!user || !projectId) {
        if (!cancelled) {
          // Keep manager/master bucket from global roles — do not drop to worker UI
          setRole(resolveGlobalMobileRole(hasRole) as MobileRole);
          setCompanyId(null);
          setCompanyType(null);
          setAccessibleCompanyIds([]); // restrictive until known
          setScopeStatus(user && !projectId ? 'pending' : 'ready');
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from('project_members')
        .select('role_new, company_id, companies(type)' as any)
        .eq('user_id', user.id)
        .eq('project_id', projectId);
      if (cancelled) return;
      const picked = pickProjectMemberRow((data || []) as any[], readPreferredCompanyId());
      const d = picked as any;
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
        setScopeStatus('ready');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, projectId, isMaster, preview.isPreview, preview.syntheticRole, hasRole]);

  /**
   * Feature ACL (includes safety_manager). NOT company-scope —
   * use seesAllCompanies / accessibleCompanyIds / applyCompanyFilter.
   */
  const isProjectAdmin = role === 'project_admin' || isMaster || role === 'safety_manager';
  const isContractor = role === 'worker' || role === 'contractor';
  const seesAllCompanies = seesProjectWideCompanies({
    isMaster,
    role,
    companyType,
    accessibleCompanyIds: isMaster ? null : accessibleCompanyIds,
  });

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
    scopeStatus,
    seesAllCompanies,
    isMaster,
    isProjectAdmin,
    isContractor,
    loading,
    applyCompanyFilter,
  };
}
