/* Eyelingo Service Worker — minimalny, bezpieczny dla Supabase.
 * Zasada: cache'ujemy TYLKO statyczny shell z tego samego origin (GET).
 * Wszystko cross-origin (Supabase, jsDelivr CDN, Google Fonts, OpenRouter)
 * oraz każdy nie-GET puszczamy do sieci bez dotykania — auth/API/realtime nietknięte.
 */

const CACHE = 'eyelingo-shell-v1';

// Pliki shellu (ścieżki względne — działają też pod /repo/ na GitHub Pages)
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico'
];

// INSTALL — wrzuć shell do cache i aktywuj od razu
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { /* brak pliku w SHELL nie blokuje instalacji */ })
  );
});

// ACTIVATE — wyczyść stare wersje cache
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE) { return caches.delete(k); }
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// FETCH
self.addEventListener('fetch', function (event) {
  const req = event.request;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Tylko GET i tylko ten sam origin. Resztę zostawiamy przeglądarce → sieć.
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Nawigacja (otwarcie apki): sieć najpierw, cache jako fallback offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
          return res;
        })
        .catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  // Statyki (ikony, manifest, favicon): cache najpierw, sieć w tle.
  event.respondWith(
    caches.match(req).then(function (cached) {
      const network = fetch(req)
        .then(function (res) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () { return cached; });
      return cached || network;
    })
  );
});
