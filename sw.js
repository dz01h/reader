const CACHE_NAME = 'zen-reader-v4';
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
  './js/tts-worker.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
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
  if (!event.request.url.startsWith('http') || event.request.url.includes('googleapis.com')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(res => {
        if (res && res.status === 200) {
          const cloned = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return res;
      }).catch(() => {});
      return cached || network;
    })
  );
});
