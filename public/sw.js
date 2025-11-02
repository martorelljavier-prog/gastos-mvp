// Minimal service worker for offline support
const CACHE_NAME = 'gastos-mvp-v1';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(['/','/index.html'])));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k === CACHE_NAME ? null : caches.delete(k)))));
  self.clients.claim();
});
