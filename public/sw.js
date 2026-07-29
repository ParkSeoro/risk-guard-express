// 안전관리시스템 Service Worker (push notifications)
// Handles background push delivery, click-through routing, and subscription refresh.

const VAPID_PUBLIC_KEY =
  "BOqKHOu6DeJI632KJLVv5hy2l8pw6rg485UrCxGFath52Bwn0Dajj8dgNQO3GiiAFMCkcxhY56U9pRQAoyNeNrA";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "알림", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "안전관리시스템";
  const severity = (data.severity || "").toString().toLowerCase();
  const isHigh = severity === "high" || severity === "critical" || severity === "danger";
  const options = {
    body: data.body || data.message || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || data.related_id || "default",
    renotify: true,
    requireInteraction: isHigh,
    vibrate: isHigh ? [300, 120, 300, 120, 300] : [180, 80, 180],
    timestamp: Date.now(),
    data: {
      url: data.url || data.link || "/app/worker/alerts",
      related_id: data.related_id || null,
      related_type: data.related_type || null,
      project_id: data.project_id || null,
      type: data.type || null,
      severity: data.severity || null,
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app/worker/alerts";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          try { c.navigate(url); } catch (_) {}
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// Auto re-subscribe when the browser rotates the push subscription (Chrome/Edge fire this).
// Best-effort: notify any open client so it can persist the new endpoint via authenticated Supabase call.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
        const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const c of clientsList) {
          c.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED", subscription: newSub.toJSON() });
        }
      } catch (e) {
        // If resubscription fails, the client will re-attempt on next login via PushNotificationBridge.
      }
    })(),
  );
});
