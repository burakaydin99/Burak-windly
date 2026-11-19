// Infoplaza tahminlerini çekip sitenin data/infoplaza/ klasörüne yazar.
// Kullanım: INFOPLAZA_KEY=... node scripts/fetch-infoplaza.mjs <site-klasörü>
// Bölge listesi: <site-klasörü>/data/locations.json  [{ name, lat, lon }]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const site = process.argv[2] || '.';
const key = process.env.INFOPLAZA_KEY;
if (!key) { console.error('INFOPLAZA_KEY tanımlı değil (repo Settings → Secrets → Actions).'); process.exit(1); }

const locs = JSON.parse(await readFile(join(site, 'data/locations.json'), 'utf8'));
const outDir = join(site, 'data/infoplaza');
await mkdir(outDir, { recursive: true });

const KEEP = ['time', 'windSpeed', 'windGust', 'windBearing', 'temperature', 'precipIntensity', 'cloudCover', 'humidity'];
const index = { updatedAt: new Date().toISOString(), locations: [] };

for (const l of locs) {
  const lat = +(+l.lat).toFixed(4), lon = +(+l.lon).toFixed(4);
  const file = `${lat}_${lon}.json`;
  const entry = { name: l.name, lat, lon, file, fetchedAt: new Date().toISOString() };
  try {
    const q = new URLSearchParams({
      lat, lon, api_key: key, units: 'metric', language: 'en',
      max_hourly: 168, max_minutely: 0, max_daily: 0, max_daypartly: 0,
    });
    const res = await fetch(`https://api.infoplaza.com/v1/weather/forecast?${q}`, { headers: { Accept: 'application/json' } });
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch { /* yoksay */ }
    if (!res.ok || j?.success === false) throw new Error(`HTTP ${res.status} ${(j?.message || text).slice(0, 160)}`);
    const d = j?.data ?? j;
    if (!Array.isArray(d?.hourly) || !d.hourly.length) throw new Error('yanıtta hourly yok');
    const hourly = d.hourly.map(h => Object.fromEntries(KEEP.map(k => [k, h[k] ?? null])));
    await writeFile(join(outDir, file), JSON.stringify({ name: l.name, lat, lon, timezone: d.timezone ?? null, fetchedAt: entry.fetchedAt, hourly }));
    console.log(`✓ ${l.name}: ${hourly.length} saat`);
  } catch (e) {
    entry.error = String(e.message || e).replace(key, '***');
    console.log(`✗ ${l.name}: ${entry.error}`);
  }
  index.locations.push(entry);
}
await writeFile(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
if (index.locations.every(e => e.error)) process.exit(1);
