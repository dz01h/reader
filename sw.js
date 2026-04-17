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

  // Network First, fallback to cache 策略：
  // 永遠優先向伺服器拿最新代碼，方便開發更新；斷網時才拿快取
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 若伺服器回應正常，則順便把最新版存進快取
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // 斷網或伺服器連不上，從快取中提取
        return caches.match(event.request);
      })
  );
});
