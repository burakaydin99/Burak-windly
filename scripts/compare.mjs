// Infoplaza (gh-pages/data/infoplaza) ile Open-Meteo modellerini aynı saatler için karşılaştırır.
// Kullanım: node scripts/compare.mjs <site-klasörü> [bölge adı]
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const site = process.argv[2] || '.';
const want = process.argv[3];
const idx = JSON.parse(await readFile(join(site, 'data/infoplaza/index.json'), 'utf8'));
const e = idx.locations.find(l => !want || l.name === want);
const ip = JSON.parse(await readFile(join(site, 'data/infoplaza', e.file), 'utf8'));
const ipBy = new Map(ip.hourly.map(h => [h.time, h]));

const models = { GFS: 'gfs_seamless', ECMWF: 'ecmwf_ifs025', ICON: 'icon_seamless' };
const q = new URLSearchParams({
  latitude: e.lat, longitude: e.lon, forecast_days: 7, timeformat: 'unixtime', timezone: 'Europe/Istanbul',
  hourly: 'wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation', wind_speed_unit: 'kmh',
  models: Object.values(models).join(','),
});
const om = (await (await fetch(`https://api.open-meteo.com/v1/forecast?${q}`)).json()).hourly;

const kmh = v => v == null ? null : v * 3.6;
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const fmt = (v, w = 5) => (v == null ? '–' : (Math.round(v * 10) / 10).toString()).padStart(w);
const hhmm = t => new Date(t * 1000).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

console.log(`\n=== ${e.name} (${e.lat}, ${e.lon}) — Infoplaza çekim: ${e.fetchedAt} ===`);
console.log('Birimler: rüzgar/hamle km/s, sıcaklık °C, yağış mm/saat\n');

const stats = {};
for (const [name, key] of Object.entries(models)) stats[name] = { ws: [], wg: [], wd: [], t: [], p: [], wsBias: [], wgBias: [] };

console.log('Saat          | IP rüzg hamle yön  °C  yağış | GFS rüzg hamle yön  °C | ECMWF rüzg hamle yön  °C | ICON rüzg hamle yön  °C');
om.time.forEach((t, i) => {
  const h = ipBy.get(t);
  if (!h) return;
  const ipWs = kmh(h.windSpeed), ipWg = kmh(h.windGust);
  const cols = [];
  for (const [name, key] of Object.entries(models)) {
    const ws = om[`wind_speed_10m_${key}`]?.[i], wg = om[`wind_gusts_10m_${key}`]?.[i], wd = om[`wind_direction_10m_${key}`]?.[i];
    const T = om[`temperature_2m_${key}`]?.[i], P = om[`precipitation_${key}`]?.[i];
    const s = stats[name];
    if (ws != null && ipWs != null) { s.ws.push(Math.abs(ws - ipWs)); s.wsBias.push(ws - ipWs); }
    if (wg != null && ipWg != null) { s.wg.push(Math.abs(wg - ipWg)); s.wgBias.push(wg - ipWg); }
    if (wd != null && h.windBearing != null && ipWs > 5) s.wd.push(angDiff(wd, h.windBearing));
    if (T != null && h.temperature != null) s.t.push(Math.abs(T - h.temperature));
    if (P != null && h.precipIntensity != null) s.p.push(Math.abs(P - h.precipIntensity));
    cols.push(`${fmt(ws)} ${fmt(wg)} ${fmt(wd, 4)} ${fmt(T, 4)}`);
  }
  if (new Date(t * 1000).getUTCHours() % 3 === 0)
    console.log(`${hhmm(t).padEnd(13)} | ${fmt(ipWs)} ${fmt(ipWg)} ${fmt(h.windBearing, 4)} ${fmt(h.temperature, 3)} ${fmt(h.precipIntensity, 5)} | ${cols.join(' | ')}`);
});

const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
console.log('\n=== Infoplaza\'ya göre ortalama fark (7 gün, saatlik) ===');
console.log('Model | rüzgar |fark| | rüzgar sapma | hamle |fark| | hamle sapma | yön |fark|° | sıcaklık |fark| | yağış |fark| | saat');
for (const [name, s] of Object.entries(stats))
  console.log(`${name.padEnd(5)} | ${fmt(avg(s.ws), 13)} | ${fmt(avg(s.wsBias), 12)} | ${fmt(avg(s.wg), 12)} | ${fmt(avg(s.wgBias), 11)} | ${fmt(avg(s.wd), 10)} | ${fmt(avg(s.t), 15)} | ${fmt(avg(s.p), 12)} | ${s.ws.length}`);
console.log('(sapma > 0: model Infoplaza\'dan daha yüksek tahmin ediyor)');
