// Typed loaders for the EMBERWISE static JSON contract (schema_version "1.0").
//
// Each data file is resolved INDEPENDENTLY:
//   1. try the repo file synced into public/data/ (from <repo>/mock-data via
//      scripts/sync-data.mjs, run by `npm run dev` / `npm run build`);
//   2. if it is missing, empty, or only carries schema_version, fall back to
//      the synthetic mock in src/mocks/ for that file;
//   3. every repo file is validated through a per-file adapter — a shape
//      mismatch raises DataShapeError naming the file and the bad fields
//      instead of drawing a wrong map.
//
// USE_MOCKS (VITE_USE_MOCKS=1) or DATA_SOURCE='mock' (VITE_DATA_SOURCE=mock)
// forces synthetic mocks everywhere. File statuses are exposed through
// getFileStatuses()/subscribeFileStatuses() for the "Data sources" panel.

import type {
  ClimatologyFile,
  ClimatologyRow,
  CoverageFile,
  CoverageRow,
  JsonFile,
  Manifest,
  Period,
  PeriodsFile,
  Region,
  RegionDailyFile,
  RegionDailyRow,
  RegionsFile,
  TileGeometry,
  TileGeometryFile,
  TileMonthFile,
} from './types';
import { TM_COLS } from './types';

export const DATA_SOURCE: 'auto' | 'mock' | 'real' =
  ((import.meta.env.VITE_DATA_SOURCE as string | undefined) ?? 'auto') as
    | 'auto'
    | 'mock'
    | 'real';

export const USE_MOCKS =
  DATA_SOURCE === 'mock' ||
  import.meta.env.VITE_USE_MOCKS === '1' ||
  import.meta.env.VITE_USE_MOCKS === 'true';

// ---------- file status registry (Data sources panel) ----------

export type FileSource = 'repo' | 'mock';

export interface FileStatus {
  name: string; // logical file name, e.g. 'regions', 'tile_month_2024'
  source: FileSource | null; // null while loading / before first load
  schemaVersion: string | null;
  error: string | null;
  note: string | null; // e.g. 'repo file missing or empty → mock'
}

const statuses = new Map<string, FileStatus>();
const listeners = new Set<() => void>();
let snapshot: FileStatus[] = [];

