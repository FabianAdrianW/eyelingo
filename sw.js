// Eyelingo — service worker.
// Rola: umozliwic instalacje PWA i podac powloke aplikacji, gdy siec jest slaba.
// NIE buforujemy danych uzytkownika ani odpowiedzi Supabase — te musza byc zawsze swieze,
// inaczej postepy SRS rozjechalyby sie miedzy urzadzeniami.

const CACHE = 'eyelingo-v1';
const SHELL = [
  'app.html',
  'manifest.json',
  'icon192.png',
  'icon512.png',
  'eyelingo-mark.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll przewraca sie, gdy JEDEN plik nie istnieje — dodajemy pojedynczo,
      // zeby brak np. jednej ikony nie zablokowal calej instalacji.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
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
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Wszystko, co dotyczy danych i zewnetrznych uslug — prosto z sieci, bez cache.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/rest/') || url.pathname.includes('/auth/') ||
      url.pathname.includes('/functions/')) return;

  // Powloka: siec pierwsza (zeby aktualizacje wchodzily od razu), cache jako zapas offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('app.html')))
  );
});
