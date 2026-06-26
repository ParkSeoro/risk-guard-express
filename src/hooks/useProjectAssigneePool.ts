import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AssigneeOption {
  /** stable option key (user_id if available, else source_id) */
  key: string;
  user_id: string | null;
  display_name: string;
  position: string | null;
  company_id: string | null;
  company_name: string | null;
  source: 'company_manager' | 'project_member';
}

interface Options {
  projectId: string;
  companyId?: string | null;
  /** when true, only include rows that have a linked auth user_id */
  requireUser?: boolean;
}

/**
 * Returns the unified assignee pool for a project: company-registered
 * managers + project members. De-duplicated by user_id (company_manager
 * row wins so the position label is the field-defined one).
 */
export function useProjectAssigneePool({ projectId, companyId, requireUser }: Options) {
  const [options, setOptions] = useState<AssigneeOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from('project_assignee_pool' as any)
        .select('source_id, source, user_id, display_name, position, company_id, company_name')
        .eq('project_id', projectId);
      if (companyId) q = q.eq('company_id', companyId);
      const { data, error } = await q;
      if (cancelled) return;
      if (error || !data) {
        setOptions([]);
        setLoading(false);
        return;
      }
      const byKey = new Map<string, AssigneeOption>();
      for (const row of data as any[]) {
        if (requireUser && !row.user_id) continue;
        const key = row.user_id || `${row.source}:${row.source_id}`;
        const existing = byKey.get(key);
        // company_manager rows take priority over project_member duplicates
        if (!existing || (row.source === 'company_manager' && existing.source !== 'company_manager')) {
          byKey.set(key, {
            key,
            user_id: row.user_id,
            display_name: row.display_name,
            position: row.position,
            company_id: row.company_id,
            company_name: row.company_name,
            source: row.source,
          });
        }
      }
      setOptions(
        Array.from(byKey.values()).sort((a, b) =>
          (a.company_name || '').localeCompare(b.company_name || '') ||
          a.display_name.localeCompare(b.display_name),
        ),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, companyId, requireUser]);

  return { options, loading };
}
