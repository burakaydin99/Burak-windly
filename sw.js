// Uygulama kabuğunu önbelleğe alır; hava durumu API çağrıları her zaman ağdan gelir.
const CACHE = 'ruzgar-v17';
const SHELL = ['./', 'index.html', 'css/style.css?v=17', 'js/app.js?v=17', 'icon.svg', 'manifest.webmanifest',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || /open-meteo\.com|arcgisonline\.com|workers\.dev/.test(url.host) || url.pathname.includes("/data/infoplaza/")) return;
  // Ağ öncelikli, çevrimdışıyken önbellek
  e.respondWith(
    // Site dosyaları her seferinde sunucuya doğrulatılır (eski sürüm takılı kalmasın)
    fetch(url.origin === location.origin ? new Request(e.request.url, { cache: 'no-cache' }) : e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
