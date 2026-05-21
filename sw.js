const CACHE_NAME = 'zen-reader-v15';
const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './manifest.json',
  './icon.svg',
  './js/db.js',
  './js/i18n.js',
  './js/engine.js',
  './js/settings.js',
  './js/file-explorer.js',
  './js/zip-handler.js',
  './js/gdrive.js',
  './js/app.js',
  './js/tts.js',
  './js/tts/chunks.js',
  './js/tts/piper.js',
  './js/tts/piper-worker.js',
  './js/tts/webspeech.js',
  './js/tts/kokoro.js',
  './js/tts/kokoro-worker.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCDNHost = url.origin === 'https://cdn.jsdelivr.net';

  if (!isSameOrigin && !isCDNHost) return;

  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(event.request);

        // 對於 CDN 資源，採 Cache-First 策略以確保穩定與離線使用
        if (isCDNHost && cachedResponse) {
          return cachedResponse;
        }

        // 對於同源資源，採 Stale-While-Revalidate 策略
        if (isSameOrigin && cachedResponse) {
          fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
          }).catch(() => {});
          return cachedResponse;
        }

        const networkResponse = await fetch(event.request);
        if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
          // status 0 代表 opaque response (跨網域)，我們也嘗試快取它
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (e) {
        return new Response('Network error', { status: 503 });
      }
    })()
  );
});