function refreshSnapshot() {
  snapshot = [...statuses.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function statusOf(name: string): FileStatus {
  let s = statuses.get(name);
  if (!s) {
    s = { name, source: null, schemaVersion: null, error: null, note: null };
    statuses.set(name, s);
  }
  return s;
}

function setStatus(name: string, patch: Partial<FileStatus>) {
  const s = { ...statusOf(name), ...patch };
  statuses.set(name, s);
  refreshSnapshot();
  listeners.forEach((fn) => fn());
}

export function getFileStatuses(): FileStatus[] {
  return snapshot;
}

export function subscribeFileStatuses(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- errors ----------

export class DataShapeError extends Error {
  readonly file: string;
  readonly problems: string[];
  constructor(file: string, problems: string[]) {
    super(`${file}: ${problems.join('; ')}`);
    this.name = 'DataShapeError';
    this.file = file;
    this.problems = problems;
  }
}

// ---------- generic fetch / cache ----------

const cache = new Map<string, Promise<unknown>>();

async function fetchText(name: string, ext: string): Promise<string> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}.${ext}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // Static hosts (and the Vite dev server) answer unknown paths with
  // index.html — treat an HTML body as "file missing".
  if (text.trimStart().startsWith('<')) throw new Error('not found (HTML response)');
  return text;
}

async function fetchJsonRaw(name: string): Promise<unknown> {
  return JSON.parse(await fetchText(name, 'json')) as unknown;
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

/** Clear the loader cache + statuses so a retry re-fetches everything. */
export function resetDataCache(): void {
  cache.clear();
  statuses.clear();
  refreshSnapshot();
  listeners.forEach((fn) => fn());
}

// ---------- stub / emptiness detection ----------

// Keys that carry provenance/meta rather than payload. A repo file whose
// keys are all meta is treated as a stub and falls back to the mock.
const META_KEYS = new Set([
  'schema_version',
  'year',
  'month',
  'generated',
  'model_version',
  'summary',
  'description',
  'note',
  'notes',
]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isObj(v)) return Object.keys(v).length === 0;
  return false;
}

/** True when the parsed JSON carries no payload (stub / schema_version only). */
export function isStubJson(raw: unknown): boolean {
  if (Array.isArray(raw)) return raw.length === 0;
  if (!isObj(raw)) return true;
  return Object.keys(raw).every((k) => META_KEYS.has(k) || isEmptyValue(raw[k]));
}

/** True when CSV text has a header but no data rows. */
function isStubCsv(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return lines.length <= 1;
}

function schemaVersionOf(raw: unknown): string | null {
  if (isObj(raw) && typeof raw.schema_version === 'string') return raw.schema_version;
  return null;
}

// ---------- mock imports (Vite glob) ----------

const mockJsonModules = import.meta.glob('./mocks/*.json') as Record<
  string,
  () => Promise<{ default: unknown }>
>;
const mockCsvModules = import.meta.glob('./mocks/*.csv', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

async function loadMockJson(name: string): Promise<unknown> {
  const loader = mockJsonModules[`./mocks/${name}.json`];
  if (!loader) throw new Error(`no synthetic mock available for ${name}`);
  return (await loader()).default;
}

async function loadMockCsv(name: string): Promise<string> {
  const loader = mockCsvModules[`./mocks/${name}.csv`];
  if (!loader) throw new Error(`no synthetic mock available for ${name}`);
  return loader();
}

// ---------- validation helpers ----------

function vstr(problems: string[], path: string, v: unknown): v is string {
  if (typeof v !== 'string') {
    problems.push(`${path}: expected string, got ${v === null ? 'null' : typeof v}`);
    return false;
  }
  return true;
}

function vnum(problems: string[], path: string, v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    problems.push(`${path}: expected finite number, got ${v === null ? 'null' : typeof v}`);
    return false;
  }
  return true;
}

function vnumOrNull(problems: string[], path: string, v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return vnum(problems, path, v);
}

function varray(problems: string[], path: string, v: unknown): unknown[] | null {
  if (!Array.isArray(v)) {
    problems.push(`${path}: expected array, got ${v === null ? 'null' : typeof v}`);
    return null;
  }
  return v;
}

// ---------- per-file adapters (one place per file shape) ----------

// regions.json — tiles_in_scope may be {res: [indices]}, [{res, tiles}], or
// a flat list; all normalise to Record<res, number[]>.
function adaptRegions(raw: unknown): RegionsFile {
  const problems: string[] = [];
  const file = 'regions';
  const root = isObj(raw) ? raw : {};
  if (!isObj(raw)) problems.push('root: expected object');
  const regionsRaw = varray(problems, 'regions', root.regions);
  const regions: Region[] = [];
  (regionsRaw ?? []).forEach((r, i) => {
    const p = `regions[${i}]`;
    if (!isObj(r)) {
      problems.push(`${p}: expected object`);
      return;
    }
    const region: Region = {
      id: typeof r.id === 'string' ? r.id : '',
      label: typeof r.label === 'string' ? r.label : '',
      kind: r.kind === 'control' ? 'control' : 'preset',
      tiles_res: Array.isArray(r.tiles_res)
        ? r.tiles_res.filter((x): x is number => typeof x === 'number')
        : [],
      bbox: Array.isArray(r.bbox) && r.bbox.length === 4
        ? (r.bbox as [number, number, number, number])
        : [0, 0, 0, 0],
      boundary_source: typeof r.boundary_source === 'string' ? r.boundary_source : undefined,
      tiles_in_scope: normalizeTilesInScope(r.tiles_in_scope, problems, p),
    };
    if (!region.id) problems.push(`${p}.id: missing`);
    if (!region.label) problems.push(`${p}.label: missing`);
    if (!Array.isArray(r.bbox) || !r.bbox.every((x) => typeof x === 'number')) {
      problems.push(`${p}.bbox: expected [w,s,e,n] numbers`);
    }
    regions.push(region);
  });
  if (problems.length) throw new DataShapeError(file, problems);
  return { regions };
}

function normalizeTilesInScope(
  v: unknown,
  problems: string[],
  path: string
): Record<string, number[]> | undefined {
  if (v === undefined || v === null) return undefined;
  const out: Record<string, number[]> = {};
  const push = (res: string, arr: unknown) => {
    const a = varray(problems, `${path}.tiles_in_scope["${res}"]`, arr);
    if (!a) return;
    const nums = a.filter((x): x is number => typeof x === 'number');
    if (nums.length !== a.length) {
      problems.push(`${path}.tiles_in_scope["${res}"]: non-numeric tile index`);
    }
    out[res] = nums;
  };
  if (Array.isArray(v)) {
    // [{res, tiles|indices|tile}] or flat number[]
    if (v.every((x) => typeof x === 'number')) {
      push('6', v);
    } else {
      v.forEach((e, i) => {
        if (!isObj(e) || typeof e.res !== 'number') {
          problems.push(`${path}.tiles_in_scope[${i}]: expected {res, tiles}`);
          return;
        }
        const list = e.tiles ?? e.indices ?? e.tile;
        push(String(e.res), list);
      });
    }
  } else if (isObj(v)) {
    for (const [res, arr] of Object.entries(v)) push(res, arr);
  } else {
    problems.push(`${path}.tiles_in_scope: unexpected ${typeof v}`);
  }
  return out;
}

// tile_geometry.json — accepts {tile_geometry:[...]}, {tiles:[...]}, a bare
// array, or an object keyed by resolution {'6':[...], '5':[...]}.
function adaptTileGeometry(raw: unknown): TileGeometryFile {
  const problems: string[] = [];
  const file = 'tile_geometry';
  let list: unknown[] | null = null;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (isObj(raw)) {
    const candidate = raw.tile_geometry ?? raw.tiles ?? raw.data;
    if (Array.isArray(candidate)) {
      list = candidate;
    } else {
      // maybe { '5': [...], '6': [...] }
      const resKeys = Object.keys(raw).filter((k) => /^\d+$/.test(k));
      if (resKeys.length && resKeys.every((k) => Array.isArray(raw[k]))) {
        list = resKeys.flatMap((k) =>
          (raw[k] as unknown[]).map((t) => (isObj(t) ? { ...t, res: t.res ?? Number(k) } : t))
        );
      } else {
        problems.push('tile_geometry: expected array or {tile_geometry:[...]}');
      }
    }
  } else {
    problems.push('tile_geometry: expected object or array');
  }
  const out: TileGeometry[] = [];
  (list ?? []).forEach((t, i) => {
    const p = `tile_geometry[${i}]`;
    if (!isObj(t)) {
      problems.push(`${p}: expected object`);
      return;
    }
    const verts = varray(problems, `${p}.vertices`, t.vertices);
    const vertices: [number, number][] = [];
    let vertsOk = true;
    (verts ?? []).forEach((vtx, j) => {
      if (
        Array.isArray(vtx) &&
        vtx.length >= 2 &&
        typeof vtx[0] === 'number' &&
        typeof vtx[1] === 'number'
      ) {
        vertices.push([vtx[0], vtx[1]]);
      } else {
        problems.push(`${p}.vertices[${j}]: expected [lon,lat]`);
        vertsOk = false;
      }
    });
    if (!vnum(problems, `${p}.res`, t.res)) return;
    if (!vnum(problems, `${p}.index`, t.index)) return;
    if (!vnum(problems, `${p}.cx`, t.cx)) return;
    if (!vnum(problems, `${p}.cy`, t.cy)) return;
    if (!vertsOk || !verts || verts.length < 3) {
      problems.push(`${p}.vertices: expected >=3 [lon,lat] pairs`);
      return;
    }
    out.push({
      res: t.res as number,
      index: t.index as number,
      cx: t.cx as number,
      cy: t.cy as number,
      vertices,
    });
  });
  if (problems.length) throw new DataShapeError(file, problems);
  return { tile_geometry: out };
}

// tile_month_YYYY.json — columnar; columns resolved by name downstream.
function adaptTileMonth(raw: unknown, year: number): TileMonthFile {
  const file = `tile_month_${year}`;

  if (!isObj(raw)) {
    throw new DataShapeError(file, ['root: expected object']);
  }

  // Existing row-based format: keep backward compatibility.
  if (Array.isArray(raw.columns) && Array.isArray(raw.data)) {
    const cols = raw.columns as string[];
    const data = raw.data as TileMonthFile['data'];

    if (!cols.includes('tile') || !cols.includes('ym')) {
      throw new DataShapeError(file, ['missing tile or ym column']);
    }

    return {
      year: typeof raw.year === 'number' ? raw.year : year,
      columns: cols,
      data,
    };
  }

  // M1 compressed columnar format.
  const source = raw.columns;
  const blocks = raw.blocks;

  if (!isObj(source) || !isObj(blocks)) {
    throw new DataShapeError(file, ['invalid compressed columns or blocks']);
  }

  const fields = [
    'tile', 'raw_hotspots', 'raw_tile_days', 'raw_modis',
    'raw_viirs', 'harm', 'lo', 'hi', 'trust', 'frac_burning',
  ] as const;

  const arrays: Record<string, unknown[]> = {};

  for (const field of fields) {
    const values = source[field];
    if (!Array.isArray(values)) {
      throw new DataShapeError(file, [`missing column ${field}`]);
    }
    arrays[field] = values;
  }

  const length = arrays.tile.length;

  if (fields.some((field) => arrays[field].length !== length)) {
    throw new DataShapeError(file, ['column lengths do not match']);
  }

  const months = blocks.ym;
  const labels = blocks.label;
  const starts = blocks.start;
  const labelCodes = raw.label_codes;

  if (
    !Array.isArray(months) ||
    !Array.isArray(labels) ||
    !Array.isArray(starts) ||
    !Array.isArray(labelCodes) ||
    starts.length !== months.length + 1
  ) {
    throw new DataShapeError(file, ['invalid month block metadata']);
  }

  const data: TileMonthFile['data'] = [];
  let monthIndex = 0;

  for (let i = 0; i < length; i++) {
    while (
      monthIndex + 1 < months.length &&
      i >= (starts[monthIndex + 1] as number)
    ) {
      monthIndex++;
    }

    const labelIndex = labels[monthIndex] as number;
    const label = labelCodes[labelIndex];

    data.push([
      arrays.tile[i] as number,
      months[monthIndex] as number,
      arrays.raw_hotspots[i] as number | null,
      arrays.raw_tile_days[i] as number | null,
      arrays.raw_modis[i] as number | null,
      arrays.raw_viirs[i] as number | null,
      arrays.harm[i] as number | null,
      arrays.lo[i] as number | null,
      arrays.hi[i] as number | null,
      label as string,
      arrays.trust[i] as number | null,
      arrays.frac_burning[i] as number | null,
    ]);
  }

  return {
    year: typeof raw.year === 'number' ? raw.year : year,
    columns: [...TM_COLS],
    data,
  };
}

// region_daily.json
function adaptRegionDaily(raw: unknown): RegionDailyFile {
  const problems: string[] = [];
  const file = 'region_daily';
  const root = isObj(raw) ? raw : {};
  const rowsRaw = varray(problems, 'rows', root.rows ?? root.data);
  const rows: RegionDailyRow[] = [];
  (rowsRaw ?? []).forEach((r, i) => {
    const p = `rows[${i}]`;
    if (!isObj(r)) {
      problems.push(`${p}: expected object`);
      return;
    }
    const row: RegionDailyRow = {
      region: '',
      date: '',
      raw_modis: null,
      raw_viirs: null,
      harm: null,
      lo: null,
      hi: null,
      pct_rank: null,
    };
    if (vstr(problems, `${p}.region`, r.region)) row.region = r.region as string;
    if (vstr(problems, `${p}.date`, r.date)) row.date = r.date as string;
    for (const k of ['raw_modis', 'raw_viirs', 'harm', 'lo', 'hi', 'pct_rank'] as const) {
      if (!vnumOrNull(problems, `${p}.${k}`, r[k])) continue;
      row[k] = (r[k] ?? null) as number | null;
    }
    rows.push(row);
  });
  if (problems.length) throw new DataShapeError(file, problems);
  return { rows };
}

// climatology.json
function adaptClimatology(raw: unknown): ClimatologyFile {
  const problems: string[] = [];
  const file = 'climatology';
  const root = isObj(raw) ? raw : {};
  const rowsRaw = varray(problems, 'rows', root.rows ?? root.data);
  const rows: ClimatologyRow[] = [];
  (rowsRaw ?? []).forEach((r, i) => {
    const p = `rows[${i}]`;
    if (!isObj(r)) {
      problems.push(`${p}: expected object`);
      return;
    }
    const row: ClimatologyRow = {
      region: '',
      period: 0,
      period_kind: 'month',
      sensor: '',
      p10: null,
      p25: null,
      p50: null,
      p75: null,
      p90: null,
    };
    if (vstr(problems, `${p}.region`, r.region)) row.region = r.region as string;
    if (vnum(problems, `${p}.period`, r.period)) row.period = r.period as number;
    if (r.period_kind === 'week' || r.period_kind === 'month') row.period_kind = r.period_kind;
    else problems.push(`${p}.period_kind: expected "month"|"week"`);
    if (vstr(problems, `${p}.sensor`, r.sensor)) row.sensor = r.sensor as string;
    for (const k of ['p10', 'p25', 'p50', 'p75', 'p90'] as const) {
      if (!vnumOrNull(problems, `${p}.${k}`, r[k])) continue;
      row[k] = (r[k] ?? null) as number | null;
    }
    rows.push(row);
  });
  if (problems.length) throw new DataShapeError(file, problems);
  return { rows };
}

// periods.json
function adaptPeriods(raw: unknown): PeriodsFile {
  const problems: string[] = [];
  const file = 'periods';
  const root = isObj(raw) ? raw : {};
  const periodsRaw = varray(problems, 'periods', root.periods ?? root.rows ?? root.data);
  const periods: Period[] = [];
  (periodsRaw ?? []).forEach((r, i) => {
    const p = `periods[${i}]`;
    if (!isObj(r)) {
      problems.push(`${p}: expected object`);
      return;
    }
    const sev = r.severity;
    if (sev !== 'low' && sev !== 'moderate' && sev !== 'high' && sev !== 'extreme') {
      problems.push(`${p}.severity: expected low|moderate|high|extreme`);
    }
    if (typeof r.firm !== 'boolean') problems.push(`${p}.firm: expected boolean`);
    const period: Period = {
      start: typeof r.start === 'string' ? r.start : '',
      end: typeof r.end === 'string' ? r.end : '',
      severity: sev as Period['severity'],
      firm: r.firm === true,
      sentence: typeof r.sentence === 'string' ? r.sentence : '',
    };
    if (!period.start) problems.push(`${p}.start: missing`);
    if (!period.sentence) problems.push(`${p}.sentence: missing`);
    periods.push(period);
  });
  if (problems.length) throw new DataShapeError(file, problems);
  return { periods };
}

// coverage.json
function adaptCoverage(raw: unknown): CoverageFile {
  const problems: string[] = [];
  const file = 'coverage';
  const root = isObj(raw) ? raw : {};
  const rowsRaw = varray(problems, 'rows', root.rows ?? root.data);
  const rows: CoverageRow[] = [];
  (rowsRaw ?? []).forEach((r, i) => {
    const p = `rows[${i}]`;
    if (!isObj(r)) {
      problems.push(`${p}: expected object`);
      return;
    }
    if (vstr(problems, `${p}.date`, r.date)) {
      rows.push({
        date: r.date as string,
        sensor_set: typeof r.sensor_set === 'string' ? r.sensor_set : '',
        product: typeof r.product === 'string' ? r.product : '',
        has_data: r.has_data === true,
      });
    }
  });
  if (problems.length) throw new DataShapeError(file, problems);
  return { rows };
}

// manifest.json — mostly meta; accept any object, keep schema_version.
function adaptManifest(raw: unknown): Manifest {
  if (!isObj(raw)) throw new DataShapeError('manifest', ['root: expected object']);
  return raw as Manifest;
}

// Free-form lab files (hourly, drift, conversion, validation, relay_sim,
// narratives, tile_day): must be a JSON object; contents are teammate-owned.
function adaptJsonFile(raw: unknown, name: string): JsonFile {
  if (!isObj(raw)) throw new DataShapeError(name, ['root: expected object']);
  return raw as JsonFile;
}

// hotspots_<preset>_<year>.csv — validate the header contract.
const HOTSPOT_COLS = [
  'satellite', 'date', 'time_utc', 'local_solar_time', 'lat', 'lon',
  'frp', 'confidence', 'day_night', 'product',
];

function adaptHotspotsCsv(text: string, name: string): string {
  const header = text.split('\n', 1)[0]?.trim() ?? '';
  const cols = header.split(',').map((c) => c.trim());
  const missing = HOTSPOT_COLS.filter((c) => !cols.includes(c));
  if (missing.length) {
    throw new DataShapeError(name, [`CSV header missing columns: ${missing.join(', ')}`]);
  }
  return text;
}

// ---------- resolution engine ----------

interface JsonSpec<T> {
  name: string;
  adapt: (raw: unknown) => T;
}

async function resolveJsonFile<T>(spec: JsonSpec<T>): Promise<T> {
  if (!USE_MOCKS) {
    let note: string | null = null;
    try {
      const raw = await fetchJsonRaw(spec.name);
      if (!isStubJson(raw)) {
        const adapted = spec.adapt(raw); // throws DataShapeError on mismatch
        const sv = schemaVersionOf(raw);
        setStatus(spec.name, { source: 'repo', schemaVersion: sv, error: null, note: null });
        console.info(
          `[EMBERWISE data] ${spec.name}.json ← repo data` +
            (sv ? ` (schema_version ${sv})` : '')
        );
        return adapted;
      }
      note = 'repo file missing or empty (schema_version only)';
    } catch (e) {
      if (e instanceof DataShapeError) {
        setStatus(spec.name, { source: null, schemaVersion: null, error: e.message, note: null });
        throw e;
      }
      note = `repo fetch failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    // fall through to mock
    try {
      const raw = await loadMockJson(spec.name);
      const adapted = spec.adapt(raw);
      const sv = schemaVersionOf(raw);
      setStatus(spec.name, { source: 'mock', schemaVersion: sv, error: null, note });
      console.info(`[EMBERWISE data] ${spec.name}.json ← synthetic mock (${note})`);
      return adapted;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(spec.name, { source: null, schemaVersion: null, error: msg, note });
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  // USE_MOCKS: synthetic only
  const raw = await loadMockJson(spec.name);
  const adapted = spec.adapt(raw);
  const sv = schemaVersionOf(raw);
  setStatus(spec.name, { source: 'mock', schemaVersion: sv, error: null, note: 'USE_MOCKS override' });
  console.info(`[EMBERWISE data] ${spec.name}.json ← synthetic mock (USE_MOCKS)`);
  return adapted;
}

async function resolveHotspotsCsv(name: string): Promise<string> {
  if (!USE_MOCKS) {
    let note: string | null = null;
    try {
      const text = await fetchText(name, 'csv');
      if (!isStubCsv(text)) {
        const csv = adaptHotspotsCsv(text, name);
        setStatus(name, { source: 'repo', schemaVersion: 'csv', error: null, note: null });
        console.info(`[EMBERWISE data] ${name}.csv ← repo data`);
        return csv;
      }
      note = 'repo file empty (header only)';
    } catch (e) {
      if (e instanceof DataShapeError) {
        setStatus(name, { source: null, schemaVersion: null, error: e.message, note: null });
        throw e;
      }
      note = `repo fetch failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      const csv = adaptHotspotsCsv(await loadMockCsv(name), name);
      setStatus(name, { source: 'mock', schemaVersion: 'csv', error: null, note });
      console.info(`[EMBERWISE data] ${name}.csv ← synthetic mock (${note})`);
      return csv;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(name, { source: null, schemaVersion: null, error: msg, note });
      throw e instanceof Error ? e : new Error(msg);
    }
  }
  const csv = adaptHotspotsCsv(await loadMockCsv(name), name);
  setStatus(name, { source: 'mock', schemaVersion: 'csv', error: null, note: 'USE_MOCKS override' });
  return csv;
}

// ---------- public loaders (names kept stable for teammates) ----------

export function loadManifest(): Promise<Manifest> {
  return cached('manifest', () => resolveJsonFile<Manifest>({ name: 'manifest', adapt: adaptManifest }));
}

export function loadRegions(): Promise<RegionsFile> {
  return cached('regions', () => resolveJsonFile<RegionsFile>({ name: 'regions', adapt: adaptRegions }));
}

export function loadCoverage(): Promise<CoverageFile> {
  return cached('coverage', () => resolveJsonFile<CoverageFile>({ name: 'coverage', adapt: adaptCoverage }));
}

export function loadValidation(): Promise<JsonFile> {
  return cached('validation', () => resolveJsonFile<JsonFile>({ name: 'validation', adapt: (r) => adaptJsonFile(r, 'validation') }));
}

export function loadRelaySim(): Promise<JsonFile> {
  return cached('relay_sim', () => resolveJsonFile<JsonFile>({ name: 'relay_sim', adapt: (r) => adaptJsonFile(r, 'relay_sim') }));
}

export function loadConversion(): Promise<JsonFile> {
  return cached('conversion', () => resolveJsonFile<JsonFile>({ name: 'conversion', adapt: (r) => adaptJsonFile(r, 'conversion') }));
}

export function loadDrift(): Promise<JsonFile> {
  return cached('drift', () => resolveJsonFile<JsonFile>({ name: 'drift', adapt: (r) => adaptJsonFile(r, 'drift') }));
}

export function loadHourly(): Promise<JsonFile> {
  return cached('hourly', () => resolveJsonFile<JsonFile>({ name: 'hourly', adapt: (r) => adaptJsonFile(r, 'hourly') }));
}

export function loadClimatology(): Promise<ClimatologyFile> {
  return cached('climatology', () => resolveJsonFile<ClimatologyFile>({ name: 'climatology', adapt: adaptClimatology }));
}

export function loadPeriods(): Promise<PeriodsFile> {
  return cached('periods', () => resolveJsonFile<PeriodsFile>({ name: 'periods', adapt: adaptPeriods }));
}

export function loadRegionDaily(): Promise<RegionDailyFile> {
  return cached('region_daily', () => resolveJsonFile<RegionDailyFile>({ name: 'region_daily', adapt: adaptRegionDaily }));
}

export function loadTileGeometry(): Promise<TileGeometryFile> {
  return cached('tile_geometry', () => resolveJsonFile<TileGeometryFile>({ name: 'tile_geometry', adapt: adaptTileGeometry }));
}

export function loadNarratives(): Promise<JsonFile> {
  return cached('narratives', () => resolveJsonFile<JsonFile>({ name: 'narratives', adapt: (r) => adaptJsonFile(r, 'narratives') }));
}

export function loadTileDay(): Promise<JsonFile> {
  return cached('tile_day', () => resolveJsonFile<JsonFile>({ name: 'tile_day', adapt: (r) => adaptJsonFile(r, 'tile_day') }));
}

// tile_month files are per-year and lazy-loaded.
export function loadTileMonth(year: number): Promise<TileMonthFile> {
  return cached(`tile_month_${year}`, () =>
    resolveJsonFile<TileMonthFile>({ name: `tile_month_${year}`, adapt: (r) => adaptTileMonth(r, year) })
  );
}

/** Years the app knows how to request tile_month files for. */
export function tileMonthYears(): number[] {
  return [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
}

// Hotspot-level CSVs: one file per preset per year. Fetched ONLY on click.
export function fetchHotspotsCsv(presetId: string, year: number): Promise<string> {
  const name = `hotspots_${presetId}_${year}`;
  return cached(name, () => resolveHotspotsCsv(name));
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

// Re-exported for adapters/tests.
export { TM_COLS };
