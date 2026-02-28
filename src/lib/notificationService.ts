import { supabase } from '@/integrations/supabase/client';

interface SendNotificationParams {
  user_id: string;
  title: string;
  message: string;
  type: string;
  related_id?: string;
  related_type?: string;
  project_id?: string;
}

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
