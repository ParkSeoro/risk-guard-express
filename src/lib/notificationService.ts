import { supabase } from '@/integrations/supabase/client';
import { ADMIN_PROJECT_ROLES } from '@/lib/permissions';

interface SendNotificationParams {
  user_id: string;
  title: string;
  message: string;
  type: string;
  related_id?: string;
  related_type?: string;
  project_id?: string;
}

export type NotifyProjectRolesParams = {
  projectId: string;
  title: string;
  message: string;
  type?: string;
  link?: string | null;
  companyId?: string | null;
  excludeUserId?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  severity?: string | null;
  roles?: string[];
  positions?: string[] | null;
};

/**
 * Send a notification (in-app + email via edge function).
 * Falls back to direct DB insert if edge function fails.
 */
export async function sendNotification(params: SendNotificationParams): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('send-notification-email', {
      body: params,
    });
    if (error) {
      if (import.meta.env.DEV) console.warn('Edge function failed, falling back to direct insert:', error);
      // Fallback: insert notification directly
      await supabase.from('notifications').insert([{
        user_id: params.user_id,
        title: params.title,
        message: params.message || '',
        type: params.type || 'approval',
        related_id: params.related_id,
        related_type: params.related_type,
        project_id: params.project_id,
      }]);
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('Notification send error, using fallback:', err);
    await supabase.from('notifications').insert([{
      user_id: params.user_id,
      title: params.title,
      message: params.message || '',
      type: params.type || 'approval',
      related_id: params.related_id,
      related_type: params.related_type,
      project_id: params.project_id,
    }]);
  }
}

/** Role-based fan-out via SECURITY DEFINER router (bypasses notifications RLS). */
export async function notifyProjectRoles(params: NotifyProjectRolesParams): Promise<number> {
  const { data, error } = await supabase.rpc('notify_project_roles', {
    _project_id: params.projectId,
    _roles: params.roles?.length ? params.roles : [...ADMIN_PROJECT_ROLES],
    _title: params.title,
    _message: params.message,
    _type: params.type || 'task_assigned',
    _link: params.link ?? null,
    _company_id: params.companyId ?? null,
    _exclude_user_id: params.excludeUserId ?? null,
    _related_type: params.relatedType ?? null,
    _related_id: params.relatedId ?? null,
    _severity: params.severity ?? null,
    _positions: params.positions ?? null,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data) || 0;
}

export async function notifyMasters(params: {
  title: string;
  message: string;
  type?: string;
  link?: string | null;
  projectId?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  severity?: string | null;
}): Promise<number> {
  const { data, error } = await supabase.rpc('notify_masters', {
    _title: params.title,
    _message: params.message,
    _type: params.type || 'warning',
    _link: params.link ?? null,
    _project_id: params.projectId ?? null,
    _related_type: params.relatedType ?? null,
    _related_id: params.relatedId ?? null,
    _severity: params.severity ?? null,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data) || 0;
}
