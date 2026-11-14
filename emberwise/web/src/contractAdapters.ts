// Adapters from the M3 data contract (schema_version 1.1, see emberwise/docs/schema.md)
// to the frontend types in ./types. The files on disk are columnar and quantized to stay
// inside the size budget; these functions turn them into the row shapes the UI already uses.
//
// Usage (in data.ts): fetch the JSON, then pass it through the matching adapt* function.
//   const manifest = await getJson<RawManifest>('manifest.json');
//   const tm = adaptTileMonth(await getJson<RawTileMonth>('tile_month_2024.json'), manifest);
//
// Rules the UI must keep: a null cell is a gap, never zero; MODIS and VIIRS are never added;
// any file with "mock": true must not be shown as real.

import { TM_COLS } from './types';
import type {
  ClimatologyFile, ClimatologyRow, CoverageFile, CoverageRow, Manifest, Period, PeriodsFile,
  Region, RegionDailyFile, RegionDailyRow, RegionsFile, TileGeometry, TileGeometryFile,
  TileMonthFile, TmCell,
} from './types';

// ---------------------------------------------------------------- raw contract shapes

export interface RawEnvelope { schema_version: string; generated_at: string; mock: boolean }

export interface RawManifest extends RawEnvelope {
  as_of: string;
  months: string[]; // 'YYYY-MM'; a ym index in any file is a position in this list
  provisional_from: string | null;
  labels: string[];
  presets: string[];
  default_preset: string;
  model_version: string | null;
  boundary: { source: string | null; licence: string | null };
  ai_use_note: string;
  safety_disclaimer: string;
  precache: string[]; // file paths relative to the data folder
  files: { path: string; contract: string; bytes: number; sha256: string }[];
}

export interface RawTileMonth extends RawEnvelope {
  year: number;
  label_codes: string[];
  blocks: { ym: number[]; label: number[]; start: number[] };
  columns: {
    tile: number[]; raw_hotspots: number[]; raw_tile_days: number[];
    raw_modis: (number | null)[]; raw_viirs: (number | null)[];
    harm: (number | null)[]; lo: (number | null)[]; hi: (number | null)[];
    trust: (number | null)[]; frac_burning: (number | null)[];
  };
}

export interface RawTileGeometry extends RawEnvelope {
  res: number; tiles: string[]; lng: number[]; lat: number[]; verts: number[];
  regions: string[]; region: number[]; zones: string[]; zone: number[];
  fallback: { res: number; tiles: string[]; verts: number[]; parent: number[] };
}

export interface RawRegions extends RawEnvelope {
  regions: {
    id: string; label: string; kind: 'preset' | 'control'; default: boolean;
    tiles_in_scope: { r5: number | null; r6: number; r7: number | null };
    boundary_source: string; bbox: [number, number, number, number];
  }[];
}

type Series = (number | null)[];

export interface RawRegionDaily extends RawEnvelope {
  epoch: string; n_days: number; label_codes: string[];
  presets: Record<string, {
    tile_count: number; modis_td: Series; viirs_td: Series; modis_hotspots: Series; viirs_hotspots: Series;
    harm: Series; lo: Series; hi: Series; frac_burning: Series; pct_rank: Series; label: number[];
  }>;
}

type Percentiles = { p10: Series; p25: Series; p50: Series; p75: Series; p90: Series; n_years: number };

export interface RawClimatology extends RawEnvelope {
  weeks: number; window_weeks: number; unit: string;
  presets: Record<string, { modis: Percentiles; viirs: Percentiles }>;
}

export interface RawPeriods extends RawEnvelope {
  presets: Record<string, {
    start: string; end: string; days: number; status: 'firm' | 'tentative';
    severity: number | null; peak_date: string; peak_value: number; label: string; sentence: string;
  }[]>;
}

export interface RawCoverage extends RawEnvelope {
  epoch: string; sensor_sets: string[]; products: string[];
  columns: { sensor_set: number[]; product: number[]; start: number[]; end: number[]; has_data: boolean[] };
}

// ---------------------------------------------------------------- helpers

/** Base regions (tile_geometry.regions) that make up each preset. */
export const PRESET_PARTS: Record<string, string[]> = {
  indian_punjab: ['punjab'],
  haryana: ['haryana'],
  punjab_haryana: ['punjab', 'haryana'],
};

/** 'YYYY-MM' -> the frontend's month number (year * 12 + zero-based month). */
export function ymFromMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return y * 12 + (m - 1);
}

/** Days since the file's epoch -> ISO date. */
export function dayToIso(epoch: string, day: number): string {
  const [y, m, d] = epoch.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + day * 86_400_000).toISOString().slice(0, 10);
}

function pairs(flat: number[], from: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < 6; k++) out.push([flat[from + 2 * k], flat[from + 2 * k + 1]]);
  return out;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ---------------------------------------------------------------- adapters

/** tile_month_YYYY.json -> row arrays in TM_COLS order. `label` becomes the label name. */
export function adaptTileMonth(raw: RawTileMonth, manifest: RawManifest): TileMonthFile {
  const c = raw.columns;
  const data: TmCell[][] = [];
  for (let b = 0; b < raw.blocks.ym.length; b++) {
    const ym = ymFromMonth(manifest.months[raw.blocks.ym[b]]);
    const label = raw.label_codes[raw.blocks.label[b]];
    for (let i = raw.blocks.start[b]; i < raw.blocks.start[b + 1]; i++) {
      data.push([c.tile[i], ym, c.raw_hotspots[i], c.raw_tile_days[i], c.raw_modis[i], c.raw_viirs[i],
        c.harm[i], c.lo[i], c.hi[i], label, c.trust[i], c.frac_burning[i]]);
    }
  }
  return { year: raw.year, columns: [...TM_COLS], data };
}

