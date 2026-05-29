const CACHE_NAME = 'zen-reader-v36';
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
  './js/tts/webspeech.js',
  './js/tts/matcha.js',
  './js/tts/matcha-worker.js',
  './js/tts/custom-dict.js',
  'https://cdn.jsdelivr.net/npm/pinyin-pro@3.24.2/dist/index.js',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort-wasm-simd-threaded.wasm',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort-wasm-simd.wasm',

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

self.addEventListener('message', async event => {
  if (event.data && event.data.type === 'UPDATE_TTS_DICT' && event.data.payload) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const req = new Request('./js/tts/custom-dict.js');
      const cachedResponse = await cache.match(req);
      if (cachedResponse) {
        let text = await cachedResponse.text();
        const injected = `\nObject.assign(self.ZenTTSCustomDict, ${JSON.stringify(event.data.payload)});`;
        if (!text.includes(injected)) {
            text += injected;
            const newRes = new Response(text, {
                headers: cachedResponse.headers
            });
            await cache.put(req, newRes);
        }
      }
    } catch (e) {
      console.error('Failed to update cache with TTS dict', e);
    }
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCDNHost = url.origin === 'https://cdn.jsdelivr.net';
  const isGitHubReleases = url.hostname === 'github.com' && url.pathname.includes('/releases/download/');
  const isHuggingFace = url.hostname === 'huggingface.co';
  const isModelScope = url.hostname === 'modelscope.cn';
  const isLib = isSameOrigin && url.pathname.includes('/lib/');

  if (!isSameOrigin && !isCDNHost && !isGitHubReleases && !isHuggingFace && !isModelScope) return;

  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(event.request);

        if ((isCDNHost || isGitHubReleases || isHuggingFace || isModelScope || isLib) && cachedResponse) {
          return cachedResponse;
        }

        if (isSameOrigin && cachedResponse) {
          fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
              if (url.pathname.endsWith('/js/tts/custom-dict.js')) {
                self.clients.matchAll().then(clients => {
                  clients.forEach(client => client.postMessage({ type: 'REQUEST_TTS_SYNC' }));
                });
              }
            }
          }).catch(() => {});
          return cachedResponse;
        }

        const networkResponse = await fetch(event.request);
        if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
          cache.put(event.request, networkResponse.clone());
          if (url.pathname.endsWith('/js/tts/custom-dict.js')) {
            self.clients.matchAll().then(clients => {
              clients.forEach(client => client.postMessage({ type: 'REQUEST_TTS_SYNC' }));
            });
          }
        }
        return networkResponse;
      } catch (e) {
        return new Response('Network error', { status: 503 });
      }
    })()
  );
});
