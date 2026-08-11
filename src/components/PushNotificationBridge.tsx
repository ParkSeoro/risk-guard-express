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
import { isIosNativeAlarmAvailable, requestIosCriticalAlerts } from '@/lib/alarmVolume';
import { playDangerAlarm } from '@/lib/tts';

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

  // ---------- NATIVE: register only when already granted (prompt lives on /native-permissions) ----------
  useEffect(() => {
    if (!user?.id) return;
    if (!Capacitor?.isNativePlatform?.()) return;

    let cleanup: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const mod: any = await import('@capacitor/push-notifications');
        const PushNotifications = mod.PushNotifications;
        if (!PushNotifications) return;

        const perm = await PushNotifications.checkPermissions();
        // Do NOT auto-request here — that raced with GPS onboarding and caused permission loops.
        if (perm.receive !== 'granted') return;
        if (cancelled) return;

        const platformResolved = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';

        // Android 8+: custom channels so FCM siren / high priority actually apply
        if (platformResolved === 'android') {
          try {
            await PushNotifications.createChannel({
              id: 'safenex_alarms',
              name: '안전 경보',
              description: '위험구역·긴급 알림 (사이렌)',
              importance: 5,
              sound: 'siren',
              vibration: true,
              visibility: 1,
            });
            await PushNotifications.createChannel({
              id: 'safenex_default',
              name: '일반 알림',
              description: '승인·업무 알림',
              importance: 4,
              sound: 'default',
              vibration: true,
              visibility: 1,
            });
          } catch (e) {
            console.warn('[PushBridge/native] createChannel skipped', e);
          }
        }

        await PushNotifications.register();

        // iOS Critical Alerts (Apple entitlement + Info.plist flag required)
        if (platformResolved === 'ios' && isIosNativeAlarmAvailable()) {
          try {
            const crit = await requestIosCriticalAlerts();
            if (crit.criticalAlertSetting === 'enabled') {
              console.info('[PushBridge/native] Critical Alerts enabled');
            } else if (crit.criticalAlertsEnabledInPlist) {
              console.warn(
                '[PushBridge/native] Critical Alerts requested but not enabled:',
                crit.criticalAlertSetting,
                crit.note,
              );
            }
          } catch (e) {
            console.warn('[PushBridge/native] Critical Alerts request skipped', e);
          }
        }

        const regHandle = await PushNotifications.addListener(
          'registration',
          async (t: { value: string }) => {
            try {
              const { error } = await supabase.from('device_push_tokens' as any).upsert(
                {
                  user_id: user!.id,
                  token: t.value,
                  platform: platformResolved,
                  user_agent: navigator.userAgent.slice(0, 200),
                  last_used_at: new Date().toISOString(),
                },
                { onConflict: 'user_id,token' },
              );
              if (error) {
                console.error('[PushBridge/native] token upsert error', error);
              }
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
            const route = resolveNotificationRoute(
              {
                link: data.link || data.url,
                type: data.type,
                related_type: data.related_type,
                related_id: data.related_id,
                project_id: data.project_id,
              },
              { mobileShell: true },
            );
            if (route) navigate(route);
          },
        );

        // Foreground: danger push must siren even when user is on another screen
        // (tap handler only runs after notification is opened).
        const receivedHandle = await PushNotifications.addListener(
          'pushNotificationReceived',
          (notification: any) => {
            const data = notification?.data || {};
            if (data.type === 'danger_zone_entry') {
              void playDangerAlarm();
            }
          },
        );

        cleanup = () => {
          regHandle?.remove?.();
          errHandle?.remove?.();
          tapHandle?.remove?.();
          receivedHandle?.remove?.();
        };
      } catch (e) {
        console.warn('[PushBridge/native] init failed', e);
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [user?.id, navigate]);

  return null;
}
