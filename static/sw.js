// 네트워크 우선, 실패 시 캐시(현장 지하·음영지역 대비)
const C = 'tbm-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone(); caches.open(C).then((c) => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
