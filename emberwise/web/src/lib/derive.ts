// Derived diagnostics computed in the browser from the loaded data files.
//
// Everything here is additive and transparent: the app never invents a
// scientific value. When a diagnostic needs a file that has not been supplied
// yet, the caller renders an explicit "not supplied" state instead of a
// placeholder number.
//
// The helpers are pure so they can be reused by the calendar, the series, the
// Phantom Surge reveal and every Transparency Lab panel.

import {
  eraForYm,
  tmNum,
  ymToLabel,
  ERAS,
  type Era,
  type RegionDailyRow,
  type TileMonthFile,
  type TrustLabel,
} from '../types';

export interface MonthAgg {
  ym: number;
  year: number;
  month: number; // 1-12
  /** Sum of harmonized tile-days across in-scope tiles. */
  harm: number | null;
  lo: number | null;
  hi: number | null;
  /** Raw hotspot count (never the same thing as harmonized tile-days). */
  hotspots: number | null;
  modis: number | null;
  viirs: number | null;
  /** In-scope tiles with a harmonized value this month. */
  tiles: number;
  fracMean: number | null;
  fracMax: number | null;
  /** Tiles at or above the saturation threshold this month. */
  nearSat: number;
}

const SAT_FRAC = 0.5;

function add(a: number | null, b: number | null): number | null {
  if (b === null) return a;
  if (a === null) return b;
  return a + b;
}

/**
 * Aggregate a year's columnar tile-month rows into one row per month.
 * `inScope` restricts the sum to a region's tiles (null = whole file).
 */
export function aggregateTileMonths(
  files: TileMonthFile[],
  inScope: Set<number> | null
): MonthAgg[] {
  const acc = new Map<number, MonthAgg>();
  const fracCounts = new Map<number, number>();
  for (const file of files) {
    const cols = file.columns;
    for (const row of file.data) {
      const tile = tmNum(row, cols, 'tile');
      const ym = tmNum(row, cols, 'ym');
      if (tile === null || ym === null) continue;
      if (inScope && !inScope.has(tile)) continue;

      let a = acc.get(ym);
      if (!a) {
        const year = Math.floor(ym / 12);
        a = {
          ym,
          year,
          month: (ym % 12) + 1,
          harm: null,
          lo: null,
          hi: null,
          hotspots: null,
          modis: null,
          viirs: null,
          tiles: 0,
          fracMean: null,
          fracMax: null,
          nearSat: 0,
        };
        acc.set(ym, a);
      }

      const harm = tmNum(row, cols, 'harm');
      a.harm = add(a.harm, harm);
      a.lo = add(a.lo, tmNum(row, cols, 'lo'));
      a.hi = add(a.hi, tmNum(row, cols, 'hi'));
      a.hotspots = add(a.hotspots, tmNum(row, cols, 'raw_hotspots'));
      a.modis = add(a.modis, tmNum(row, cols, 'raw_modis'));
      a.viirs = add(a.viirs, tmNum(row, cols, 'raw_viirs'));
      if (harm !== null) a.tiles += 1;

            const frac = tmNum(row, cols, 'frac_burning');
      if (frac !== null) {
        a.fracMean = add(a.fracMean, frac);
        a.fracMax = a.fracMax === null ? frac : Math.max(a.fracMax, frac);
        if (frac >= SAT_FRAC) a.nearSat += 1;

        fracCounts.set(ym, (fracCounts.get(ym) ?? 0) + 1);
      }
    }
  }

  const out = [...acc.values()].sort((a, b) => a.ym - b.ym);

  for (const m of out) {
    const count = fracCounts.get(m.ym) ?? 0;

    if (m.fracMean !== null && count > 0) {
      m.fracMean = m.fracMean / count;
    }
  }

  return out;
}

/** Era for a month, using manifest eras when the caller has them. */
export function eraOfYm(ym: number, eras: Era[] = ERAS) {
  return eraForYm(ym, eras);
}

