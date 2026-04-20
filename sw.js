const CACHE_NAME = 'zen-reader-v1';
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
  './js/app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Clear old caches
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(cacheName => {
          return cacheName !== CACHE_NAME;
        }).map(cacheName => {
          return caches.delete(cacheName);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // 僅攔截 GET 請求
  if (event.request.method !== 'GET') return;
  // 避免攔截特殊協議 (chrome-extension:// 等) 或 Google API
  if (!event.request.url.startsWith('http') || event.request.url.includes('googleapis.com')) return;

  // Stale-While-Revalidate (SWR) 策略：
  // 優先從快取拿資料（回應最快），同時在背景向伺服器更新快取內容
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        // 若伺服器回應正常，則更新快取
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(err => {
        console.log('Background fetch failed:', err);
      });

      // 如果有快取，立即回傳；否則等待網路請求
      return cachedResponse || fetchPromise;
    })
  );
});
