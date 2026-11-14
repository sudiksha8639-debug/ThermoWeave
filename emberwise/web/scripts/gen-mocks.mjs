// One-off generator for EMBERWISE mock data (schema_version "1.0").
// Run: node scripts/gen-mocks.mjs   (from web/)
// Output: src/mocks/*.json + src/mocks/*.csv
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src', 'mocks');
mkdirSync(out, { recursive: true });

// Deterministic PRNG so mocks are stable.
let seed = 42;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
const rand = (a, b) => a + rnd() * (b - a);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// ---------- presets ----------
// [minLon, minLat, maxLon, maxLat]
const PRESETS = {
  indian_punjab: { label: 'Indian Punjab', bbox: [74.3, 29.9, 76.3, 32.4] },
  haryana: { label: 'Haryana', bbox: [75.7, 27.6, 77.5, 30.3] },
  punjab_haryana: { label: 'Punjab + Haryana', bbox: [73.8, 27.5, 77.5, 32.5] },
};
const CONTROL = {
  id: 'control_malwa',
  label: 'Control box — Malwa (example)',
  bbox: [75.0, 30.0, 76.0, 31.0],
};

// ---------- projection ----------
const LAT0 = 30.0;
const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON = 111.32 * Math.cos((LAT0 * Math.PI) / 180); // ~96.4
const toXY = (lon, lat) => [(lon - 73.8) * KM_PER_DEG_LON, (lat - 27.5) * KM_PER_DEG_LAT];
const toLL = (x, y) => [73.8 + x / KM_PER_DEG_LON, 27.5 + y / KM_PER_DEG_LAT];

// ---------- hex grid ----------
function hexGrid(sizeKm, bboxKm) {
  const cells = [];
  const dx = Math.sqrt(3) * sizeKm;
  const dy = 1.5 * sizeKm;
  let idx = 0;
  for (let r = 0; r * dy - sizeKm < bboxKm[3]; r++) {
    const off = (r % 2) * (dx / 2);
    for (let q = 0; q * dx - sizeKm < bboxKm[2]; q++) {
      const cx = q * dx + off;
      const cy = r * dy;
      // pointy-top hex vertices
      const verts = [];
      let inside = true;
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2; // pointy top
        const vx = cx + sizeKm * Math.cos(a);
        const vy = cy + sizeKm * Math.sin(a);
        verts.push([vx, vy]);
        if (vx < bboxKm[0] - sizeKm || vx > bboxKm[2] + sizeKm || vy < bboxKm[1] - sizeKm || vy > bboxKm[3] + sizeKm) inside = false;
      }
      if (!inside) continue;
      const [lon, lat] = toLL(cx, cy);
      cells.push({ res: 6, index: idx, cx: lon, cy: lat, vertices: verts.map(([x, y]) => toLL(x, y)) });
      idx++;
    }
  }
  return cells;
}

// union bbox in km
const UNION = [73.8, 27.5, 77.5, 32.5];
const bboxKm = [toXY(UNION[0], UNION[1])[0] - 8, toXY(UNION[0], UNION[1])[1] - 8, toXY(UNION[2], UNION[3])[0] + 8, toXY(UNION[2], UNION[3])[1] + 8];

const RES6_SIZE = 3.6; // km — mock spacing (real res-6 ≈ 3.7 km)
const res6 = hexGrid(RES6_SIZE, bboxKm);
const res5 = hexGrid(10.5, bboxKm).map((c, i) => ({ ...c, res: 5, index: res6.length + i }));
const tile_geometry = [...res6, ...res5];

// tile -> preset membership (centre inside preset bbox)
function inBBox(lon, lat, b) {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}
const regionTiles = {};
for (const [id, p] of Object.entries(PRESETS)) {
  regionTiles[id] = res6.filter((t) => inBBox(t.cx, t.cy, p.bbox)).map((t) => t.index);
}
regionTiles.control_malwa = res6.filter((t) => inBBox(t.cx, t.cy, CONTROL.bbox)).map((t) => t.index);

