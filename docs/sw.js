// Service worker: приложение и просмотренные карты работают без интернета.
const VERSION = 'v2.2.0';
const SHELL = 'shell-' + VERSION;

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/config.js',
  'js/db.js',
  'js/sync.js',
  'js/tracklayer.js',
  'js/native.js',
  'vendor/capacitor/core.js',
  'privacy.html',
  'terms.html',
  'doc.css',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL) await caches.delete(k); // в т.ч. старый кэш карт tiles-v1
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Фрагменты карты кэширует само приложение (IndexedDB), здесь их не трогаем
  if (url.origin !== self.location.origin) return;

  // Файлы приложения: сначала кэш (работает в лесу), обновление в фоне
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      // страницы (privacy.html, terms.html) ищем по своему адресу; корень и неизвестные — это index.html
      const hit = (await cache.match(req, { ignoreSearch: true })) ||
        (req.mode === 'navigate' && url.pathname.endsWith('/') ? await cache.match('./') : null);
      const net = fetch(req).then(r => {
        if (r.ok) cache.put(req, r.clone()).catch(() => {});
        return r;
      }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || (await cache.match('./')) || new Response('Нет сети', { status: 503 });
    })());
  }
  // Остальное (сервер Supabase) — напрямую в сеть
});
