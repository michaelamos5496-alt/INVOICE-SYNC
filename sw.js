/* OneDesk service worker — makes the app installable and keeps the shell available when the connection drops.
 * Network first for the app's own files (so a new deploy is always picked up straight away), falling back
 * to the last copy seen. Data calls (Supabase) and other sites are never touched: shop data must always be live. */
const CACHE = 'invsync-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(async () => (await caches.match(req)) ?? (req.mode === 'navigate' ? caches.match('/pages/dashboard.html') : Response.error())),
  );
});