// res-5 membership per preset (centre inside preset bbox)
const regionTiles5 = {};
for (const [id, p] of Object.entries(PRESETS)) {
  regionTiles5[id] = res5.filter((t) => inBBox(t.cx, t.cy, p.bbox)).map((t) => t.index);
}

// res6 tile -> parent res5 tile (res6 centre inside res5 hex), for aggregation
function pointInPoly(lon, lat, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const [xi, yi] = verts[i];
    const [xj, yj] = verts[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const res5Children = new Map(); // res5 index -> [res6 indices]
for (const t5 of res5) {
  const kids = [];
  for (const t6 of res6) {
    if (pointInPoly(t6.cx, t6.cy, t5.vertices)) kids.push(t6.index);
  }
  res5Children.set(t5.index, kids);
}

// ---------- tile_month (2019–2026) ----------
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
// seasonal fire curve: peaks ~Apr-May and ~Oct-Nov (month index 0-based)
function season(m) {
  const v = Math.exp(-Math.pow((m - 3.5) / 1.6, 2)) + 0.85 * Math.exp(-Math.pow((m - 9.5) / 1.8, 2));
  return 0.15 + v;
}
// Malwa belt (south Punjab ~30.3-31.0N) burns more
function malwaBoost(lat) {
  return 1 + 0.9 * Math.exp(-Math.pow((lat - 30.6) / 0.7, 2));
}
const harmMax = new Array(res6.length).fill(0);

for (const year of YEARS) {
  const rows = [];
  for (let mi = 0; mi < 12; mi++) {
    const ym = year * 12 + mi;
    for (const t of res6) {
      // skip ~55% of quiet tile-months entirely (gap, not zero)
      const s = season(mi) * malwaBoost(t.cy) * (0.6 + rnd() * 0.8);
      const eraC = ym <= 2026 * 12 + 10; // through Oct 2026
      const base = s * (eraC ? 1 : 0.7) * (year >= 2024 ? 1.15 : 1);
      if (base < 1.2 && rnd() < 0.72) continue;
      const harm = Math.max(0, Math.round(base * 12 * rand(0.4, 1.4) * 10) / 10);
      const raw_viirs = harm == null ? null : Math.round(harm * rand(0.75, 1.1) * 10) / 10;
      const raw_modis = harm == null ? null : Math.round(harm * rand(0.5, 0.95) * 10) / 10;
      const raw_hotspots = harm == null ? null : Math.round(harm * rand(0.8, 1.3) * 10) / 10;
      const spread = eraC ? rand(1.5, 4) : rand(3, 7);
      const frac = Math.min(1, harm / 25);
      harmMax[t.index] = Math.max(harmMax[t.index], harm);
      // columnar row aligned to TM_COLS
      rows.push([
        t.index, ym,
        raw_hotspots,
        harm == null ? null : Math.round(harm * rand(0.2, 0.5) * 10) / 10,
        raw_modis,
        raw_viirs,
        harm,
        harm == null ? null : Math.max(0, Math.round((harm - spread) * 10) / 10),
        harm == null ? null : Math.round((harm + spread) * 10) / 10,
        eraC ? 'VIIRS-scale estimate' : 'relay-satellite estimate',
        eraC ? 'Measured' : 'Provisional',
        frac,
      ]);
    }
  }
  // res-5 rows: aggregate res-6 children (mean of available values per column)
  {
    const COLS_N = [2, 3, 4, 5, 6, 7, 8, 11]; // numeric columns to average
    const byYm = new Map(); // ym -> Map<res6 index, row>
    for (const r of rows) {
      let m = byYm.get(r[1]);
      if (!m) byYm.set(r[1], (m = new Map()));
      m.set(r[0], r);
    }
    for (const t5 of res5) {
      const kids = res5Children.get(t5.index) ?? [];
      if (!kids.length) continue;
      for (let mi = 0; mi < 12; mi++) {
        const ym = year * 12 + mi;
        const ymRows = byYm.get(ym);
        if (!ymRows) continue;
        const childRows = kids.map((k) => ymRows.get(k)).filter(Boolean);
        if (!childRows.length) continue;
        const mean = (ci) => {
          const xs = childRows.map((r) => r[ci]).filter((v) => typeof v === 'number');
          return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
        };
        const harm5 = mean(6);
        if (harm5 === null) continue;
        if (harm5 < 1.2 && rnd() < 0.72) continue; // same gap rule as res 6
        const first = childRows[0];
        rows.push([
          t5.index, ym,
          mean(2), mean(3), mean(4), mean(5),
          harm5, mean(7), mean(8),
          first[9], first[10], mean(11),
        ]);
      }
    }
  }
  writeFileSync(join(out, `tile_month_${year}.json`), JSON.stringify({ year, columns: ['tile', 'ym', 'raw_hotspots', 'raw_tile_days', 'raw_modis', 'raw_viirs', 'harm', 'lo', 'hi', 'label', 'trust', 'frac_burning'], data: rows }));
  console.log(`tile_month_${year}.json: ${rows.length} rows`);
}

// ---------- regions ----------
const regions = {
  regions: [
    { id: 'indian_punjab', label: 'Indian Punjab', kind: 'preset', tiles_res: [6, 5], boundary_source: 'GADM 4.1 (mock)', bbox: PRESETS.indian_punjab.bbox, tiles_in_scope: { '5': regionTiles5.indian_punjab, '6': regionTiles.indian_punjab } },
    { id: 'haryana', label: 'Haryana', kind: 'preset', tiles_res: [6, 5], boundary_source: 'GADM 4.1 (mock)', bbox: PRESETS.haryana.bbox, tiles_in_scope: { '5': regionTiles5.haryana, '6': regionTiles.haryana } },
    { id: 'punjab_haryana', label: 'Punjab + Haryana', kind: 'preset', tiles_res: [6, 5], boundary_source: 'GADM 4.1 (mock)', bbox: PRESETS.punjab_haryana.bbox, tiles_in_scope: { '5': regionTiles5.punjab_haryana, '6': regionTiles.punjab_haryana } },
    { id: 'control_malwa', label: CONTROL.label, kind: 'control', tiles_res: [6, 5], boundary_source: 'user box (mock)', bbox: CONTROL.bbox, tiles_in_scope: { '5': res5.filter((t) => inBBox(t.cx, t.cy, CONTROL.bbox)).map((t) => t.index), '6': regionTiles.control_malwa } },
  ],
};
writeFileSync(join(out, 'regions.json'), JSON.stringify(regions));

// ---------- region_daily (daily, 3 presets; sample 2023 + 2024 + 2025 + 2026-to-date) ----------
const daily = { rows: [] };
for (const pid of Object.keys(PRESETS)) {
  const t0 = Date.UTC(2023, 0, 1);
  const t1 = Date.UTC(2026, 10, 13);
  for (let d = t0; d <= t1; d += 86400000) {
    const date = new Date(d).toISOString().slice(0, 10);
    const doy = new Date(d).getUTCDate();
    const month = new Date(d).getUTCMonth();
    const seas = season(month) * (0.55 + 0.45 * Math.sin((doy / 30) * Math.PI));
    if (seas < 0.22 && rnd() < 0.5) continue;
    const harm = Math.round(seas * rand(20, 120) * 10) / 10;
    daily.rows.push({
      region: pid,
      date,
      raw_modis: Math.round(harm * rand(0.5, 0.9) * 10) / 10,
      raw_viirs: Math.round(harm * rand(0.75, 1.05) * 10) / 10,
      harm,
      lo: Math.max(0, Math.round((harm - rand(4, 12)) * 10) / 10),
      hi: Math.round((harm + rand(4, 12)) * 10) / 10,
      pct_rank: Math.round(rand(5, 99) * 10) / 10,
    });
  }
}
writeFileSync(join(out, 'region_daily.json'), JSON.stringify(daily));
console.log(`region_daily.json: ${daily.rows.length} rows`);

// ---------- climatology ----------
const clim = { rows: [] };
for (const pid of Object.keys(PRESETS)) {
  for (let m = 1; m <= 12; m++) {
    for (const sensor of ['modis', 'viirs', 'harm']) {
      const mid = 8 + 30 * season(m - 1) * (pid === 'haryana' ? 0.7 : 1);
      clim.rows.push({
        region: pid,
        period: m,
        period_kind: 'month',
        sensor,
        p10: Math.round(mid * 0.4 * 10) / 10,
        p25: Math.round(mid * 0.7 * 10) / 10,
        p50: Math.round(mid * 10) / 10,
        p75: Math.round(mid * 1.35 * 10) / 10,
        p90: Math.round(mid * 1.8 * 10) / 10,
      });
    }
  }
}
writeFileSync(join(out, 'climatology.json'), JSON.stringify(clim));

// ---------- coverage (daily 2019-2026) ----------
const cov = { rows: [] };
{
  let d = Date.UTC(2019, 0, 1);
  const end = Date.UTC(2026, 10, 13);
  while (d <= end) {
    const date = new Date(d).toISOString().slice(0, 10);
    const dow = new Date(d).getUTCDay();
    cov.rows.push({ date, sensor_set: 'terra+aqua modis', product: 'MOD14A1/MYD14A1', has_data: dow !== 0 });
    cov.rows.push({ date, sensor_set: 'suomi-npp viirs', product: 'VNP14IMGT', has_data: true });
    d += 86400000;
  }
}
writeFileSync(join(out, 'coverage.json'), JSON.stringify(cov));
console.log(`coverage.json: ${cov.rows.length} rows`);

// ---------- periods / narratives ----------
writeFileSync(join(out, 'periods.json'), JSON.stringify({
  periods: [
    { start: '2019-04-01', end: '2019-05-15', severity: 'high', firm: true, sentence: 'Pre-monsoon burning in the Malwa belt ran well above the 2001–2020 median for six weeks.' },
    { start: '2020-10-20', end: '2020-11-10', severity: 'extreme', firm: true, sentence: 'Post-monsoon peak coincided with stubble-burning pressure; tile-days reached the top decile of the record.' },
    { start: '2022-04-10', end: '2022-05-05', severity: 'moderate', firm: true, sentence: 'Spring fire season slightly below normal; cloud gaps in late April are flagged as data gaps, not zeros.' },
    { start: '2024-05-01', end: '2024-05-20', severity: 'high', firm: false, sentence: 'Tentative: an intense late-April spell, still under review against VIIRS confidence filtering.' },
    { start: '2025-10-25', end: '2025-11-08', severity: 'moderate', firm: true, sentence: 'Autumn burning near the long-term median; percentile rank hovers around p60.' },
    { start: '2026-11-03', end: '', severity: 'low', firm: false, sentence: 'Relay-satellite era begins; early months are Provisional pending cross-calibration.' },
  ],
}));

// ---------- small lab files ----------
writeFileSync(join(out, 'validation.json'), JSON.stringify({
  summary: 'Mock validation summary. Real file compares harmonized tile-days against held-out VIIRS weeks.',
  metrics: { mae_tile_days: 1.8, within_band_pct: 82, n_weeks: 312 },
}));
writeFileSync(join(out, 'relay_sim.json'), JSON.stringify({
  summary: 'Mock relay-satellite simulation. Real file models the new overpass geometry.',
  points: Array.from({ length: 24 }, (_, h) => ({ hour_utc: h, rel_visits: Math.round(2 + 3 * Math.sin((h / 24) * Math.PI * 2) ** 2) })),
}));
writeFileSync(join(out, 'conversion.json'), JSON.stringify({
  summary: 'Mock MODIS→VIIRS conversion factors by month and confidence class.',
  rows: Array.from({ length: 12 }, (_, m) => ({ month: m + 1, factor: +(0.8 + 0.4 * season(m)).toFixed(3) })),
}));
writeFileSync(join(out, 'drift.json'), JSONSelectorSafe());
function JSONSelectorSafe() {
  return JSON.stringify({
    summary: 'Mock observing-time drift diagnostic for the Fire Clock Dial.',
    rows: Array.from({ length: 96 }, (_, i) => ({ ym: 2019 * 12 + i, median_local_hour: +(5.5 + 2.2 * Math.sin(i / 9)).toFixed(2) })),
  });
}
writeFileSync(join(out, 'hourly.json'), JSON.stringify({
  summary: 'Mock hourly hotspot distribution by local solar hour.',
  rows: Array.from({ length: 24 }, (_, h) => ({ local_hour: h, hotspots: Math.round(40 + 260 * Math.exp(-Math.pow((h - 13.5) / 3.2, 2)) + 30 * Math.exp(-Math.pow((h - 2.5) / 1.6, 2))) })),
}));

// ---------- hotspots CSVs (one per preset per year, fetched on click only) ----------
for (const [pid, p] of Object.entries(PRESETS)) {
  for (const year of YEARS) {
    const lines = ['satellite,date,time_utc,local_solar_time,lat,lon,frp,confidence,day_night,product'];
    const n = 40 + Math.floor(rnd() * 60);
    for (let i = 0; i < n; i++) {
      const dayOfYear = Math.floor(rand(0, 365));
      const date = new Date(Date.UTC(year, 0, 1) + dayOfYear * 86400000).toISOString().slice(0, 10);
      const utcH = Math.floor(rand(2, 22));
      const utcM = Math.floor(rand(0, 60));
      const localH = Math.floor((utcH + 5.5) % 24);
      const lat = rand(p.bbox[1], p.bbox[3]);
      const lon = rand(p.bbox[0], p.bbox[2]);
      const frp = (rand(2, 180)).toFixed(1);
      const conf = pick(['nominal', 'high', 'low', 'nominal']);
      const dn = localH >= 6 && localH < 19 ? 'day' : 'night';
      const sat = rnd() < 0.5 ? 'MODIS' : 'VIIRS';
      const prod = sat === 'MODIS' ? pick(['MOD14A1', 'MYD14A1']) : 'VNP14IMGT';
      lines.push([sat, date, `${String(utcH).padStart(2, '0')}:${String(utcM).padStart(2, '0')}`, `${String(localH).padStart(2, '0')}:${String(utcM).padStart(2, '0')}`, lat.toFixed(4), lon.toFixed(4), frp, conf, dn, prod].join(','));
    }
    writeFileSync(join(out, `hotspots_${pid}_${year}.csv`), lines.join('\n') + '\n');
  }
}
console.log('hotspots CSVs written');

// ---------- tile_geometry ----------
writeFileSync(join(out, 'tile_geometry.json'), JSON.stringify({ tile_geometry }));
console.log(`tile_geometry.json: ${tile_geometry.length} tiles (${res6.length} res6, ${res5.length} res5)`);

// ---------- manifest ----------
writeFileSync(join(out, 'manifest.json'), JSON.stringify({
  schema_version: '1.0',
  model_version: 'mock-0.1',
  boundary_source: 'GADM 4.1 (mock boundaries)',
  boundary_licence: 'CC BY 4.0',
  ai_use_note: 'Mock data for frontend development only. Not for analysis.',
  generated: new Date().toISOString(),
  precache: ['regions', 'coverage', 'validation', 'relay_sim', 'conversion', 'drift', 'hourly', 'climatology', 'periods', 'region_daily', 'tile_geometry', 'manifest', 'tile_month_2022', 'tile_month_2023', 'tile_month_2024', 'tile_month_2025', 'tile_month_2026'],
}));
console.log('done');
