/* ============ 御膳小册 Yushan - Service Worker 离线缓存 ============ */
var CACHE = 'xc-yushan-v7';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data-dishes.js',
  './data-tips.js',
  './data-quotes.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 导航/HTML 网络优先（断网回退缓存，改版即时生效）；其余资源缓存优先并后台更新。
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var isNav = req.mode === 'navigate' || /\.html?$/i.test(new URL(req.url).pathname);

  if (isNav) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req).then(function (h) { return h || caches.match('./index.html'); }); })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      var refresh = fetch(req).then(function (res) {
        if (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return null; });
      return hit || refresh.then(function (r) { return r || Response.error(); });
    })
  );
});
