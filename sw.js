// Uygulama kabuğunu önbelleğe alır; hava durumu API çağrıları her zaman ağdan gelir.
const CACHE = 'ruzgar-v1';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'icon.svg', 'manifest.webmanifest',
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
  if (e.request.method !== 'GET' || /open-meteo\.com|windy\.com|basemaps\.cartocdn\.com/.test(url.host)) return;
  // Ağ öncelikli, çevrimdışıyken önbellek
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