// ---------- calendar matrix ----------

export interface CalendarCell {
  ym: number;
  agg: MonthAgg | null;
}

export interface CalendarGrid {
  years: number[];
  /** year -> 12 cells, January first. */
  cells: Map<number, CalendarCell[]>;
  maxHarm: number;
  maxHotspots: number;
}

export function calendarGrid(months: MonthAgg[]): CalendarGrid {
  const years = [...new Set(months.map((m) => m.year))].sort((a, b) => a - b);
  const cells = new Map<number, CalendarCell[]>();
  for (const y of years) cells.set(y, Array.from({ length: 12 }, () => ({ ym: 0, agg: null })));
  for (const m of months) {
    const row = cells.get(m.year);
    if (!row) continue;
    row[m.month - 1] = { ym: m.ym, agg: m };
  }
  const maxHarm = Math.max(0, ...months.map((m) => m.harm ?? 0));
  const maxHotspots = Math.max(0, ...months.map((m) => m.hotspots ?? 0));
  return { years, cells, maxHarm, maxHotspots };
}

/** Five busiest months, by harmonized activity. */
export function busiestMonths(months: MonthAgg[], n = 5): MonthAgg[] {
  return [...months]
    .filter((m) => (m.harm ?? 0) > 0)
    .sort((a, b) => (b.harm ?? 0) - (a.harm ?? 0))
    .slice(0, n);
}

/** One value per calendar year for the year totals strip. */
export function yearlyTotals(months: MonthAgg[]): { year: number; harm: number | null; hotspots: number | null }[] {
  const map = new Map<number, { year: number; harm: number | null; hotspots: number | null }>();
  for (const m of months) {
    let y = map.get(m.year);
    if (!y) {
      y = { year: m.year, harm: null, hotspots: null };
      map.set(m.year, y);
    }
    y.harm = add(y.harm, m.harm);
    y.hotspots = add(y.hotspots, m.hotspots);
  }
  return [...map.values()].sort((a, b) => a.year - b.year);
}

// ---------- hide-a-year ----------

export interface HideAYearRow {
  year: number;
  modis: number;
  viirs: number;
  predicted: number;
  errorPct: number;
  biasPct: number;
  level: 'low' | 'mid' | 'high';
}

export interface HideAYearResult {
  rows: HideAYearRow[];
  /** Region ratio learned from every year except the hidden one, per row. */
  learningYears: number;
  meanAbsErrorPct: number;
  meanBiasPct: number;
  byLevel: { level: 'low' | 'mid' | 'high'; label: string; meanAbsErrorPct: number; biasPct: number; n: number }[];
  /** Spearman rank correlation of MODIS vs VIIRS yearly totals (deseasonalised by year). */
  rankCorrelation: number | null;
  /** Ratio of each year's VIIRS to MODIS — the stability evidence. */
  yearlyRatios: { year: number; ratio: number }[];
  ratioCvPct: number | null;
  /** True when only the pilot months (Oct–Nov) carried both sensors. */
  pilotMonths: number[];
}

const LEVEL_LABEL: Record<'low' | 'mid' | 'high', string> = {
  low: 'Low-activity years',
  mid: 'Middle years',
  high: 'High-activity years',
};

/**
 * Leave-one-year-out test: learn the regional MODIS→VIIRS ratio from every
 * other year, predict the held-out year's VIIRS tile-days from its MODIS
 * tile-days, and report the error. Needs at least three usable years.
 *
 * This is computed from whatever record is loaded (the bundled window is
 * development mock data); the panel states that on screen.
 */
