/* Rüzgar Takip — kayıtlı bölgeler için saatlik rüzgar / hamle / yağış / sıcaklık.
 * Veri: Open-Meteo (anahtarsız, canlı) — Windy'nin de kullandığı GFS / ECMWF / ICON modelleri.
 */
(() => {
  'use strict';

  // ---------- Kalıcı ayarlar ----------
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* yoksay */ } },
  };

  const DEFAULT_LOCS = [
    { id: 'atasehir', name: 'Ataşehir', lat: 40.9923, lon: 29.1244, tz: 'Europe/Istanbul' },
    { id: 'kopru-15-temmuz', name: '1.Köprü', lat: 41.0455, lon: 29.0340, tz: 'Europe/Istanbul', bridge: true },   // 15 Temmuz Şehitler
    { id: 'kopru-fsm', name: '2.Köprü', lat: 41.0912, lon: 29.0612, tz: 'Europe/Istanbul', bridge: true },           // Fatih Sultan Mehmet
  ];

  const MODELS = [
    { id: 'gfs',   label: 'GFS',   om: 'gfs_seamless' },
    { id: 'ecmwf', label: 'ECMWF', om: 'ecmwf_ifs025' },
    { id: 'icon',  label: 'ICON',  om: 'icon_seamless' },
  ];
  const FORECAST_DAYS = 7;

  const state = {
    locs: store.get('locs', DEFAULT_LOCS),
    sel: store.get('sel', null),
    model: store.get('model', 'gfs'),
    unit: store.get('unit', 'kmh'),
    step: store.get('step', 3),
    source: store.get('source', 'openmeteo'),
    ipKey: store.get('ipKey', ''),
    ipProxy: store.get('ipProxy', ''),
    mapLayer: store.get('mapLayer', 'dark'),
    motor: store.get('motor', false),
    motorWarn: store.get('motorWarn', 40),   // hamle km/s: dikkat
    motorRisk: store.get('motorRisk', 55),   // hamle km/s: riskli
    rows: [],          // seçili bölgenin tüm satırları (7 gün)
    days: [],          // [{key, rows}]
    dayKey: null,      // gösterilen gün (null = bugün)
    focusT: null,      // pusula / işaretlerde gösterilen zaman (null = şimdi)
    picking: false,
  };
  // Sonradan eklenen varsayılan bölgeler: listede (3 km içinde) yoksa bir kereye mahsus ekle
  if (!store.get('seeded-v2', false)) {
    // Eski adı yeni adla değiştir
    for (const l of state.locs) if (l.id === 'kopru-15-temmuz' || l.name === '15 Temmuz Köprüsü') l.name = '1.Köprü';
    for (const d of DEFAULT_LOCS) {
      const near = state.locs.some(l => Math.hypot(l.lat - d.lat, (l.lon - d.lon) * 0.75) < 0.02);
      if (!near) state.locs.push({ ...d });
    }
    store.set('seeded-v2', true);
    store.set('locs', state.locs);
  }
  // Köprü modu: varsayılan köprü noktalarına (2 km içinde) köprü işareti koy (bir kez)
  if (!store.get('seeded-bridge', false)) {
    for (const l of state.locs) {
      if (DEFAULT_LOCS.some(d => d.bridge && Math.hypot(l.lat - d.lat, (l.lon - d.lon) * 0.75) < 0.02)) l.bridge = true;
    }
    store.set('seeded-bridge', true);
    store.set('locs', state.locs);
  }
  if (!state.locs.find(l => l.id === state.sel)) state.sel = state.locs[0]?.id ?? null;

  const $ = s => document.querySelector(s);
  const el = (tag, attrs = {}, html) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    if (html != null) e.innerHTML = html;
    return e;
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const curLoc = () => state.locs.find(l => l.id === state.sel);
  const saveLocs = () => { store.set('locs', state.locs); store.set('sel', state.sel); };

  // ---------- Zaman yardımcıları (bölgenin saat dilimine göre) ----------
  const fmtCache = {};
  function tparts(ms, tz) {
    const key = tz || 'local';
    const f = fmtCache[key] ||= new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    });
    const p = {};
    for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: p.weekday, key: `${p.year}-${p.month}-${p.day}` };
  }
  const TR_DAY = { Mon: 'Pazartesi', Tue: 'Salı', Wed: 'Çarşamba', Thu: 'Perşembe', Fri: 'Cuma', Sat: 'Cumartesi', Sun: 'Pazar' };
  const TR_MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const hhmm = (ms, tz) => { const p = tparts(ms, tz); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; };

  // Gün doğumu / batımı (NOAA sunrise equation)
  function sunTimes(ms, lat, lon) {
    const rad = Math.PI / 180;
    const jd = ms / 864e5 + 2440587.5;
    const n = Math.round(jd - 2451545.0009 + lon / 360);
    const Js = 2451545.0009 - lon / 360 + n;
    const M = (357.5291 + 0.98560028 * (Js - 2451545)) % 360;
    const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    const L = (M + C + 180 + 102.9372) % 360;
    const Jt = Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
    const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
    const cosw = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
    if (cosw > 1 || cosw < -1) return null;
    const w = Math.acos(cosw) / rad;
    const toMs = j => (j - 2440587.5) * 864e5;
    return { rise: toMs(Jt - w / 360), set: toMs(Jt + w / 360) };
  }

  // ---------- Birimler ve renkler ----------
  const BFT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  function windVal(kmh) {
    if (kmh == null || isNaN(kmh)) return '–';
    let v;
    switch (state.unit) {
      case 'kt': v = kmh / 1.852; break;
      case 'ms': v = kmh / 3.6; break;
      case 'bft': { const i = BFT.findIndex(t => kmh < t); return String(i === -1 ? 12 : i); }
      default: v = kmh;
    }
    return v < 10 ? v.toFixed(1) : Math.round(v).toString();
  }
  const unitLabel = () => ({ kmh: 'km/s', kt: 'knot', ms: 'm/sn', bft: 'Bft' })[state.unit];

  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function lerpColor(stops, v) {
    if (v == null || isNaN(v)) return 'transparent';
    if (v <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      const [v1, c1] = stops[i];
      if (v <= v1) {
        const [v0, c0] = stops[i - 1];
        const t = (v - v0) / (v1 - v0);
        const a = hex(c0), b = hex(c1);
        return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * t)).join(',')})`;
      }
    }
    return stops[stops.length - 1][1];
  }
  // km/s cinsinden, Windy/Windguru benzeri skala
  const WIND_STOPS = [
    [0, '#5b7fb8'], [6, '#5a8fc4'], [11, '#4f9fc0'], [16, '#39b0a0'], [21, '#4cc46c'],
    [28, '#97d84a'], [35, '#e3e44a'], [43, '#f2b63f'], [52, '#ec7a3c'], [62, '#d9483f'],
    [75, '#c23a72'], [90, '#9440a8'], [110, '#6a3fa0'],
  ];
  const TEMP_STOPS = [
    [-15, '#9f7fd0'], [-5, '#7aa3e0'], [0, '#8fc9e8'], [5, '#a8dcc8'], [10, '#d6e7a0'],
    [15, '#f3dc7a'], [20, '#f3bf5c'], [25, '#f09a4a'], [30, '#e86a3e'], [35, '#d44440'], [42, '#a8304f'],
  ];
  const windColor = kmh => lerpColor(WIND_STOPS, kmh);
  const tempColor = c => lerpColor(TEMP_STOPS, c);

  // ---------- İkonlar ----------
  const SVG = {
    sun: '<g fill="#ffd34d" stroke="#ffd34d" stroke-width="2" stroke-linecap="round"><circle cx="16" cy="14" r="5"/><path d="M16 4v2.5M16 21.5V24M6 14h2.5M23.5 14H26M8.9 6.9l1.8 1.8M21.3 19.3l1.8 1.8M8.9 21.1l1.8-1.8M21.3 8.7l1.8-1.8"/></g>',
    sunSmall: '<g fill="#ffd34d" stroke="#ffd34d" stroke-width="1.8" stroke-linecap="round"><circle cx="21" cy="11" r="4"/><path d="M21 3.5v2M21 16.5v2M13.5 11h2M26.5 11h2M15.7 5.7l1.4 1.4M24.9 14.9l1.4 1.4M15.7 16.3l1.4-1.4M24.9 7.1l1.4-1.4"/></g>',
    moon: '<path d="M20 5a9 9 0 1 0 8 13 7.5 7.5 0 0 1-8-13z" fill="#4da3ff"/>',
    moonSmall: '<path d="M22 4a6 6 0 1 0 6 8.5 5 5 0 0 1-6-8.5z" fill="#4da3ff"/>',
    cloud: (y = 0, c = '#fff') => `<path transform="translate(0 ${y})" d="M9 26h15a5 5 0 0 0 .6-9.96A7 7 0 0 0 11.2 15 5.5 5.5 0 0 0 9 26z" fill="${c}"/>`,
    rain: n => [10, 15, 20].slice(0, n).map((x, i) => `<path d="M${x + 1} ${i % 2 ? 27 : 26.5}l-1.5 3.5" stroke="#4da3ff" stroke-width="2" stroke-linecap="round"/>`).join(''),
  };
  function weatherIcon(r) {
    const night = !r.day;
    const cl = r.cloud ?? 0;
    const p = r.precipH ?? 0;
    let s;
    if (p >= 0.1) {
      const n = p >= 2 ? 3 : p >= 0.6 ? 2 : 1;
      s = (cl < 70 ? (night ? SVG.moonSmall : SVG.sunSmall) : '') + SVG.cloud(-4, cl >= 70 ? '#c7d0d9' : '#fff') + SVG.rain(n);
    } else if (cl < 20) s = night ? SVG.moon : SVG.sun;
    else if (cl < 75) s = (night ? SVG.moonSmall : SVG.sunSmall) + SVG.cloud();
    else s = SVG.cloud(0, cl > 90 ? '#c7d0d9' : '#fff');
    return `<svg viewBox="0 0 32 32">${s}</svg>`;
  }
  // Rüzgarın ESTİĞİ yönü gösteren ok (meteorolojik yön + 180°)
  const arrow = (deg, size = 22) => deg == null ? '' :
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="transform:rotate(${deg + 180}deg)"><path d="M12 3v18M12 3l-5 6M12 3l5 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // ---------- Veri çekme (canlı, anahtarsız) ----------
  const memCache = new Map();
  const CACHE_MS = 30 * 60e3;

  async function fetchOpenMeteo(loc, model) {
    const q = new URLSearchParams({
      latitude: loc.lat, longitude: loc.lon,
      hourly: 'temperature_2m,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
      models: model.om, forecast_days: FORECAST_DAYS, wind_speed_unit: 'kmh', timeformat: 'unixtime', timezone: 'auto',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { cache: 'no-store' });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const e = await res.json(); if (e.reason) msg += `: ${e.reason}`; } catch { /* yoksay */ }
      throw new Error(msg);
    }
    const j = await res.json();
    const h = j.hourly;
    const hours = h.time.map((t, i) => ({
      t: t * 1000,
      ws: h.wind_speed_10m[i], wg: h.wind_gusts_10m?.[i], wd: h.wind_direction_10m[i],
      temp: h.temperature_2m[i], precip: h.precipitation?.[i], cloud: h.cloud_cover?.[i], rh: h.relative_humidity_2m?.[i],
    })).filter(r => r.ws != null && r.temp != null);
    return { hours, tz: j.timezone, source: 'Open-Meteo' };
  }


  // ---------- Infoplaza Platform Weather API ----------
  // GET https://api.infoplaza.com/v1/weather/forecast — Infoplaza "Optimal" modeli, 7 gün saatlik.
  // hourly[]: time (unix sn), windSpeed / windGust (m/sn, units=metric), windBearing (°),
  // temperature (°C), precipIntensity (mm/saat), cloudCover (0–1), humidity (0–1).
  // Not: 48 saatten uzun tahmin istek başına 3 kredi harcar.
  // Infoplaza tarayıcıdan doğrudan çağrıya (CORS) izin vermediği için istekler
  // kullanıcının Cloudflare Worker aracı sunucusundan geçer (proxy/infoplaza-worker.js).
  const IP_PATH = '/v1/weather/forecast';
  function ipUrl(loc) {
    const base = (state.ipProxy || 'https://api.infoplaza.com').trim().replace(/\/+$/, '');
    const q = {
      lat: loc.lat, lon: loc.lon, units: 'metric', language: 'en',
      max_hourly: 24 * FORECAST_DAYS, max_minutely: 0, max_daily: 0, max_daypartly: 0,
    };
    if (state.ipKey) q.api_key = state.ipKey;
    return `${base}${IP_PATH}?${new URLSearchParams(q)}`;
  }

  // Infoplaza "hourly" dizisini uygulamanın satır biçimine çevir
  function ipParse(d) {
    const hourly = d?.hourly;
    if (!Array.isArray(hourly) || !hourly.length) throw new Error('Infoplaza verisinde saatlik tahmin yok');
    const n = v => (typeof v === 'number' && isFinite(v) ? v : null);
    const hours = hourly.map(h => ({
      t: h.time * 1000,
      ws: n(h.windSpeed) != null ? h.windSpeed * 3.6 : null,
      wg: n(h.windGust) != null ? h.windGust * 3.6 : null,
      wd: n(h.windBearing),
      temp: n(h.temperature),
      precip: n(h.precipIntensity),          // saatlik adımda mm/saat ≈ o saatin toplamı
      cloud: n(h.cloudCover) != null ? h.cloudCover * 100 : null,
      rh: n(h.humidity) != null ? h.humidity * 100 : null,
    })).filter(r => r.ws != null && r.t).sort((a, b) => a.t - b.t);
    return { hours, tz: typeof d.timezone === 'string' ? d.timezone : null, source: 'Infoplaza' };
  }

  // Varsayılan yol: GitHub Actions Infoplaza'yı düzenli çekip data/infoplaza/ altına yazar;
  // uygulama bu dosyaları kendi sitesinden okur (CORS sorunu yok, anahtar telefonda değil).
  async function fetchInfoplazaFromSite(loc) {
    let idx;
    try {
      const r = await fetch('data/infoplaza/index.json', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      idx = await r.json();
    } catch { throw new Error('Infoplaza verisi henüz oluşturulmamış (GitHub işi çalışmadı)'); }
    const near = (idx.locations || [])
      .map(e => ({ e, d: Math.hypot(e.lat - loc.lat, (e.lon - loc.lon) * Math.cos(loc.lat * Math.PI / 180)) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!near || near.d > 0.03) throw new Error(`“${loc.name}” Infoplaza listesinde yok`);
    if (near.e.error) throw new Error(`Infoplaza: ${near.e.error}`);
    const r = await fetch(`data/infoplaza/${near.e.file}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Infoplaza dosyası okunamadı (${r.status})`);
    const out = ipParse(await r.json());
    out.dataAt = near.e.fetchedAt ? Date.parse(near.e.fetchedAt) : null;
    return out;
  }

  // İsteğe bağlı yol: kullanıcının kendi aracı sunucusu (Cloudflare Worker) üzerinden canlı
  async function fetchInfoplaza(loc) {
    if (!state.ipProxy) return fetchInfoplazaFromSite(loc);
    let res;
    try { res = await fetch(ipUrl(loc), { cache: 'no-store' }); }
    catch { throw new Error('Aracı sunucuya bağlanılamadı — Worker adresini kontrol et'); }
    let j = null;
    try { j = await res.json(); } catch { /* yoksay */ }
    if (!res.ok || j?.success === false) {
      const why = j?.message || j?.error?.message || j?.error || j?.meta?.message || '';
      const hint = { 401: 'api_key geçersiz', 403: 'yetki yok', 429: 'kredi/limit aşıldı', 404: 'bulunamadı' }[res.status] || '';
      throw new Error(`Infoplaza ${res.status}${hint ? ' – ' + hint : ''}${why ? ': ' + String(why).slice(0, 120) : ''}`);
    }
    return ipParse(j?.data ?? j);
  }

  // Aynı bölge için eşzamanlı istekleri tek istekte birleştir
  const inflight = new Map();
  function getForecast(loc, modelId, opts = {}) {
    const key = `${loc.lat},${loc.lon}|${state.source}|${modelId}|${loc.bridge ? 'b' : ''}|${opts.force ? 1 : 0}`;
    if (!inflight.has(key)) inflight.set(key, fetchForecast(loc, modelId, opts).finally(() => inflight.delete(key)));
    return inflight.get(key);
  }

  // ---------- Köprü modu: 80 m yükseklik rüzgarı ----------
  // Köprü tabliyesi ~65 m yükseklikte. Her saat için GFS'nin 80 m / 10 m rüzgar oranı alınır ve
  // seçili kaynağın rüzgar + hamlesine uygulanır (hamle için 80 m verisi yok; aynı oran kullanılır).
  const BRIDGE_H = 80;
  async function getHeightRatio(loc, { force = false } = {}) {
    const key = `h80|${loc.lat},${loc.lon}`;
    const c = memCache.get(key);
    if (!force && c && Date.now() - c.at < CACHE_MS) return c.data;
    const q = new URLSearchParams({
      latitude: loc.lat, longitude: loc.lon, hourly: 'wind_speed_10m,wind_speed_80m', models: 'gfs_seamless',
      forecast_days: FORECAST_DAYS, wind_speed_unit: 'kmh', timeformat: 'unixtime',
    });
    const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { cache: 'no-store' })).json();
    const h = j.hourly, m = new Map();
    h.time.forEach((t, i) => {
      const a = h.wind_speed_10m[i], b = h.wind_speed_80m[i];
      if (a != null && b != null) m.set(t * 1000, a >= 2 ? Math.min(Math.max(b / a, 1), 2.5) : 1);
    });
    memCache.set(key, { at: Date.now(), data: m });
    return m;
  }
  function ratioAt(m, t) {
    if (m.has(t)) return m.get(t);
    let best = 1, bd = Infinity;               // 3 saatlik kaynaklar için en yakın saat
    for (const [k, v] of m) { const d = Math.abs(k - t); if (d < bd) { bd = d; best = v; } }
    return bd <= 3 * 3600e3 ? best : 1;
  }
  async function withBridgeHeight(loc, data, opts) {
    if (!loc.bridge) return data;
    try {
      const m = await getHeightRatio(loc, opts);
      return {
        ...data, height: BRIDGE_H,
        hours: data.hours.map(h => {
          const k = ratioAt(m, h.t);
          return { ...h, ws: h.ws != null ? h.ws * k : h.ws, wg: h.wg != null ? h.wg * k : h.wg, hk: k };
        }),
      };
    } catch { return { ...data, heightErr: true }; }
  }

  async function fetchForecast(loc, modelId, opts = {}) {
    const raw = await fetchForecastRaw(loc, modelId, opts);
    return withBridgeHeight(loc, raw, opts);
  }

  async function fetchForecastRaw(loc, modelId, { force = false } = {}) {
    const model = MODELS.find(m => m.id === modelId);
    const src = state.source;
    const key = `${loc.lat},${loc.lon}|${src === 'infoplaza' ? 'ip' : modelId}`;
    const c = memCache.get(key);
    if (!force && c && Date.now() - c.at < CACHE_MS) return c.data;
    let data;
    try {
      if (src === 'infoplaza') {
        try { data = await fetchInfoplaza(loc); }
        catch (e) {
          // Infoplaza olmazsa Open-Meteo'ya geç, sebebini göster
          data = await fetchOpenMeteo(loc, model);
          data.fallback = e.message;
        }
      } else data = await fetchOpenMeteo(loc, model);
      data.source ||= 'Open-Meteo';
      data.at = Date.now();
      data.offline = false;
      store.set(`fc:${key}`, data);
    } catch (err) {
      const off = store.get(`fc:${key}`, null);
      if (!off) throw err;
      data = { ...off, offline: true, err: err.message };
    }
    if (!loc.tz && data.tz) { loc.tz = data.tz; saveLocs(); }
    memCache.set(key, { at: Date.now(), data });
    return data;
  }

  // ---------- Motor modu: tüm kaynakların en yüksek hamlesi ----------
  // Open-Meteo'dan GFS + ICON + ECMWF tek istekte, varsa Infoplaza da; her saat için en yüksek hamle.
  async function getGustEnsemble(loc, { force = false } = {}) {
    const key = `ens|${loc.lat},${loc.lon}|${loc.bridge ? 'b' : ''}`;
    const c = memCache.get(key);
    if (!force && c && Date.now() - c.at < CACHE_MS) return c.data;
    const byT = new Map();
    const add = (t, src, g) => {
      if (g == null || !isFinite(g)) return;
      const e = byT.get(t) || {};
      e[src] = g; byT.set(t, e);
    };
    const models = { GFS: 'gfs_seamless', ICON: 'icon_seamless', ECMWF: 'ecmwf_ifs025' };
    const jobs = [
      fetch(`https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
        latitude: loc.lat, longitude: loc.lon, hourly: 'wind_gusts_10m', models: Object.values(models).join(','),
        forecast_days: FORECAST_DAYS, wind_speed_unit: 'kmh', timeformat: 'unixtime',
      })}`, { cache: 'no-store' }).then(r => r.json()).then(j => {
        const h = j.hourly;
        for (const [name, m] of Object.entries(models)) (h[`wind_gusts_10m_${m}`] || []).forEach((g, i) => add(h.time[i] * 1000, name, g));
      }),
      fetchInfoplazaFromSite(loc).then(d => d.hours.forEach(r => add(r.t, 'Infoplaza', r.wg))),
    ];
    await Promise.allSettled(jobs);
    if (loc.bridge) {
      try {
        const m = await getHeightRatio(loc, { force });
        for (const [t, e] of byT) { const k = ratioAt(m, t); for (const s of Object.keys(e)) e[s] *= k; }
      } catch { /* oran alınamazsa 10 m değerleri kalır */ }
    }
    memCache.set(key, { at: Date.now(), data: byT });
    return byT;
  }
  function applyGustEnsemble(data, ens) {
    return {
      ...data,
      hours: data.hours.map(h => {
        const e = { ...(ens.get(h.t) || {}) };
        if (h.wg != null) e[data.source === 'Infoplaza' ? 'Infoplaza' : MODELS.find(m => m.id === state.model).label] ??= h.wg;
        const vals = Object.entries(e);
        if (!vals.length) return h;
        const [src, g] = vals.reduce((a, b) => (b[1] > a[1] ? b : a));
        return { ...h, wgBase: h.wg, wg: g, wgSrc: src, wgAll: e };
      }),
    };
  }
  // Sürüş durumu: 2 = riskli, 1 = dikkat, 0 = uygun
  function rideLevel(r) {
    const g = r.wg ?? 0, p = r.precipH ?? 0;
    if (g >= state.motorRisk || p >= 1) return 2;
    if (g >= state.motorWarn || p >= 0.2 || (r.temp != null && Math.round(r.temp) <= 3)) return 1;
    return 0;
  }
  function rideWhy(r) {
    const w = [];
    if ((r.wg ?? 0) >= state.motorWarn) w.push(`hamle ${windVal(r.wg)} ${unitLabel()}${r.wgSrc ? ' (' + r.wgSrc + ')' : ''}`);
    if ((r.precipH ?? 0) >= 0.2) w.push(`yağış ${(r.precip ?? 0).toFixed(1)} mm`);
    if (r.temp != null && Math.round(r.temp) <= 3) w.push(`soğuk ${Math.round(r.temp)}°C (buzlanma)`);
    return w.join(', ') || 'uygun';
  }

  // Saatlik veriyi seçilen adıma (1s / 3s) indir; hamle = pencere içindeki maks., yağış = toplam
  function buildRows(data, loc) {
    const hrs = data.hours;
    const step = Math.max(state.step, 1);
    const out = [];
    for (let i = 0; i < hrs.length; i++) {
      const r = hrs[i];
      const p = tparts(r.t, loc.tz);
      if (step > 1 && p.h % step !== 0) continue;
      let wg = r.wg, precip = r.precip;
      if (step > 1) {
        const win = hrs.slice(Math.max(0, i - step + 1), i + 1).filter(x => x.t > r.t - step * 3600e3);
        const gs = win.map(x => x.wg).filter(x => x != null);
        if (gs.length) wg = Math.max(...gs);
        precip = win.reduce((s, x) => s + (x.precip || 0), 0);
      }
      const sun = sunTimes(r.t, loc.lat, loc.lon);
      const day = sun ? (r.t > sun.rise && r.t < sun.set) : true;
      out.push({ ...r, wg, precip, precipH: precip != null ? precip / step : null, p, day });
    }
    return out;
  }

  const nearest = (hours, t) => hours.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a, hours[0]);

  // ---------- Harita ----------
  let map;
  const pins = new Map();

  function initMap() {
    if (!window.L) return;
    map = L.map('map', { zoomControl: false, attributionControl: true, tap: false });
    setMapLayer(state.mapLayer);
    map.on('click', onMapPick);
    fitAll(false);
    // Harita alanı yerleşim bitince/ekran dönünce değişir: boyutu güncelle ve bölgeleri ortala
    let userMoved = false;
    map.on('dragstart', () => { userMoved = true; });
    new ResizeObserver(() => {
      map.invalidateSize();
      if (!userMoved && !state.picking) fitAll(false);
    }).observe($('#map'));
  }

  // ---- Harita altlıkları (hepsi anahtarsız)
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  const ESRI_ATTR = 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap';
  const MAP_LAYERS = {
    dark:   { label: 'Koyu',  dark: true,  max: 16, attr: ESRI_ATTR,
              urls: [`${ESRI}Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`] },
    light:  { label: 'Açık',  dark: false, max: 16, attr: ESRI_ATTR,
              urls: [`${ESRI}Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`] },
    sat:    { label: 'Uydu',  dark: true,  max: 18, attr: 'Imagery © Esri, Maxar, Earthstar Geographics',
              urls: [`${ESRI}World_Imagery/MapServer/tile/{z}/{y}/{x}`, `${ESRI}Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`] },
    street: { label: 'Sokak', dark: false, max: 19, attr: '© OpenStreetMap katkıcıları',
              urls: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
  };
  let baseLayers = [];
  function setMapLayer(id) {
    const cfg = MAP_LAYERS[id] || MAP_LAYERS.dark;
    state.mapLayer = MAP_LAYERS[id] ? id : 'dark';
    store.set('mapLayer', state.mapLayer);
    baseLayers.forEach(l => map.removeLayer(l));
    baseLayers = cfg.urls.map((u, i) => L.tileLayer(u, { maxZoom: cfg.max, attribution: i ? '' : cfg.attr }).addTo(map));
    $('#mapWrap').classList.toggle('dark', cfg.dark);
    document.querySelectorAll('#layerMenu button').forEach(b => b.classList.toggle('active', b.dataset.v === state.mapLayer));
    renderCompass();
  }
  const mapIsDark = () => (MAP_LAYERS[state.mapLayer] || MAP_LAYERS.dark).dark;

  function fitAll(animate = true) {
    if (!map) return;
    const ls = state.locs;
    if (ls.length > 1) map.fitBounds(L.latLngBounds(ls.map(l => [l.lat, l.lon])), { padding: [80, 80], maxZoom: 12, animate });
    else if (ls.length) map.setView([ls[0].lat, ls[0].lon], 12, { animate });
    else map.setView([39.0, 35.0], 5);
  }

  function focusSelected() {
    const l = curLoc();
    if (!map || !l) return;
    const ll = L.latLng(l.lat, l.lon);
    if (!map.getBounds().pad(-0.15).contains(ll) || map.getZoom() < 8) map.setView(ll, Math.max(map.getZoom(), 10));
  }

  // Her kayıtlı bölge için harita işareti; seçili bölge pusula olarak gösterilir.
  function renderMarkers() {
    if (!map) return;
    const live = new Set(state.locs.map(l => l.id));
    for (const [id, m] of pins) if (!live.has(id)) { map.removeLayer(m); pins.delete(id); }
    for (const l of state.locs) {
      let m = pins.get(l.id);
      if (!m) {
        m = L.marker([l.lat, l.lon], { icon: pinIcon(l, null), riseOnHover: true });
        m.on('click', () => selectLoc(l.id, { fromMap: true }));
        m.addTo(map);
        pins.set(l.id, m);
      } else m.setLatLng([l.lat, l.lon]);
      m.setIcon(pinIcon(l, l._r, l.id === state.sel));
      m.setZIndexOffset(l.id === state.sel ? 1000 : 0);
    }
  }
  // Şiddet: 0 yeşil, 1 sarı, 2 kırmızı (km/s). Hamle eşikleri Motor modu ayarlarıyla aynı.
  const sevWind = v => v == null ? -1 : v >= 35 ? 2 : v >= 20 ? 1 : 0;
  const sevGust = v => v == null ? -1 : v >= state.motorRisk ? 2 : v >= state.motorWarn ? 1 : 0;
  // Haritadaki etiket: [rüzgar | yön | hamle]
  function windPill(r) {
    if (!r) return '<span class="pill"><span class="pw s-1">…</span></span>';
    return `<span class="pill" title="rüzgar ${windVal(r.ws)} · hamle ${windVal(r.wg)} ${unitLabel()}">` +
      `<span class="pw s${sevWind(r.ws)}">${windVal(r.ws)}</span>` +
      `<span class="pd">${arrow(r.wd, 13)}</span>` +
      `<span class="pg s${sevGust(r.wg)}">${windVal(r.wg)}</span></span>`;
  }
  function pinIcon(l, r, sel = false) {
    return L.divIcon({
      className: 'pin-wrap', iconSize: null,
      html: `<div class="pin${sel ? ' sel' : ''}">${windPill(r)}<span class="pn">${esc(l.name)}</span></div>`,
    });
  }
  // (Eski pusula kaldırıldı; seçili bölge de etiketle gösterilir.)
  const renderCompass = () => renderMarkers();

  function setPicking(on) {
    state.picking = on;
    $('#mapWrap').classList.toggle('picking', on);
    $('#pickBanner').hidden = !on;
    setTimeout(() => map && map.invalidateSize(), 280);
  }
  function onMapPick(e) {
    if (!state.picking) return;
    const name = prompt('Bu bölgeye isim ver:', `Nokta ${state.locs.length + 1}`);
    if (!name) return;
    setPicking(false);
    addLoc({ name, lat: e.latlng.lat, lon: e.latlng.lng });
  }

  // ---------- Arayüz ----------
  function renderLocBar() {
    const bar = $('#locBar');
    bar.innerHTML = '';
    for (const l of state.locs) {
      const b = el('button', { class: 'chip' + (l.id === state.sel ? ' active' : ''), 'data-id': l.id });
      b.innerHTML = `${esc(l.name)}<span class="w" hidden></span>`;
      b.addEventListener('click', () => selectLoc(l.id));
      bar.append(b);
    }
    bar.append(el('button', { class: 'chip add', onclick: openAdd }, '＋ Ekle'));
    bar.querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    paintBadges();
  }

  // Tüm bölgelerin verisini çek (işaret ve rozetler için)
  async function loadAll({ force = false } = {}) {
    await Promise.all(state.locs.map(l => getForecast(l, state.model, { force }).then(d => { l._data = d; }).catch(() => { l._data = null; })));
    paintBadges();
  }
  // Rozet ve işaretlerde odak zamanındaki (varsayılan: şimdi) rüzgarı göster
  function paintBadges() {
    const t = state.focusT ?? Date.now();
    for (const l of state.locs) {
      l._r = l._data?.hours?.length ? nearest(l._data.hours, t) : null;
      const s = document.querySelector(`.chip[data-id="${CSS.escape(l.id)}"] .w`);
      if (s && l._r) { s.hidden = false; s.textContent = windVal(l._r.ws); s.style.background = windColor(l._r.ws); }
    }
    renderMarkers();
  }

  function renderModels() {
    const t = $('#modelTabs');
    t.innerHTML = '';
    t.hidden = state.source === 'infoplaza';
    for (const m of MODELS) {
      t.append(el('button', {
        class: m.id === state.model ? 'active' : '',
        onclick: () => { state.model = m.id; store.set('model', m.id); renderModels(); refresh(); },
      }, m.label));
    }
  }

  function selectLoc(id, { fromMap = false } = {}) {
    state.sel = id; saveLocs();
    renderLocBar();
    if (!fromMap) focusSelected();
    load();
  }

  // Seçili bölgeyi yükle + diğer bölgeleri arka planda güncelle
  async function refresh({ force = false } = {}) {
    load({ force });
    loadAll({ force });
  }

  async function load({ force = false } = {}) {
    const loc = curLoc();
    $('#locTitle').textContent = loc ? loc.name : 'Rüzgar Takip';
    const fc = $('#forecast');
    if (!loc) {
      fc.innerHTML = '<div class="status">Yukarıdan “＋ Ekle” ile bir bölge kaydet.</div>';
      $('#dayInfo').innerHTML = ''; renderCompass(); return;
    }
    const btn = $('#refreshBtn');
    btn.classList.add('spin');
    if (!fc.querySelector('table')) fc.innerHTML = '<div class="status">Yükleniyor…</div>';
    const reqId = (load.req = (load.req || 0) + 1);
    try {
      const data = await getForecast(loc, state.model, { force });
      if (reqId !== load.req) return;
      loc._data = data;
      const model = MODELS.find(m => m.id === state.model);
      let shown = data;
      if (state.motor) {
        const ens = await getGustEnsemble(loc, { force });
        if (reqId !== load.req) return;
        shown = applyGustEnsemble(data, ens);
      }
      state.rows = buildRows(shown, loc);
      state.days = [];
      for (const r of state.rows) {
        const d = state.days[state.days.length - 1];
        if (!d || d.key !== r.p.key) state.days.push({ key: r.p.key, rows: [r] }); else d.rows.push(r);
      }
      const todayKey = tparts(Date.now(), loc.tz).key;
      if (!state.days.find(d => d.key === state.dayKey)) state.dayKey = null;
      if (!state.dayKey) state.dayKey = (state.days.find(d => d.key === todayKey) || state.days[0])?.key;
      // Tek satır kaynak bilgisi; Infoplaza'ya geçilemediyse kısa uyarı (dokununca sebebi)
      const label = data.source === 'Infoplaza' ? 'Infoplaza' : 'Open-Meteo';
      const t = data.dataAt || data.at;
      const tag = $('#sourceTag');
      tag.innerHTML = (data.fallback ? '<span class="warn">⚠ Infoplaza yok</span> · ' : '')
        + `${label}${data.height ? ` · <span class="h80" title="Köprü modu: ${BRIDGE_H} m yükseklik rüzgarı (GFS oranıyla)">🌉 ${BRIDGE_H} m</span>` : ''} · ${data.offline ? 'çevrimdışı ' : ''}${hhmm(t, loc.tz)}`;
      tag.title = data.fallback || '';
      tag.onclick = data.fallback ? () => alert(data.fallback) : null;
      renderDay(true);
      paintBadges();
    } catch (err) {
      if (reqId !== load.req) return;
      fc.innerHTML = `<div class="status err">Veri alınamadı: ${esc(err.message)}<br><small>İnternet bağlantını kontrol edip yenile'ye bas.</small></div>`;
    } finally {
      btn.classList.remove('spin');
    }
  }

  // ---------- Gün gezinme ----------
  function changeDay(delta) {
    const i = state.days.findIndex(d => d.key === state.dayKey);
    const n = state.days[i + delta];
    if (!n) return;
    state.dayKey = n.key;
    renderDay(true);
    paintBadges();
  }

  function renderDay(resetFocus) {
    const loc = curLoc();
    const i = state.days.findIndex(d => d.key === state.dayKey);
    const day = state.days[i];
    $('#prevDay').disabled = i <= 0;
    $('#nextDay').disabled = i < 0 || i >= state.days.length - 1;
    if (!day) { $('#dayInfo').innerHTML = ''; return; }

    const p = day.rows[0].p;
    const now = Date.now();
    const isToday = p.key === tparts(now, loc.tz).key;
    const we = p.wd === 'Sat' || p.wd === 'Sun';
    const sun = sunTimes(Date.UTC(p.y, p.mo - 1, p.d, 12), loc.lat, loc.lon);
    const maxWs = Math.max(...day.rows.map(r => r.ws ?? 0));
    const shortDay = { Mon: 'Pzt', Tue: 'Sal', Wed: 'Çar', Thu: 'Per', Fri: 'Cum', Sat: 'Cmt', Sun: 'Paz' };
    const maxWg = Math.max(...day.rows.map(r => r.wg ?? 0));
    const rain = day.rows.reduce((s, r) => s + (r.precip || 0), 0);
    $('#dayInfo').innerHTML =
      `<span class="t${we ? ' we' : ''}">${shortDay[p.wd] || p.wd} ${p.d} ${TR_MON[p.mo - 1]}</span>` +
      (isToday ? '<span class="today">BUGÜN</span>' : '') +
      `<span><b style="background:${windColor(maxWs)}">${windVal(maxWs)}</b>/<b style="background:${windColor(maxWg)}">${windVal(maxWg)}</b></span>` +
      (rain >= 0.1 && !state.motor ? `<span class="m">💧${rain.toFixed(1)}</span>` : '') +
      (state.motor ? rideSummary(day.rows) : sun ? `<span class="m">☀${hhmm(sun.rise, loc.tz)}–${hhmm(sun.set, loc.tz)}</span>` : '');

    if (resetFocus) {
      // Bugünse şimdiki saat, değilse öğlen
      state.focusT = isToday ? null : day.rows.reduce((a, b) => Math.abs(b.p.h - 12) < Math.abs(a.p.h - 12) ? b : a).t;
    }
    renderTable(day.rows, loc);
  }

  // Gündüz saatlerinde en uzun "uygun" aralık
  function rideSummary(rows) {
    const now = Date.now(), stepMs = state.step * 3600e3;
    let best = null, cur = null;
    for (const r of rows) {
      const ok = r.day && rideLevel(r) === 0 && r.t + stepMs > now;
      if (ok) { cur = cur ? { ...cur, b: r } : { a: r, b: r }; if (!best || cur.b.t - cur.a.t > best.b.t - best.a.t) best = cur; }
      else cur = null;
    }
    const h = r => String(r.p.h).padStart(2, '0');
    if (!best) return '<span class="ride-sum l2" title="Bugün uygun saat yok">🏍 ✗</span>';
    const end = (best.b.p.h + state.step) % 24;
    return `<span class="ride-sum l0" title="En uzun uygun aralık">🏍 ${h(best.a)}–${String(end).padStart(2, '0')}</span>`;
  }

  function renderTable(rows, loc) {
    const fc = $('#forecast');
    if (!rows.length) { fc.innerHTML = '<div class="status">Veri yok.</div>'; return; }
    const now = Date.now();
    const stepMs = state.step * 3600e3;
    const nowIdx = rows.findIndex(r => now >= r.t - stepMs / 2 && now < r.t + stepMs / 2);
    const focusT = state.focusT ?? now;
    const focusIdx = rows.indexOf(nearest(rows, focusT));
    const cls = (i, extra = '') => `${extra}${i === nowIdx ? ' now' : ''}`;

    let h = `<table class="fc"><thead><tr class="hours"><th class="lbl">${state.step}s</th>`;
    rows.forEach((r, i) => { h += `<th class="${cls(i, r.day ? '' : 'night')}${i === focusIdx ? ' focus' : ''}" data-i="${i}">${String(r.p.h).padStart(2, '0')}</th>`; });
    h += '</tr></thead><tbody>';

    const row = (label, fn) => {
      h += `<tr><td class="lbl">${label}</td>`;
      rows.forEach((r, i) => { h += fn(r, i); });
      h += '</tr>';
    };
    const icoSun = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    const icoDir = '<svg viewBox="0 0 24 24"><path d="M6 18L18 6M18 6h-8M18 6v8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const icoDrop = '<svg viewBox="0 0 24 24"><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

    row(icoSun, (r, i) => `<td class="${cls(i, 'icon')}">${weatherIcon(r)}</td>`);
    row(icoDir, (r, i) => `<td class="${cls(i, 'dir')}" title="${Math.round(r.wd)}°">${arrow(r.wd)}</td>`);
    const hTag = loc.bridge ? ` <span class="h80">${BRIDGE_H}m</span>` : '';
    row(`${unitLabel()}<br><small>rüzgar${hTag}</small>`, (r, i) => `<td class="${cls(i, 'c')}" style="background:${windColor(r.ws)}">${windVal(r.ws)}</td>`);
    row(`${unitLabel()}<br><small>${state.motor ? 'hamle▲' : 'hamle'}${hTag}</small>`, (r, i) => {
      const up = state.motor && r.wgBase != null && r.wg - r.wgBase >= 3;
      const tip = r.wgAll ? Object.entries(r.wgAll).map(([k, v]) => `${k} ${windVal(v)}`).join(' · ') : '';
      return `<td class="${cls(i, 'c' + (up ? ' up' : ''))}" style="background:${windColor(r.wg)}"${tip ? ` title="${tip}"` : ''}>${windVal(r.wg)}</td>`;
    });
    if (state.motor) {
      const icoMoto = '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="16.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18.5" cy="16.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 16.5l4-7h5l4 7M14 9.5l-1.5-3H15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      row(icoMoto, (r, i) => { const lv = rideLevel(r); return `<td class="${cls(i, 'ride l' + lv)}" title="${rideWhy(r)}"><span></span></td>`; });
    }
    row('°C', (r, i) => `<td class="${cls(i, 'c')}" style="background:${tempColor(r.temp)}">${r.temp != null ? Math.round(r.temp) + '°' : '–'}</td>`);
    row(`mm<br><small>/${state.step}s</small>`, (r, i) => {
      const p = r.precip, ph = r.precipH ?? 0;
      const c = ph >= 2 ? ' r3' : ph >= 0.6 ? ' r2' : p >= 0.1 ? ' r1' : '';
      const txt = p == null ? '–' : p < 0.1 ? '0' : p < 10 ? p.toFixed(1) : Math.round(p);
      return `<td class="${cls(i, 'rain' + c)}">${txt}</td>`;
    });
    row(icoDrop + '<small>%</small>', (r, i) => `<td class="${cls(i, 'rh')}">${r.rh != null ? Math.round(r.rh) + '%' : '–'}</td>`);
    h += '</tbody></table>';
    fc.innerHTML = h;

    // Şimdiki / odaktaki saati görünür yap
    const th = fc.querySelector(`thead th[data-i="${focusIdx}"]`);
    const lblW = fc.querySelector('.lbl').offsetWidth;
    if (th && th.offsetLeft + th.offsetWidth > fc.clientWidth) fc.scrollLeft = th.offsetLeft - lblW - th.offsetWidth;
    else fc.scrollLeft = 0;

    // Bir saate dokununca pusula ve harita işaretleri o saati göstersin
    fc.querySelector('table').addEventListener('click', e => {
      const cell = e.target.closest('td,th');
      if (!cell || cell.classList.contains('lbl')) return;
      const r = rows[[...cell.parentNode.children].indexOf(cell) - 1];
      if (!r) return;
      state.focusT = r.t;
      fc.querySelectorAll('thead th.focus').forEach(x => x.classList.remove('focus'));
      fc.querySelector(`thead th[data-i="${rows.indexOf(r)}"]`)?.classList.add('focus');
      paintBadges();
    });
  }

  // ---------- Bölge ekleme ----------
  function addLoc({ name, lat, lon, tz }) {
    const id = `loc-${Date.now().toString(36)}`;
    const loc = { id, name, lat: +(+lat).toFixed(4), lon: +(+lon).toFixed(4), tz: tz || null };
    state.locs.push(loc);
    state.sel = id;
    saveLocs();
    if ($('#addDlg').open) $('#addDlg').close();
    renderLocBar(); renderEditList(); focusSelected(); load();
    getForecast(loc, state.model).then(d => { loc._data = d; paintBadges(); }).catch(() => {});
  }

  function openAdd() {
    $('#searchInput').value = '';
    $('#searchResults').innerHTML = '';
    $('#addDlg').showModal();
  }

  let searchTimer;
  async function doSearch(q) {
    const ul = $('#searchResults');
    if (q.trim().length < 2) { ul.innerHTML = ''; return; }
    ul.innerHTML = '<li><small>Aranıyor…</small></li>';
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: 10, language: 'tr', format: 'json' })}`);
      const j = await res.json();
      ul.innerHTML = '';
      if (!j.results?.length) { ul.innerHTML = '<li><small>Sonuç yok — haritadan seçmeyi dene.</small></li>'; return; }
      for (const r of j.results) {
        const sub = [r.admin2, r.admin1, r.country].filter(Boolean).join(', ');
        const li = el('li', {}, `${esc(r.name)}<small>${esc(sub)} · ${r.latitude.toFixed(3)}, ${r.longitude.toFixed(3)}</small>`);
        li.addEventListener('click', () => addLoc({ name: r.name, lat: r.latitude, lon: r.longitude, tz: r.timezone }));
        ul.append(li);
      }
    } catch (e) {
      ul.innerHTML = `<li><small>Arama hatası: ${esc(e.message)}</small></li>`;
    }
  }

  // ---------- Ayarlar ----------
  function renderEditList() {
    const ul = $('#locEditList');
    ul.innerHTML = '';
    state.locs.forEach((l, i) => {
      const li = el('li', {}, `<span class="n">${esc(l.name)}<small>${l.lat.toFixed(3)}, ${l.lon.toFixed(3)}</small></span>`);
      const mk = (txt, c, fn, title) => { const b = el('button', { class: c, title, 'aria-label': title }, txt); b.addEventListener('click', fn); li.append(b); };
      const swap = j => { [state.locs[j], state.locs[i]] = [state.locs[i], state.locs[j]]; saveLocs(); renderLocBar(); renderEditList(); };
      mk('🌉', l.bridge ? 'on' : '', () => {
        l.bridge = !l.bridge; saveLocs(); renderEditList(); memCache.clear(); refresh();
      }, l.bridge ? 'Köprü modu açık (80 m rüzgar) — kapat' : 'Köprü modu: 80 m rüzgarını göster');
      mk('✎', '', () => {
        const n = prompt('Yeni isim:', l.name);
        if (n) { l.name = n; saveLocs(); renderLocBar(); renderEditList(); renderMarkers(); $('#locTitle').textContent = curLoc()?.name ?? ''; }
      }, 'Yeniden adlandır');
      mk('↑', '', () => { if (i > 0) swap(i - 1); }, 'Yukarı');
      mk('↓', '', () => { if (i < state.locs.length - 1) swap(i + 1); }, 'Aşağı');
      mk('🗑', 'del', () => {
        if (!confirm(`“${l.name}” silinsin mi?`)) return;
        state.locs.splice(i, 1);
        if (state.sel === l.id) state.sel = state.locs[0]?.id ?? null;
        saveLocs(); renderLocBar(); renderEditList(); renderMarkers(); load();
      }, 'Sil');
      ul.append(li);
    });
  }
  const syncSeg = (id, val) => document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('active', b.dataset.v === String(val)));

  // ---------- Olaylar ----------
  function bind() {
    $('#refreshBtn').addEventListener('click', () => refresh({ force: true }));
    $('#prevDay').addEventListener('click', () => changeDay(-1));
    $('#nextDay').addEventListener('click', () => changeDay(1));
    document.addEventListener('keydown', e => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'ArrowLeft') changeDay(-1);
      if (e.key === 'ArrowRight') changeDay(1);
    });
    $('#fitBtn').addEventListener('click', () => fitAll());
    $('#settingsBtn').addEventListener('click', () => {
      renderEditList(); syncSeg('unitSeg', state.unit); syncSeg('stepSeg', state.step);
      $('#settingsDlg').showModal();
    });
    // Motor modu
    const syncMotor = () => {
      syncSeg('motorSeg', state.motor ? 'on' : 'off');
      $('#motorBtn').classList.toggle('active', state.motor);
      $('#motorBtn').setAttribute('aria-pressed', state.motor);
      $('#mWarn').value = state.motorWarn; $('#mRisk').value = state.motorRisk;
    };
    const setMotor = on => { state.motor = on; store.set('motor', on); syncMotor(); load(); };
    $('#motorBtn').addEventListener('click', () => setMotor(!state.motor));
    $('#motorSeg').addEventListener('click', e => { const v = e.target.dataset.v; if (v) setMotor(v === 'on'); });
    ['mWarn', 'mRisk'].forEach(id => $('#' + id).addEventListener('change', () => {
      const w = +$('#mWarn').value, r = +$('#mRisk').value;
      if (w > 0 && r > w) { state.motorWarn = w; state.motorRisk = r; store.set('motorWarn', w); store.set('motorRisk', r); load(); }
      else syncMotor();
    }));
    syncMotor();
    // Harita katmanı menüsü
    $('#layerBtn').addEventListener('click', e => { e.stopPropagation(); $('#layerMenu').hidden = !$('#layerMenu').hidden; });
    $('#layerMenu').addEventListener('click', e => {
      const v = e.target.dataset.v; if (!v || !map) return;
      setMapLayer(v); $('#layerMenu').hidden = true;
    });
    document.addEventListener('click', e => { if (!e.target.closest('#layerMenu, #layerBtn')) $('#layerMenu').hidden = true; });

    $('#unitSeg').addEventListener('click', e => {
      const v = e.target.dataset.v; if (!v) return;
      state.unit = v; store.set('unit', v); syncSeg('unitSeg', v); load(); paintBadges();
    });
    $('#stepSeg').addEventListener('click', e => {
      const v = +e.target.dataset.v; if (!v) return;
      state.step = v; store.set('step', v); syncSeg('stepSeg', v); load();
    });
    // Veri kaynağı
    const syncSrc = () => {
      syncSeg('srcSeg', state.source);
      $('#ipBox').hidden = state.source !== 'infoplaza';
      $('#srcHintOm').hidden = state.source === 'infoplaza';
    };
    const showIpStatus = async () => {
      const box = $('#ipStatus');
      try {
        const r = await fetch('data/infoplaza/index.json', { cache: 'no-store' });
        if (!r.ok) throw 0;
        const idx = await r.json();
        const when = t => new Date(t).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        box.className = 'ip-out';
        box.textContent = `Son güncelleme: ${when(idx.updatedAt)}\n` +
          (idx.locations || []).map(e => `${e.error ? '✗' : '✓'} ${e.name}${e.error ? ' — ' + e.error : ''}`).join('\n');
      } catch {
        box.className = 'ip-out err';
        box.textContent = 'Henüz Infoplaza verisi yok. GitHub işinin çalışması için repo ayarlarında INFOPLAZA_KEY tanımlı olmalı.';
      }
    };
    $('#settingsBtn').addEventListener('click', () => {
      syncSrc(); $('#ipKey').value = state.ipKey; $('#ipProxy').value = state.ipProxy; $('#ipOut').hidden = true;
      if (state.source === 'infoplaza') showIpStatus();
    });
    // Bölgeleri dışa / içe aktar (cihaz veya adres değiştirirken)
    const locsJson = () => JSON.stringify(state.locs.map(l => ({ name: l.name, lat: l.lat, lon: l.lon })));
    $('#locExport').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(locsJson()); $('#locIoHint').textContent = `${state.locs.length} bölge kopyalandı.`; }
      catch { $('#locImportBox').hidden = false; $('#locImportTxt').value = locsJson(); $('#locImportTxt').select(); $('#locIoHint').textContent = 'Kopyalanamadı; metni seçip elle kopyala.'; }
    });
    $('#locImportBtn').addEventListener('click', () => { $('#locImportBox').hidden = !$('#locImportBox').hidden; $('#locImportTxt').focus(); });
    $('#locImportDo').addEventListener('click', () => {
      let list;
      try { list = JSON.parse($('#locImportTxt').value.trim()); } catch { $('#locIoHint').textContent = 'Liste okunamadı: kopyaladığın metnin tamamını yapıştır.'; return; }
      if (!Array.isArray(list)) list = [list];
      let added = 0;
      for (const x of list) {
        const lat = +x.lat, lon = +x.lon;
        if (!x.name || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        if (state.locs.some(l => Math.abs(l.lat - lat) < 1e-3 && Math.abs(l.lon - lon) < 1e-3)) continue;
        state.locs.push({ id: `loc-${Date.now().toString(36)}-${added}`, name: String(x.name).slice(0, 60), lat: +lat.toFixed(4), lon: +lon.toFixed(4), tz: null });
        added++;
      }
      saveLocs(); renderLocBar(); renderEditList(); fitAll(); refresh();
      $('#locImportTxt').value = ''; $('#locImportBox').hidden = true;
      $('#locIoHint').textContent = added ? `${added} bölge eklendi.` : 'Yeni bölge yok (hepsi zaten kayıtlı).';
    });

    $('#ipCopy').addEventListener('click', async () => {
      const txt = JSON.stringify(state.locs.map(l => ({ name: l.name, lat: l.lat, lon: l.lon })));
      try { await navigator.clipboard.writeText(txt); $('#ipCopyHint').textContent = 'Kopyalandı — Claude sohbetine yapıştır.'; }
      catch { $('#ipCopyHint').textContent = txt; }
    });
    $('#ipProxy').addEventListener('change', e => {
      state.ipProxy = e.target.value.trim(); store.set('ipProxy', state.ipProxy); memCache.clear();
      if (state.source === 'infoplaza') refresh({ force: true });
    });
    $('#srcSeg').addEventListener('click', e => {
      const v = e.target.dataset.v; if (!v) return;
      state.source = v; store.set('source', v); syncSrc(); renderModels(); refresh({ force: true });
      if (v === 'infoplaza') showIpStatus();
    });
    $('#ipKey').addEventListener('change', e => {
      state.ipKey = e.target.value.trim(); store.set('ipKey', state.ipKey); memCache.clear();
      if (state.source === 'infoplaza') refresh({ force: true });
    });
    $('#ipTest').addEventListener('click', async () => {
      state.ipKey = $('#ipKey').value.trim(); store.set('ipKey', state.ipKey);
      state.ipProxy = $('#ipProxy').value.trim(); store.set('ipProxy', state.ipProxy);
      const out = $('#ipOut');
      out.hidden = false; out.className = 'ip-out'; out.textContent = 'Test ediliyor…';
      const loc = curLoc() || { lat: 41.0, lon: 29.0 };
      try {
        const d = await fetchInfoplaza(loc);
        const f = d.hours[0], l = d.hours[d.hours.length - 1];
        const fmt = v => v == null ? '–' : Math.round(v * 10) / 10;
        out.textContent = `✓ ${d.hours.length} saatlik Infoplaza verisi\n` +
          `${new Date(f.t).toLocaleString('tr-TR')} → ${new Date(l.t).toLocaleString('tr-TR')}\n` +
          `İlk saat: rüzgar ${fmt(f.ws)} km/s, hamle ${fmt(f.wg)} km/s, yön ${fmt(f.wd)}°, ${fmt(f.temp)}°C, yağış ${fmt(f.precip)} mm`;
        memCache.clear(); if (state.source === 'infoplaza') refresh({ force: true });
      } catch (e) {
        out.className = 'ip-out err';
        out.textContent = '✗ ' + e.message;
      }
    });
    $('#searchInput').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(e.target.value), 350); });
    $('#gpsBtn').addEventListener('click', () => {
      if (!navigator.geolocation) return alert('Konum desteklenmiyor.');
      navigator.geolocation.getCurrentPosition(
        pos => {
          const name = prompt('Bu bölgeye isim ver:', 'Konumum');
          if (name) addLoc({ name, lat: pos.coords.latitude, lon: pos.coords.longitude, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
        },
        err => alert('Konum alınamadı: ' + err.message),
        { enableHighAccuracy: true, timeout: 15000 },
      );
    });
    $('#mapPickBtn').addEventListener('click', () => { $('#addDlg').close(); setPicking(true); });
    $('#pickCancel').addEventListener('click', () => setPicking(false));
    $('#mAdd').addEventListener('click', () => {
      const lat = parseFloat($('#mLat').value.replace(',', '.')), lon = parseFloat($('#mLon').value.replace(',', '.'));
      const name = $('#mName').value.trim() || `Nokta ${state.locs.length + 1}`;
      if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return alert('Geçerli enlem/boylam gir.');
      addLoc({ name, lat, lon });
    });
    // Uygulamaya geri dönünce: veri 30 dk'dan eskiyse yenile, gün değiştiyse bugüne dön
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      state.dayKey = null; state.focusT = null;
      refresh();
    });
  }

  // ---------- Başlat ----------
  bind();
  renderModels();
  renderLocBar();
  initMap();
  refresh({ force: true });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* yoksay */ });
  }
})();
