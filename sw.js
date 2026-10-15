// Service worker: оболочка приложения открывается и без сети.
// Свои файлы: сеть без HTTP-кэша (свежая версия сразу после выкладки), при сбое, ошибке или долгом ответе копия из кэша.
// Библиотека и шрифты с версией в адресе: сразу из кэша. Запросы к серверу доски не трогаем.
const CACHE = 'desk-v34';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/board.js', 'js/api.js', 'js/config.js', 'js/cork.js', 'js/extras.js', 'js/history.js',
  'js/icons.js', 'js/live.js', 'js/merge.js', 'js/pwa.js', 'js/ui.js', 'js/clip.js', 'js/timer.js', 'js/undo.js', 'js/transfer.js', 'js/news.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch.png',
];
const CDN = ['https://cdn.jsdelivr.net/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];
const TIMEOUT = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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
  e.respondWith(own ? fresh(req) : cached(req));
});

// Чужое с версией в адресе не меняется: кэш, иначе сеть
async function cached(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

// Своё: сеть мимо HTTP-кэша; если сети нет или она тянет дольше 3 секунд, отдаём копию
async function fresh(req) {
  const cache = await caches.open(CACHE);
  const key = req.mode === 'navigate' ? 'index.html' : req;
  const net = fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  const timeout = new Promise((r) => setTimeout(r, TIMEOUT));
  const first = await Promise.race([net.catch(() => null), timeout]);
  if (first?.ok) return first;
  // сеть ответила ошибкой (502 и т. п.) или молчит: лучше прошлая копия, чем пустой экран
  const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
  return hit || first || net;
}