/**
 * tile_geometry.json -> one list with a unique `index`.
 * Res-6 tiles keep their contract index (0..n-1), which is what tile_month.tile refers to.
 * Res-5 fallback tiles follow, with index = n + position.
 */
export function adaptTileGeometry(raw: RawTileGeometry): TileGeometryFile {
  const out: TileGeometry[] = [];
  for (let i = 0; i < raw.tiles.length; i++) {
    out.push({ res: raw.res, index: i, cx: raw.lng[i], cy: raw.lat[i], vertices: pairs(raw.verts, 12 * i) });
  }
  const n = raw.tiles.length;
  for (let j = 0; j < raw.fallback.tiles.length; j++) {
    const vertices = pairs(raw.fallback.verts, 12 * j);
    out.push({ res: raw.fallback.res, index: n + j, cx: mean(vertices.map((v) => v[0])),
      cy: mean(vertices.map((v) => v[1])), vertices });
  }
  return { tile_geometry: out };
}

/** Index (in the adapted geometry list) of the res-5 tile that contains a res-6 tile. */
export function res5IndexOf(raw: RawTileGeometry, tile: number): number {
  return raw.tiles.length + raw.fallback.parent[tile];
}

/** regions.json -> frontend regions, with tile index lists built from the geometry file. */
export function adaptRegions(raw: RawRegions, geometry: RawTileGeometry): RegionsFile {
  const regions: Region[] = raw.regions.map((r) => {
    const parts = (PRESET_PARTS[r.id] ?? []).map((p) => geometry.regions.indexOf(p));
    const r6: number[] = [];
    geometry.region.forEach((code, i) => { if (parts.includes(code)) r6.push(i); });
    const r5 = Array.from(new Set(r6.map((i) => res5IndexOf(geometry, i))));
    return { id: r.id, label: r.label, kind: r.kind, tiles_res: [5, 6, 7], boundary_source: r.boundary_source,
      bbox: r.bbox, tiles_in_scope: { '5': r5, '6': r6 } };
  });
  return { regions };
}

/** region_daily.json -> one row per preset and day. raw_modis / raw_viirs are tile-days. */
export function adaptRegionDaily(raw: RawRegionDaily): RegionDailyFile {
  const rows: RegionDailyRow[] = [];
  for (const [region, s] of Object.entries(raw.presets)) {
    for (let d = 0; d < raw.n_days; d++) {
      rows.push({ region, date: dayToIso(raw.epoch, d), raw_modis: s.modis_td[d], raw_viirs: s.viirs_td[d],
        harm: s.harm[d], lo: s.lo[d], hi: s.hi[d], pct_rank: s.pct_rank[d] });
    }
  }
  return { rows };
}

/** climatology.json -> one row per preset, sensor and week (period 1..52). */
export function adaptClimatology(raw: RawClimatology): ClimatologyFile {
  const rows: ClimatologyRow[] = [];
  for (const [region, sensors] of Object.entries(raw.presets)) {
    for (const [sensor, p] of [['MODIS', sensors.modis], ['VIIRS', sensors.viirs]] as const) {
      for (let w = 0; w < raw.weeks; w++) {
        rows.push({ region, period: w + 1, period_kind: 'week', sensor, p10: p.p10[w], p25: p.p25[w],
          p50: p.p50[w], p75: p.p75[w], p90: p.p90[w] });
      }
    }
  }
  return { rows };
}

/**
 * Severity in the contract is a number (0.8 = 80% above the median for those dates).
 * These cut points only choose a display word. [verify with M3 before quoting them anywhere]
 */
export const SEVERITY_CUTS = { moderate: 0.25, high: 0.75, extreme: 1.5 };

export function severityWord(severity: number | null): Period['severity'] {
  if (severity === null || severity < SEVERITY_CUTS.moderate) return 'low';
  if (severity < SEVERITY_CUTS.high) return 'moderate';
  if (severity < SEVERITY_CUTS.extreme) return 'high';
  return 'extreme';
}

/** periods.json -> the periods of one preset. */
export function adaptPeriods(raw: RawPeriods, preset: string): PeriodsFile {
  const periods: Period[] = (raw.presets[preset] ?? []).map((p) => ({
    start: p.start, end: p.end, severity: severityWord(p.severity), firm: p.status === 'firm', sentence: p.sentence,
  }));
  return { periods };
}

/** coverage.json (runs) -> one row per sensor set and day. Days in no run mean the sensor did not exist. */
export function adaptCoverage(raw: RawCoverage): CoverageFile {
  const rows: CoverageRow[] = [];
  const c = raw.columns;
  for (let i = 0; i < c.start.length; i++) {
    for (let d = c.start[i]; d <= c.end[i]; d++) {
      rows.push({ date: dayToIso(raw.epoch, d), sensor_set: raw.sensor_sets[c.sensor_set[i]],
        product: raw.products[c.product[i]], has_data: c.has_data[i] });
    }
  }
  return { rows };
}

/** manifest.json -> the frontend manifest. `precache` entries are file paths under the data folder. */
export function adaptManifest(raw: RawManifest): Manifest {
  const files: Record<string, { sha256?: string; downloaded?: string }> = {};
  for (const f of raw.files) files[f.path] = { sha256: f.sha256 };
  return { ...raw, schema_version: raw.schema_version, files, model_version: raw.model_version ?? undefined,
    boundary_source: raw.boundary.source ?? undefined, boundary_licence: raw.boundary.licence ?? undefined,
    ai_use_note: raw.ai_use_note, precache: raw.precache };
}
