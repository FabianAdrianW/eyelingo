/* Eyelingo Service Worker — bezpieczny dla Supabase.
 *
 * Zasada: cache'ujemy TYLKO statyczny shell z tego samego origin (GET).
 * Wszystko cross-origin (Supabase, jsDelivr CDN, Google Fonts, OpenRouter)
 * oraz każdy nie-GET puszczamy do sieci bez dotykania — auth/API/realtime nietknięte.
 *
 * ── NAPRAWA v2 ────────────────────────────────────────────────────────────
 * Poprzednia wersja przy KAŻDEJ nawigacji robiła:
 *     cache.put('./index.html', odpowiedź)
 * a offline zwracała:
 *     caches.match('./index.html')
 *
 * Skutek: otwarcie app.html zapisywało aplikację mobilną POD KLUCZEM index.html,
 * a przy słabej sieci (albo w zainstalowanym PWA) użytkownik dostawał stronę
 * internetową zamiast aplikacji. Serwis miał dwie różne strony, a cache — jedną szufladę.
 *
 * Teraz każda strona jest cache'owana POD SWOIM WŁASNYM adresem, a fallback
 * offline zwraca tę stronę, o którą użytkownik faktycznie poprosił.
 * ──────────────────────────────────────────────────────────────────────────
 */

const CACHE = 'eyelingo-shell-v2';   // bump wersji => stary, zepsuty cache zostaje wyczyszczony

// Pliki shellu (ścieżki względne — działają też pod /repo/ na GitHub Pages)
const SHELL = [
  './',
  './index.html',
  './app.html',          // aplikacja mobilna — MUSI tu być, to ona jest celem instalacji
  './manifest.json',
  './favicon.ico',
  './icon192.png',
  './icon512.png',
  './apple-touch-icon-180.png'
];

// INSTALL — wrzuć shell do cache i aktywuj od razu
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        // addAll przewraca się w całości, gdy JEDEN plik nie istnieje.
        // Dodajemy pojedynczo — brak np. jednej ikony nie może zablokować instalacji.
        return Promise.all(SHELL.map(function (u) {
          return cache.add(u).catch(function () { /* pomijamy brakujący plik */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { /* instalacja nie może padać przez cache */ })
  );
});

// ACTIVATE — wyczyść stare wersje cache (w tym tę z błędem)
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

  // Nawigacja (otwarcie strony lub aplikacji): sieć najpierw, cache jako zapas offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          // KLUCZOWE: zapisujemy pod adresem TEJ konkretnej strony, nie pod index.html.
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          // Offline: oddaj dokładnie tę stronę, o którą poproszono.
          return caches.match(req).then(function (hit) {
            if (hit) { return hit; }
            // Nie znamy tej strony. Zgadnij po adresie, ale NIGDY nie podawaj
            // strony internetowej komuś, kto otworzył aplikację.
            const wantsApp = url.pathname.indexOf('app.html') !== -1;
            return caches.match(wantsApp ? './app.html' : './index.html');
          });
        })
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
