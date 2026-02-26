import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useAuditLog() {
  const { user, profile } = useAuth();

  const log = async (action: string, targetType: string, targetId: string, projectId?: string, details?: Record<string, unknown>) => {
    if (!user) return;
    await supabase.from('audit_logs').insert([{
      user_id: user.id,
      user_name: profile?.display_name || user.email || '',
      action,
      target_type: targetType,
      target_id: targetId,
      project_id: projectId || null,
      details: (details || {}) as any,
    }]);
  };

  return { log };
}
