import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectAccess } from '@/hooks/useProjectAccess';

/**
 * Returns the logged-in user's company for the currently selected project.
 * Used to auto-map "소속 업체" on documents (permits, work plans, TBM, etc.).
 */
export function useUserCompany() {
  const { user } = useAuth();
  const { selectedProject } = useProjectAccess();
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
        .select('company_id, companies:company_id(name)')
        .eq('user_id', user.id)
        .eq('project_id', selectedProject)
        .maybeSingle();
      if (cancelled) return;
      setCompanyId(data?.company_id || null);
      setCompanyName(data?.companies?.name || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, selectedProject]);

  return { companyId, companyName, loading };
}
