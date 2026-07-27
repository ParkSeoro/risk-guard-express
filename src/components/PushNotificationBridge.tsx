/**
 * Capacitor PushNotifications 수신 + 클릭 라우팅
 * - 네이티브 앱에서만 동작 (웹은 Service Worker /sw.js 가 담당)
 * - 등록 토큰은 device_push_tokens 에 저장 → dispatch-notification-push 가 FCM 발송
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isNativeApp, nativePlatform } from "@/lib/native/platform";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";

type PushData = Record<string, string | undefined>;

function dataFromNotification(n: {
  data?: unknown;
  notification?: { data?: unknown };
}): PushData {
  const raw = (n?.data || n?.notification?.data || {}) as Record<string, unknown>;
  const out: PushData = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = v == null ? undefined : String(v);
  }
  return out;
}

async function upsertDeviceToken(userId: string, token: string) {
  const platform = nativePlatform();
  if (platform === "web") return;
  const { error } = await supabase.from("device_push_tokens" as any).upsert(
    {
      user_id: userId,
      token,
      platform,
      updated_at: new Date().toISOString(),
    } as any,
    { onConflict: "user_id,token" } as any
  );
  if (error && import.meta.env.DEV) {
    console.warn("[push] token upsert failed", error);
  }
}

/**
 * AuthProvider / BrowserRouter 하위에서 한 번만 마운트하세요.
 */
export function PushNotificationBridge() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    if (!isNativeApp() && !Capacitor.isNativePlatform?.()) return;

    let cancelled = false;
    const handles: { remove: () => Promise<void> }[] = [];

    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        const perm = await PushNotifications.checkPermissions();
        if (perm.receive !== "granted") {
          const req = await PushNotifications.requestPermissions();
          if (req.receive !== "granted") return;
        }

        const routeFromData = (data: PushData) => {
          const path = resolveNotificationRoute({
            type: data.type,
            related_type: data.related_type,
            related_id: data.related_id,
            link: data.link || data.url,
            url: data.url,
            project_id: data.project_id,
          });
          navigate(path);
        };

        // 클릭(백그라운드/종료 상태에서 알림 탭)
        handles.push(
          await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
            const data = dataFromNotification(action.notification as any);
            routeFromData(data);
          })
        );

        // 포그라운드 수신 — 인앱에서도 딥링크 가능하도록 저장만 / 필요 시 라우트
        handles.push(
          await PushNotifications.addListener("pushNotificationReceived", (_notification) => {
            // 포그라운드는 NotificationBell realtime 이 갱신. 추가 UI는 생략.
          })
        );

        handles.push(
          await PushNotifications.addListener("registration", async (token) => {
            if (cancelled || !token?.value || !user.id) return;
            await upsertDeviceToken(user.id, token.value);
            registeredFor.current = user.id;
          })
        );

        handles.push(
          await PushNotifications.addListener("registrationError", (err) => {
            console.warn("[push] registrationError", err);
          })
        );

        if (registeredFor.current !== user.id) {
          await PushNotifications.register();
        }
      } catch (e) {
        if (import.meta.env.DEV) console.warn("[push] bridge init failed", e);
      }
    })();

    return () => {
      cancelled = true;
      handles.forEach((h) => {
        try {
          void h.remove();
        } catch {
          /* ignore */
        }
      });
    };
  }, [user?.id, navigate]);

  return null;
}

export default PushNotificationBridge;
