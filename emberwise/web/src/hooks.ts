import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadClimatology,
  loadRegions,
  loadRegionDaily,
  loadTileMonth,
  tileMonthYears,
} from './data';
import type { ClimatologyRow, TileMonthFile } from './types';
import { aggregateTileMonths, thisMonthWindow, type MonthAgg, type ThisMonthWindow } from './lib/derive';

interface LoadState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Small hook around the cached loaders in data.ts. `retry` re-runs the loader
// (the data-layer cache evicts failures automatically).
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = []): LoadState<T> {
  const [state, setState] = useState<Omit<LoadState<T>, 'retry'>>({
    data: null,
    loading: true,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e: unknown) =>
        alive &&
        setState({
          data: null,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        })
      );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry };
}

// ---------- useAllTileMonths ----------

/**
 * Every tile_month year, loaded once and cached by the data layer.
 * Used by the Transparency Lab diagnostics, which need the whole window.
 */
export function useAllTileMonths(): LoadState<TileMonthFile[]> {
  return useData(
    () => Promise.all(tileMonthYears().map((y) => loadTileMonth(y))),
    []
  );
}

// ---------- useRegionMonthly ----------

export interface RegionMonthly {
  months: MonthAgg[];
  years: number[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  regionLabel: string | null;
  /** True while any underlying file came from the bundled development mocks. */
  sourceNote: string;
}

/**
 * Monthly harmonized/hotspot aggregates for one region, summed over the H3
 * tiles listed for that region. Region scope comes from regions.json so the
 * calendar and the map agree on which tiles count.
 */
export function useRegionMonthly(regionId: string): RegionMonthly {
  const filesQ = useAllTileMonths();
  const regionsQ = useData(loadRegions, []);

  return useMemo(() => {
    const region = regionsQ.data?.regions.find((r) => r.id === regionId) ?? null;
    let scope: Set<number> | null = null;
    if (region) {
      // tile_month rows are res-6 tiles; prefer that scope, then fall back.
      const res6 = region.tiles_in_scope?.['6'];
      const s = new Set<number>(res6 ?? []);
      if (s.size === 0) {
        for (const list of Object.values(region.tiles_in_scope ?? {})) for (const i of list) s.add(i);
      }
      if (s.size > 0) scope = s;
    }
    const months = filesQ.data ? aggregateTileMonths(filesQ.data, scope) : [];
    return {
      months,
      years: [...new Set(months.map((m) => m.year))].sort((a, b) => a - b),
      loading: filesQ.loading || regionsQ.loading,
      error: filesQ.error || regionsQ.error,
      retry: () => {
        filesQ.retry();
        regionsQ.retry();
      },
      regionLabel: region?.label ?? null,
      sourceNote: 'Computed in the browser from the loaded tile-month files.',
    };
  }, [filesQ, regionsQ, regionId]);
}

// ---------- useThisMonth ----------

export interface ThisMonth {
  /** 'YYYY-MM' of the latest month with data for the region. */
  month: string | null;
  /** Month-to-date sum of daily harmonized tile-days (partial month aware:
   *  only days up to today / the last day present are counted). */
  value: number | null;
  /** Human label, e.g. "2026-11 month-to-date (13 days)". */
  label: string | null;
  /** Percentile rank of `value` interpolated against the month's
   *  climatology p10–p90 for sensor 'harm'. null when no baseline. */
  percentile: number | null;
  clim: ClimatologyRow | null;
  /** Fair same-days comparison against past years. */
  window: ThisMonthWindow | null;
  loading: boolean;
  error: string | null;
}

function interpPercentile(v: number, clim: ClimatologyRow): number | null {
  const pts: [number, number][] = (
    [
      [clim.p10, 10],
      [clim.p25, 25],
      [clim.p50, 50],
      [clim.p75, 75],
      [clim.p90, 90],
    ] as ([number | null, number])[]
  )
    .filter((p): p is [number, number] => p[0] !== null)
    .sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return null;
  if (v <= pts[0][0]) return Math.max(0, pts[0][1] * (v / (pts[0][0] || 1)));
  const last = pts[pts.length - 1];
  if (v >= last[0]) {
    return Math.min(100, last[1] + (100 - last[1]) * Math.min(1, (v - last[0]) / (last[0] || 1)));
  }
  for (let i = 1; i < pts.length; i++) {
    if (v <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const f = x1 === x0 ? 0 : (v - x0) / (x1 - x0);
      return y0 + f * (y1 - y0);
    }
  }
  return null;
}

/**
 * Current (partial-month-aware) burning value for a region, its label and
 * percentile rank vs climatology. Teammates build the "this month" card on
 * top of this hook — keep the return shape stable.
 */
export function useThisMonth(regionId: string | undefined): ThisMonth {
  const dailyQ = useData(loadRegionDaily, []);
  const climQ = useData(loadClimatology, []);

  return useMemo(() => {
    const base: ThisMonth = {
      month: null, value: null, label: null, percentile: null,
      clim: null, window: null, loading: dailyQ.loading || climQ.loading,
      error: dailyQ.error || climQ.error,
    };
    if (!regionId || !dailyQ.data) return base;

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    // latest month present for this region
    const rows = dailyQ.data.rows.filter((r) => r.region === regionId && r.date <= todayStr);
    if (rows.length === 0) return base;
    let latest = '';
    for (const r of rows) if (r.date > latest) latest = r.date;
    const month = latest.slice(0, 7);

    // month-to-date: days in `month` up to today (or last available day)
    const monthRows = rows.filter((r) => r.date.startsWith(month) && r.harm !== null);
    if (monthRows.length === 0) return { ...base, month };
    const value = monthRows.reduce((s, r) => s + (r.harm ?? 0), 0);
    const days = new Set(monthRows.map((r) => r.date)).size;

    const clim = climQ.data?.rows.find(
      (c) =>
        c.region === regionId &&
        c.sensor === 'harm' &&
        c.period_kind === 'month' &&
        c.period === Number(month.slice(5, 7))
    ) ?? null;
    const percentile = clim ? interpPercentile(value, clim) : null;

    const window = thisMonthWindow(rows);

    return {
      month,
      value: Math.round(value * 10) / 10,
      label: `${month} month-to-date (${days} day${days === 1 ? '' : 's'})`,
      percentile: percentile === null ? null : Math.round(percentile * 10) / 10,
      clim,
      window,
      loading: false,
      error: null,
    };
  }, [regionId, dailyQ, climQ]);
}
