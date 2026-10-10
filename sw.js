// Service worker: оболочка приложения открывается и без сети.
// Сначала сеть, при неудаче копия из кэша. Запросы к серверу доски не трогаем.
const CACHE = 'desk-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/board.js', 'js/api.js', 'js/config.js', 'js/cork.js', 'js/extras.js', 'js/history.js',
  'js/icons.js', 'js/live.js', 'js/merge.js', 'js/pwa.js', 'js/ui.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];
// чужие адреса, которые можно держать в кэше: библиотека и шрифты
const CDN = ['https://cdn.jsdelivr.net/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === location.origin;
  if (!own && !CDN.some((p) => req.url.startsWith(p))) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(own && req.mode === 'navigate' ? 'index.html' : req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(own && req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: own });
      if (hit) return hit;
      throw err;
    }
  })());
});
