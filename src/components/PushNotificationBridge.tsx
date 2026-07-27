// 통합 푸시 브리지.
// - 웹: 사용자가 이미 알림 권한을 허용해둔 경우 로그인 시마다 조용히 재구독하여 토큰을 최신화한다.
//        (권한이 'default'면 UX 방해를 피해 아무것도 하지 않는다 - Settings 화면에서 명시적으로 허용해야 함.)
// - 네이티브(Capacitor): FCM/APNs 토큰을 device_push_tokens에 upsert 하고 알림 탭 시 라우팅.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Capacitor } from '@capacitor/core';
import { resolveNotificationRoute } from '@/lib/notificationRoutes';
import { isPushSupported, subscribeToPush } from '@/lib/pushSubscription';

export default function PushNotificationBridge() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // ---------- WEB: silent re-subscribe on login when permission is already granted ----------
  useEffect(() => {
    if (!user) return;
    if (Capacitor?.isNativePlatform?.()) return;
    if (!isPushSupported()) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    let cancelled = false;
    (async () => {
      try {
        const r = await subscribeToPush(user.id);
        if (!cancelled && !r.ok) console.warn('[PushBridge/web] resubscribe skipped:', r.reason);
      } catch (e) {
        console.warn('[PushBridge/web] resubscribe failed', e);
      }
    })();

    // Handle SW-initiated resubscription (pushsubscriptionchange) — persist new endpoint.
    const onMsg = async (event: MessageEvent) => {
      if ((event.data as any)?.type !== 'PUSH_SUBSCRIPTION_CHANGED') return;
      try {
        await subscribeToPush(user.id);
      } catch (e) {
        console.warn('[PushBridge/web] SW resubscribe persist failed', e);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);

    return () => {
      cancelled = true;
      navigator.serviceWorker?.removeEventListener('message', onMsg);
    };
  }, [user]);

  // ---------- NATIVE: Capacitor push registration ----------
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
                  user_agent: navigator.userAgent.slice(0, 200),
                  last_used_at: new Date().toISOString(),
                },
                { onConflict: 'user_id,token' },
              );
            } catch (e) {
              console.warn('[PushBridge/native] token upsert failed', e);
            }
          },
        );

        const errHandle = await PushNotifications.addListener(
          'registrationError',
          (err: any) => console.warn('[PushBridge/native] registration error', err),
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
        console.warn('[PushBridge/native] init failed', e);
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [user, navigate]);

  return null;
}