export function hideAYear(months: MonthAgg[], pilotMonths = [10, 11]): HideAYearResult | null {
  const totals = yearlyTotals(months).filter(
    (y): y is { year: number; harm: number | null; hotspots: number | null } =>
      y.harm !== null
  );
  const withSensors = totals
    .map((y) => {
      const rows = months.filter((m) => m.year === y.year);
      const pilot = rows.filter((m) => pilotMonths.includes(m.month));
      const usePilot = pilot.some((m) => m.modis !== null && m.viirs !== null);
      const use = usePilot ? pilot : rows;
      let modis: number | null = null;
      let viirs: number | null = null;
      for (const m of use) {
        modis = add(modis, m.modis);
        viirs = add(viirs, m.viirs);
      }
      return { year: y.year, modis, viirs, hours: use.length };
    })
    .filter(
      (y): y is { year: number; modis: number; viirs: number; hours: number } =>
        y.modis !== null && y.viirs !== null && y.modis > 0 && y.viirs > 0
    );

  if (withSensors.length < 3) return null;

  const totalM = withSensors.reduce((s, y) => s + y.modis, 0);
  const totalV = withSensors.reduce((s, y) => s + y.viirs, 0);
  const modisSorted = [...withSensors].sort((a, b) => a.modis - b.modis);
  const third = Math.max(1, Math.ceil(modisSorted.length / 3));
  const levelOf = new Map<number, 'low' | 'mid' | 'high'>();
  modisSorted.forEach((y, i) => {
    levelOf.set(y.year, i < third ? 'low' : i < 2 * third ? 'mid' : 'high');
  });

  const rows: HideAYearRow[] = withSensors.map((y) => {
    const otherM = totalM - y.modis;
    const otherV = totalV - y.viirs;
    const ratio = otherM > 0 ? otherV / otherM : 1;
    const predicted = y.modis * ratio;
    return {
      year: y.year,
      modis: y.modis,
      viirs: y.viirs,
      predicted,
      errorPct: ((predicted - y.viirs) / y.viirs) * 100,
      biasPct: ((predicted - y.viirs) / y.viirs) * 100,
      level: levelOf.get(y.year) ?? 'mid',
    };
  });

  const meanAbsErrorPct =
    rows.reduce((s, r) => s + Math.abs(r.errorPct), 0) / rows.length;
  const meanBiasPct = rows.reduce((s, r) => s + r.biasPct, 0) / rows.length;

  const byLevel = (['low', 'mid', 'high'] as const).map((level) => {
    const subset = rows.filter((r) => r.level === level);
    return {
      level,
      label: LEVEL_LABEL[level],
      meanAbsErrorPct: subset.length
        ? subset.reduce((s, r) => s + Math.abs(r.errorPct), 0) / subset.length
        : 0,
      biasPct: subset.length ? subset.reduce((s, r) => s + r.biasPct, 0) / subset.length : 0,
      n: subset.length,
    };
  });

  const yearlyRatios = withSensors.map((y) => ({ year: y.year, ratio: y.viirs / y.modis }));
  const meanRatio = yearlyRatios.reduce((s, r) => s + r.ratio, 0) / yearlyRatios.length;
  const sd = Math.sqrt(
    yearlyRatios.reduce((s, r) => s + (r.ratio - meanRatio) ** 2, 0) / yearlyRatios.length
  );
  const pilotUsed = withSensors.every((y) => y.hours <= pilotMonths.length) ? pilotMonths : [];

  return {
    rows,
    learningYears: rows.length - 1,
    meanAbsErrorPct,
    meanBiasPct,
    byLevel,
    rankCorrelation: spearman(
      withSensors.map((y) => y.modis),
      withSensors.map((y) => y.viirs)
    ),
    yearlyRatios,
    ratioCvPct: meanRatio > 0 ? (sd / meanRatio) * 100 : null,
    pilotMonths: pilotUsed,
  };
}

// ---------- ratio by year ----------

export interface RatioYearRow {
  year: number;
  modis: number;
  viirs: number;
  ratio: number;
  months: number;
  inLearningWindow: boolean;
}

export const LEARNING_WINDOW = { from: 2012, to: 2019 } as const;

