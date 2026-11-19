/**
 * Infoplaza aracı sunucusu (Cloudflare Worker)
 *
 * Infoplaza API tarayıcıdan doğrudan çağrılmaya izin vermiyor (CORS).
 * Bu Worker isteği Infoplaza'ya iletir, cevabı uygulamaya geri verir.
 * api_key telefonda değil, burada gizli değişken olarak saklanır.
 *
 * Kurulum: Cloudflare → Workers & Pages → Create → Worker → bu kodu yapıştır → Deploy
 *          Settings → Variables and Secrets → Add → Secret: INFOPLAZA_KEY = <api_key>
 */
const ALLOWED_ORIGINS = ['https://burakaydin99.github.io'];
const ALLOWED_PATHS = /^\/v1\/weather\/(forecast|timeseries\/(point|models))$/;
const CACHE_SECONDS = 600; // aynı istek 10 dk içinde tekrar gelirse kredi harcanmaz

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept',
      'Vary': 'Origin',
    };
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'GET') return json(405, { success: false, message: 'Yalnızca GET' });
    if (!ALLOWED_ORIGINS.includes(origin)) return json(403, { success: false, message: 'Bu adresten erişim izni yok' });

    const url = new URL(req.url);
    if (!ALLOWED_PATHS.test(url.pathname)) return json(404, { success: false, message: 'Bilinmeyen yol' });

    const key = env.INFOPLAZA_KEY || url.searchParams.get('api_key');
    if (!key) return json(401, { success: false, message: 'Worker’da INFOPLAZA_KEY tanımlı değil' });

    const up = new URL('https://api.infoplaza.com' + url.pathname);
    url.searchParams.forEach((v, k) => { if (k !== 'api_key') up.searchParams.set(k, v); });
    up.searchParams.set('api_key', key);

    // Önbellek anahtarı api_key içermesin
    const cacheKey = new Request(url.origin + url.pathname + '?' + [...up.searchParams].filter(([k]) => k !== 'api_key').map(([k, v]) => `${k}=${v}`).join('&'));
    const cache = caches.default;
    let res = await cache.match(cacheKey);
    if (!res) {
      const r = await fetch(up.toString(), { headers: { Accept: 'application/json' } });
      res = new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` } });
      if (r.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
