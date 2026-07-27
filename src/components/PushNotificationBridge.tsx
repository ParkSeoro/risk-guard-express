// 네이티브(Capacitor) 환경에서만 동작하는 푸시 브리지.
// 웹은 기존 Web Push(VAPID) + push_subscriptions 로 처리되므로 아무 것도 하지 않는다.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Capacitor } from '@capacitor/core';
import { resolveNotificationRoute } from '@/lib/notificationRoutes';

export default function PushNotificationBridge() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    if (!Capacitor?.isNativePlatform?.()) return;

    let cleanup: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const mod: any = await import('@capacitor/push-notifications');
        const PushNotifications = mod.PushNotifications;
        if (!PushNotifications) return;

        const perm = await PushNotifications.checkPermissions();
        let status = perm.receive;
        if (status === 'prompt' || status === 'prompt-with-rationale') {
          const req = await PushNotifications.requestPermissions();
          status = req.receive;
        }
        if (status !== 'granted') return;
        if (cancelled) return;

        await PushNotifications.register();

        const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';

        const regHandle = await PushNotifications.addListener(
          'registration',
          async (t: { value: string }) => {
            try {
              await supabase.from('device_push_tokens' as any).upsert(
                {
                  user_id: user.id,
                  token: t.value,
                  platform,
                  last_used_at: new Date().toISOString(),
                },
                { onConflict: 'user_id,token' },
              );
            } catch (e) {
              console.warn('[PushBridge] token upsert failed', e);
            }
          },
        );

        const errHandle = await PushNotifications.addListener(
          'registrationError',
          (err: any) => console.warn('[PushBridge] registration error', err),
        );

        const tapHandle = await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (action: any) => {
            const data = action?.notification?.data || {};
            const route = resolveNotificationRoute({
              link: data.link || data.url,
              type: data.type,
              related_type: data.related_type,
              related_id: data.related_id,
              project_id: data.project_id,
            });
            if (route) navigate(route);
          },
        );

        cleanup = () => {
          regHandle?.remove?.();
          errHandle?.remove?.();
          tapHandle?.remove?.();
        };
      } catch (e) {
        console.warn('[PushBridge] init failed', e);
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [user, navigate]);

  return null;
}