/**
 * MODIS-to-VIIRS tile-day ratio per year (pilot months when present).
 * The learning window is marked so a reader can see whether the relationship
 * moved after the satellites drifted.
 */
export function ratioByYear(months: MonthAgg[], pilotMonths = [10, 11]): RatioYearRow[] {
  const years = [...new Set(months.map((m) => m.year))].sort((a, b) => a - b);
  const rows: RatioYearRow[] = [];
  for (const year of years) {
    const all = months.filter((m) => m.year === year);
    const pilot = all.filter((m) => pilotMonths.includes(m.month));
    const use = pilot.length && pilot.some((m) => m.modis !== null && m.viirs !== null) ? pilot : all;
    let modis: number | null = null;
    let viirs: number | null = null;
    for (const m of use) {
      modis = add(modis, m.modis);
      viirs = add(viirs, m.viirs);
    }
    if (modis === null || viirs === null || modis <= 0 || viirs <= 0) continue;
    rows.push({
      year,
      modis,
      viirs,
      ratio: viirs / modis,
      months: use.length,
      inLearningWindow: year >= LEARNING_WINDOW.from && year <= LEARNING_WINDOW.to,
    });
  }
  return rows;
}

// ---------- statistics helpers ----------

export function spearman(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ra = ranks(a.slice(0, n));
  const rb = ranks(b.slice(0, n));
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
  const out = new Array<number>(values.length).fill(0);
  let k = 0;
  while (k < order.length) {
    let j = k;
    while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
    const avg = (k + j) / 2 + 1;
    for (let t = k; t <= j; t++) out[order[t].i] = avg;
    k = j + 1;
  }
  return out;
}

// ---------- trust score ----------

export interface TrustScore {
  score: number;
  eraFactor: number;
  bandWidthPct: number;
  label: TrustLabel;
  note: string;
}

/**
 * 0–100 trust score from the contract: 100 × (1 − widened band width / value)
 * × support/era factor, floored at 0. Null when there is no activity to score.
 */
export function trustScore(
  value: number | null,
  lo: number | null,
  hi: number | null,
  label: TrustLabel | string | null
): TrustScore | null {
  if (value === null || !(value > 0)) return null;
  if (lo === null || hi === null || hi < lo) return null;
  const bandWidthPct = ((hi - lo) / value) * 100;
  const eraFactor =
    label === 'Measured' ? 1 : label === 'Estimated' ? 0.8 : label === 'Indicative' ? 0.6 : 0.9;
  const score = Math.max(0, Math.min(100, 100 * (1 - (hi - lo) / value) * eraFactor));
  return {
    score: Math.round(score),
    eraFactor,
    bandWidthPct,
    label: (label as TrustLabel) ?? 'Estimated',
    note:
      '100 × (1 − band width ÷ value) × era factor, floored at 0. Era factors: Measured 1.0, Estimated 0.8, Indicative 0.6; Provisional 0.9 while validation is open.',
  };
}

// ---------- this month vs the same days in past years ----------

export type Band = 'much below' | 'below' | 'near' | 'above' | 'much above';

export interface ThisMonthWindow {
  month: string;
  days: number;
  value: number;
  priorYears: { year: number; value: number }[];
  median: number | null;
  p25: number | null;
  p75: number | null;
  pctDiff: number | null;
  rank: number | null;
  band: Band | null;
  lastDay: string;
}

const BAND_OF_RANK = (rank: number): Band =>
  rank < 10 ? 'much below' : rank < 30 ? 'below' : rank < 70 ? 'near' : rank < 90 ? 'above' : 'much above';

