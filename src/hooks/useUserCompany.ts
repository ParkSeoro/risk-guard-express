import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { pickProjectMemberRow, readPreferredCompanyId } from '@/lib/companyDocScope';

/**
 * Returns the logged-in user's company for the currently selected project.
 * Used to auto-map "소속 업체" on documents (permits, work plans, TBM, etc.).
 *
 * AppLayout 밖에서도 렌더될 수 있으므로 ProjectAccessContext를 null-safe로 읽고,
 * 없으면 localStorage에 저장된 선택 프로젝트로 fallback 한다.
 */
export function useUserCompany() {
  const { user } = useAuth();
  const access = useGlobalProjectAccessOptional();
  const selectedProject =
    access?.selectedProject ??
    (typeof window !== 'undefined' ? localStorage.getItem('selectedProjectId') : null);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !selectedProject) {
      setCompanyId(null); setCompanyName(null); setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from('project_members')
        .select('company_id, role_new, companies:company_id(name)')
        .eq('user_id', user.id)
        .eq('project_id', selectedProject);
      if (cancelled) return;
      const picked = pickProjectMemberRow((data || []) as any[], readPreferredCompanyId());
      setCompanyId(picked?.company_id || null);
      setCompanyName((picked as any)?.companies?.name || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, selectedProject]);

  return { companyId, companyName, loading };
}
