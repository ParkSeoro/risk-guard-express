// 안전관리시스템 Service Worker (push notifications)
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "알림", body: event.data?.text() || "" }; }
  const title = data.title || "안전관리시스템";
  const options = {
    body: data.body || data.message || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || data.related_id || "default",
    data: { url: data.url || "/m/alerts", related_id: data.related_id, related_type: data.related_type },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/m/alerts";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
      return self.clients.openWindow(url);
    })
  );
});
