// Types matching the EMBERWISE data contract (schema_version "1.0").

export interface Manifest {
  schema_version: string;
  files?: Record<string, { sha256?: string; downloaded?: string }>;
  model_version?: string;
  boundary_source?: string;
  boundary_licence?: string;
  ai_use_note?: string;
  precache?: string[];
  [k: string]: unknown;
}

export interface Region {
  id: string;
  label: string;
  kind: 'preset' | 'control';
  tiles_res: number[]; // H3 resolutions in scope, e.g. [5, 6, 7]
  boundary_source?: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  tiles_in_scope?: Record<string, number[]>; // res -> tile_geometry indices
}

export interface RegionsFile {
  regions: Region[];
}

// tile_month: columnar, one file per year, quantized values.
// `data` rows are arrays aligned to `columns` (contract column order):
// tile, ym, raw_hotspots, raw_tile_days, raw_modis, raw_viirs, harm, lo, hi,
// label, trust, frac_burning. Missing data is absent rows / null cells —
// never zero.
export const TM_COLS = [
  'tile',
  'ym',
  'raw_hotspots',
  'raw_tile_days',
  'raw_modis',
  'raw_viirs',
  'harm',
  'lo',
  'hi',
  'label',
  'trust',
  'frac_burning',
] as const;

export type TmCol = (typeof TM_COLS)[number];
export type TmCell = number | string | null;

export interface TileMonthFile {
  year: number;
  columns: string[];
  data: TmCell[][];
}

export function tmIndex(columns: string[], col: TmCol): number {
  return columns.indexOf(col);
}

export function tmGet(row: TmCell[], columns: string[], col: TmCol): TmCell {
  const i = tmIndex(columns, col);
  return i < 0 ? null : row[i];
}

export function tmNum(row: TmCell[], columns: string[], col: TmCol): number | null {
  const v = tmGet(row, columns, col);
  return typeof v === 'number' ? v : null;
}

export interface TileGeometry {
  res: number;
  index: number;
  cx: number; // projected centre x (equirectangular, degrees lon)
  cy: number;
  vertices: [number, number][]; // [lon, lat] pairs
}

export interface TileGeometryFile {
  tile_geometry: TileGeometry[];
}

export interface RegionDailyRow {
  region: string;
  date: string; // ISO
  raw_modis: number | null;
  raw_viirs: number | null;
  harm: number | null;
  lo: number | null;
  hi: number | null;
  pct_rank: number | null; // percentile vs climatology
}

export interface RegionDailyFile {
  rows: RegionDailyRow[];
}

export interface ClimatologyRow {
  region: string;
  period: number; // month 1-12 or ISO week
  period_kind: 'month' | 'week';
  sensor: string;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

export interface ClimatologyFile {
  rows: ClimatologyRow[];
}

export interface Period {
  start: string;
  end: string;
  severity: 'low' | 'moderate' | 'high' | 'extreme';
  firm: boolean; // firm or tentative
  sentence: string;
}

export interface PeriodsFile {
  periods: Period[];
}

export interface CoverageRow {
  date: string;
  sensor_set: string;
  product: string;
  has_data: boolean;
}

export interface CoverageFile {
  rows: CoverageRow[];
}

// Remaining files consumed by teammate components / Lab.
export type JsonFile = Record<string, unknown>;

export type SensorMode = 'modis' | 'viirs' | 'naive' | 'harm';

export const SENSOR_MODES: { id: SensorMode; label: string; column: TmCol }[] = [
  { id: 'modis', label: 'MODIS', column: 'raw_modis' },
  { id: 'viirs', label: 'VIIRS', column: 'raw_viirs' },
  { id: 'naive', label: 'Naive splice', column: 'raw_hotspots' },
  { id: 'harm', label: 'Harmonized', column: 'harm' },
];

export const SENSOR_MODE_LABEL: Record<SensorMode, string> = {
  modis: 'MODIS',
  viirs: 'VIIRS',
  naive: 'Naive splice',
  harm: 'Harmonized',
};

export type TrustLabel = 'Measured' | 'Estimated' | 'Indicative' | 'Provisional';

export interface Era {
  id: 'A' | 'B' | 'C' | 'D';
  name: string;
  start: string; // YYYY-MM
  end: string; // YYYY-MM, '' = open
  trust: TrustLabel;
  note: string;
}

export const ERAS: Era[] = [
  {
    id: 'A',
    name: 'Era A — Terra only',
    start: '2000-11',
    end: '2002-06',
    trust: 'Indicative',
    note: 'MODIS Terra alone. Indicative only — do not compare directly with later eras.',
  },
  {
    id: 'B',
    name: 'Era B — Terra ∪ Aqua',
    start: '2002-07',
    end: '2011-12',
    trust: 'Estimated',
    note: 'Two MODIS sensors overlap. Estimates carry wider lo–hi bands.',
  },
  {
    id: 'C',
    name: 'Era C — Suomi NPP VIIRS',
    start: '2012-01',
    end: '2026-11-02',
    trust: 'Measured',
    note: 'VIIRS becomes the reference scale. Measured, single consistent sensor.',
  },
  {
    id: 'D',
    name: 'Era D — relay satellite',
    start: '2026-11-03',
    end: '',
    trust: 'Provisional',
    note: 'New relay satellite. Latest months are Provisional until validation closes.',
  },
];

export function eraForMonth(ym: number): Era {
  const y = Math.floor(ym / 12);
  const m = ym % 12; // 0-based
  const idx = ERAS.findIndex((e) => {
    const [sy, sm] = e.start.split('-').map(Number);
    const sYm = sy * 12 + (sm - 1);
    if (ym < sYm) return false;
    if (e.end === '') return true;
    const [ey, em] = e.end.split('-').map(Number);
    const eYm = ey * 12 + (em - 1);
    return ym <= eYm;
  });
  void y;
  void m;
  return ERAS[Math.max(0, idx)];
}

export function ymToLabel(ym: number): string {
  const y = Math.floor(ym / 12);
  const m = (ym % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function ymRange(startYm: number, endYm: number): number[] {
  const out: number[] = [];
  for (let i = startYm; i <= endYm; i++) out.push(i);
  return out;
}
