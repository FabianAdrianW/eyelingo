// ═══════════════════════════════════════════════════════════════════════════
// NAGROBEK — ten plik istnieje wyłącznie po to, żeby SIĘ SAM USUNĄĆ.
//
// Kontekst: przez pomyłkę zarejestrowałem tu drugi service worker, na tym samym
// zasięgu co działający już `service-worker.js`. Dwa service workery na jednym
// zasięgu wypierają się nawzajem — ten przejął sterowanie i zepsuł aplikację
// mobilną.
//
// Samo skasowanie pliku z repozytorium NIE WYSTARCZY: service worker raz
// zarejestrowany żyje w przeglądarce użytkownika dalej. Dlatego zamiast usuwać,
// podmieniamy go na wersję, która wyrejestrowuje samą siebie, czyści WYŁĄCZNIE
// swój własny cache i przeładowuje otwarte karty — po czym sterowanie wraca do
// `service-worker.js`.
//
// Ten plik można usunąć z repozytorium po kilku tygodniach, gdy przeglądarki
// zdążą go pobrać i wykonać.
// ═══════════════════════════════════════════════════════════════════════════

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      // Kasujemy TYLKO nasz cache. Cache'y należące do service-worker.js
      // zostają nietknięte — nie powtarzamy tego samego błędu drugi raz.
      await caches.delete('eyelingo-v1');
    } catch (e) {}

    try {
      await self.registration.unregister();
    } catch (e) {}

    // Przeładuj otwarte karty, żeby przejął je z powrotem service-worker.js.
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    } catch (e) {}
  })());
});

// Nic nie przechwytujemy — wszystko idzie prosto do sieci.
self.addEventListener('fetch', () => {});
