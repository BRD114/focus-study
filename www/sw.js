/* =========================================================================
 * sw.js — 离线缓存（仅 PWA / http 环境生效；APK 内是本地资源，不需要）
 * 策略：先装到本地，之后一直用本地，彻底断网也能用。
 * 升级时改 CACHE 版本号即可让旧缓存失效。
 * ========================================================================= */
const CACHE = 'focus-shell-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/util.js',
  './js/store.js',
  './js/tasks.js',
  './js/todo.js',
  './js/focus.js',
  './js/stats.js',
  './js/settings.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
