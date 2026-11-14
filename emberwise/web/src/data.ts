// Typed loaders for the EMBERWISE static JSON contract (schema_version "1.0").
//
// DATA_SOURCE switches between bundled mocks (src/mocks/) and the real
// pre-built files served from public/data/. To go live, change this one
// constant to 'real' (or set VITE_DATA_SOURCE=real at build time).

import type {
  ClimatologyFile,
  CoverageFile,
  JsonFile,
  Manifest,
  PeriodsFile,
  RegionDailyFile,
  RegionsFile,
  TileGeometryFile,
  TileMonthFile,
} from './types';

export const DATA_SOURCE: 'mock' | 'real' =
  (import.meta.env.VITE_DATA_SOURCE as 'mock' | 'real' | undefined) ?? 'mock';

const cache = new Map<string, Promise<unknown>>();

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}.json`);
  if (!res.ok) throw new Error(`Failed to load data/${name}.json (${res.status})`);
  return (await res.json()) as T;
}

function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = loader();
    cache.set(key, p);
    p.catch(() => cache.delete(key)); // allow retry after failure
  }
  return p;
}

// ---------- core files ----------

export function loadManifest(): Promise<Manifest> {
  return cached('manifest', async () => {
    const m =
      DATA_SOURCE === 'mock'
        ? ((await import('./mocks/manifest.json')).default as Manifest)
        : await fetchJson<Manifest>('manifest');
    if (m.schema_version !== '1.0') {
      console.warn(
        `[EMBERWISE] manifest.schema_version is "${m.schema_version}", expected "1.0". Data may not match the contract.`
      );
    }
    return m;
  });
}

export function loadRegions(): Promise<RegionsFile> {
  return cached('regions', () =>
    DATA_SOURCE === 'mock'
      ? import('./mocks/regions.json').then((m) => m.default as unknown as RegionsFile)
      : fetchJson<RegionsFile>('regions')
  );
}

export function loadCoverage(): Promise<CoverageFile> {
  return cached('coverage', () =>
    DATA_SOURCE === 'mock'
      ? import('./mocks/coverage.json').then((m) => m.default as CoverageFile)
      : fetchJson<CoverageFile>('coverage')
  );
}

export function loadValidation(): Promise<JsonFile> {
  return cached('validation', () =>
    DATA_SOURCE === 'mock'
      ? import('./mocks/validation.json').then((m) => m.default as JsonFile)
      : fetchJson<JsonFile>('validation')
  );
}

export function loadRelaySim(): Promise<JsonFile> {
  return cached('relay_sim', () =>
    DATA_SOURCE === 'mock'
      ? import('./mocks/relay_sim.json').then((m) => m.default as JsonFile)
      : fetchJson<JsonFile>('relay_sim')
  );
}

export function loadConversion(): Promise<JsonFile> {
  return cached('conversion', () =>
    DATA_SOURCE === 'mock'
      ? import('./mocks/conversion.json').then((m) => m.default as JsonFile)
      : fetchJson<JsonFile>('conversion')
  );
}

export function loadDrift(): Promise<JsonFile> {
  return cached('drift', () =>
    DATA_SOURCE === 'mock'
      ? import('./mocks/drift.json').then((m) => m.default as JsonFile)
      : fetchJson<JsonFile>('drift')
  );
}

export function loadHourly(): Promise<JsonFile> {
  return cached('hourly', () =>
    DATA_SOURCE === 'mock'
      ? import('./mocks/hourly.json').then((m) => m.default as JsonFile)
      : fetchJson<JsonFile>('hourly')
  );
}

export function loadClimatology(): Promise<ClimatologyFile> {
  return cached('climatology', () =>
    DATA_SOURCE === 'mock'
      ? import('./mocks/climatology.json').then((m) => m.default as ClimatologyFile)
      : fetchJson<ClimatologyFile>('climatology')
  );
}

export function loadPeriods(): Promise<PeriodsFile> {
  return cached('periods', () =>
    DATA_SOURCE === 'mock'
      ? import('./mocks/periods.json').then((m) => m.default as PeriodsFile)
      : fetchJson<PeriodsFile>('periods')
  );
}

export function loadRegionDaily(): Promise<RegionDailyFile> {
  return cached('region_daily', () =>
    DATA_SOURCE === 'mock'
      ? import('./mocks/region_daily.json').then((m) => m.default as RegionDailyFile)
      : fetchJson<RegionDailyFile>('region_daily')
  );
}

export function loadTileGeometry(): Promise<TileGeometryFile> {
  return cached('tile_geometry', () =>
    DATA_SOURCE === 'mock'
      ? import('./mocks/tile_geometry.json').then((m) => m.default as TileGeometryFile)
      : fetchJson<TileGeometryFile>('tile_geometry')
  );
}

// tile_month files are per-year and lazy-loaded.
export function loadTileMonth(year: number): Promise<TileMonthFile> {
  return cached(`tile_month_${year}`, () =>
    DATA_SOURCE === 'mock'
      ? import(`./mocks/tile_month_${year}.json`).then((m) => m.default as TileMonthFile)
      : fetchJson<TileMonthFile>(`tile_month_${year}`)
  );
}

export function tileMonthYears(): number[] {
  // Years available in mock mode (must match generated files).
  return DATA_SOURCE === 'mock' ? [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026] : [];
}

// Hotspot-level CSVs: one file per preset per year. Fetched ONLY on click.
export async function fetchHotspotsCsv(presetId: string, year: number): Promise<string> {
  const name = `hotspots_${presetId}_${year}`;
  if (DATA_SOURCE === 'mock') {
    const mod = (await import(`./mocks/${name}.csv?raw`)) as { default: string };
    return mod.default;
  }
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}.csv`);
  if (!res.ok) throw new Error(`Failed to load data/${name}.csv (${res.status})`);
  return res.text();
}

export function downloadText(filename: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
