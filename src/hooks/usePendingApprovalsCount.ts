import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

function asPendingCount(data: unknown): number {
  if (typeof data === 'number' && Number.isFinite(data)) return Math.max(0, Math.trunc(data));
  if (typeof data === 'string' && data.trim() !== '') {
    const n = Number(data);
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  return 0;
}

/**
 * Returns count of pending approvals where current user is the next approver,
 * across all entity types (risk_assessment, work_plan, work_permit, etc.).
 * Uses count_my_pending_entity_approvals (same filters as the inbox RPC).
 * Polls every 60s and refreshes on window focus.
 */
export function usePendingApprovalsCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) { setCount(0); return; }
    let cancelled = false;

    const load = async () => {
      try {
        const { data } = await supabase.rpc('count_my_pending_entity_approvals');
        if (!cancelled) setCount(asPendingCount(data));
      } catch {
        if (!cancelled) setCount(0);
      }
    };

    load();
    const t = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [user]);

  return count;
}

export { asPendingCount };
