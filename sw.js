const CACHE_NAME = 'zen-reader-v17';
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
  './js/tts/kokoro-worker.js',
  './js/tts/sherpa.js',
  './js/tts/sherpa-worker.js',
  './lib/sherpa-onnx/sherpa-onnx-tts.js',
  './lib/sherpa-onnx/sherpa-onnx-wasm-main-tts.js',
  './lib/sherpa-onnx/sherpa-onnx-wasm-main-tts.wasm',
  './lib/sherpa-onnx/sherpa-onnx-wasm-main-tts.data'
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

function injectCOOP(res) {
  if (res.type === 'opaque') return res;
  const newHeaders = new Headers(res.headers);
  newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
  newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: newHeaders
  });
}

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
          return injectCOOP(cachedResponse);
        }

        if (isSameOrigin && cachedResponse) {
          fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
          }).catch(() => {});
          return injectCOOP(cachedResponse);
        }

        const networkResponse = await fetch(event.request);
        if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
          cache.put(event.request, networkResponse.clone());
        }
        return injectCOOP(networkResponse);
      } catch (e) {
        return new Response('Network error', { status: 503 });
      }
    })()
  );
});
