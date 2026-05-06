import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Returns true if the project's client/owner company is DIG 에어가스(주).
 * Used to gate DIG-specific work permit form.
 */
const DIG_KEYWORDS = ['DIG', '디아이지', '디아이지에어가스', 'DIG 에어가스', 'DIG에어가스', 'D.I.G'];

export function useIsDigProject(projectId?: string | null) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!projectId) { setEnabled(false); setLoading(false); return; }
      const [{ data: project }, { data: companies }] = await Promise.all([
        supabase.from('projects').select('client, contractor, name, site_name').eq('id', projectId).maybeSingle(),
        supabase.from('companies').select('name, type').eq('project_id', projectId),
      ]);
      const haystacks: string[] = [];
      if (project) haystacks.push(project.client || '', project.contractor || '', project.name || '', project.site_name || '');
      (companies || []).forEach((c: any) => haystacks.push(c.name || ''));
      const match = haystacks.some(h => DIG_KEYWORDS.some(k => h.toUpperCase().includes(k.toUpperCase())));
      if (!cancel) { setEnabled(match); setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [projectId]);

  return { enabled, loading };
}
