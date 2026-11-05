/* ========================================================================== *
 * BUYBUDDY service worker — makes the app installable and keeps the shell
 * usable on a bad Lagos connection.
 *
 * Deliberately conservative:
 *   • never caches /api responses (prices, stock and order state must be fresh)
 *   • navigations are network-first with a cached shell as the offline fallback
 *   • hashed build assets are cache-first (they can never change under a name)
 * ========================================================================== */

const VERSION = 'buybuddy-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

const SHELL_FILES = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1. Live data — never cached, never served stale.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads')) return;

  // 2. Page navigations — network first, fall back to the cached shell so the
  //    app still opens (and shows its offline state) when the network is down.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put('/', copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match('/').then((hit) => hit || new Response(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>BUYBUDDY — offline</title><body style="font-family:system-ui;background:#F5F7F4;color:#176B55;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px"><div><h1 style="font-size:22px">You are offline</h1><p style="color:#4A5A54">BUYBUDDY needs a connection to show live prices and order status. Reconnect and try again.</p></div></body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )))
    );
    return;
  }

  // 3. Hashed build output + icons — cache first, then network.
  const isHashedAsset = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest';
  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(ASSETS).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      }).catch(() => hit))
    );
  }
});