/** Fair partial-month comparison: month-to-date against the same days in past years. */
export function thisMonthWindow(rows: RegionDailyRow[]): ThisMonthWindow | null {
  const harm = rows.filter((r) => r.harm !== null && r.date);
  if (harm.length === 0) return null;
  const latest = harm.reduce((a, b) => (a.date > b.date ? a : b));
  const month = latest.date.slice(0, 7);
  const dayOfMonth = Number(latest.date.slice(8, 10));

  const current = harm.filter(
    (r) => r.date.slice(0, 7) === month && Number(r.date.slice(8, 10)) <= dayOfMonth
  );
  if (current.length === 0) return null;
  const value = current.reduce((s, r) => s + (r.harm ?? 0), 0);
  const days = new Set(current.map((r) => r.date)).size;

  const years = [...new Set(harm.map((r) => Number(r.date.slice(0, 4))))].filter(
    (y) => y < Number(month.slice(0, 4))
  );
  const priorYears: { year: number; value: number }[] = [];
  for (const year of years) {
    const mm = month.slice(5, 7);
    const rowsY = harm.filter(
      (r) =>
        r.date.slice(0, 4) === String(year) &&
        r.date.slice(5, 7) === mm &&
        Number(r.date.slice(8, 10)) <= dayOfMonth
    );
    if (rowsY.length === 0) continue;
    priorYears.push({ year, value: rowsY.reduce((s, r) => s + (r.harm ?? 0), 0) });
  }

  const values = priorYears.map((p) => p.value).sort((a, b) => a - b);
  const median = values.length
    ? values.length % 2 === 1
      ? values[(values.length - 1) / 2]
      : (values[values.length / 2 - 1] + values[values.length / 2]) / 2
    : null;
  const quantile = (q: number): number | null => {
    if (values.length === 0) return null;
    const pos = (values.length - 1) * q;
    const loIdx = Math.floor(pos);
    const hiIdx = Math.ceil(pos);
    return values[loIdx] + (values[hiIdx] - values[loIdx]) * (pos - loIdx);
  };
  const below = values.filter((v) => v < value).length;
  const rank = values.length ? (below / values.length) * 100 : null;

  return {
    month,
    days,
    value,
    priorYears,
    median,
    p25: quantile(0.25),
    p75: quantile(0.75),
    pctDiff: median && median > 0 ? ((value - median) / median) * 100 : null,
    rank,
    band: rank === null ? null : BAND_OF_RANK(rank),
    lastDay: latest.date,
  };
}

// ---------- seam step observed inside the loaded window ----------

export interface ObservedStep {
  beforeMean: number;
  afterMean: number;
  beforeDays: number;
  afterDays: number;
  pct: number;
}

/**
 * Mean daily harmonized value on either side of a date boundary, for the
 * observed step where a sensor handover falls inside the loaded window.
 * This is a description of the loaded record, not a validated seam shift.
 */
export function observedStep(
  rows: RegionDailyRow[],
  boundary: string,
  windowDays = 14
): ObservedStep | null {
  const cut = Date.parse(`${boundary}T00:00:00Z`);
  if (!Number.isFinite(cut)) return null;
  const day = 86400000;
  const window = windowDays * day;
  const before = rows.filter(
    (r) => r.harm !== null && Date.parse(r.date) < cut && Date.parse(r.date) >= cut - window
  );
  const after = rows.filter(
    (r) => r.harm !== null && Date.parse(r.date) >= cut && Date.parse(r.date) < cut + window
  );
  if (before.length < 3 || after.length < 3) return null;
  const beforeMean = before.reduce((s, r) => s + (r.harm ?? 0), 0) / before.length;
  const afterMean = after.reduce((s, r) => s + (r.harm ?? 0), 0) / after.length;
  if (beforeMean <= 0) return null;
  return {
    beforeMean,
    afterMean,
    beforeDays: before.length,
    afterDays: after.length,
    pct: ((afterMean - beforeMean) / beforeMean) * 100,
  };
}

// ---------- misc formatting ----------

export function fmt(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function monthName(month: number): string {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month - 1] ?? '';
}

export function monthShort(month: number): string {
  return monthName(month).slice(0, 3);
}

export function labelOfYm(ym: number): string {
  return ymToLabel(ym);
}
