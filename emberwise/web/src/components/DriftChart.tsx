import { useMemo } from 'react';
import type { JsonFile } from '../types';
import { ACCENT, ACCENT_2, INK_DIM, LINE } from '../theme';
import { fmt } from '../lib/derive';

interface DriftPoint {
  satellite: string;
  year: number;
  hour: number;
  lo: number | null;
  hi: number | null;
  n: number;
}

interface DriftParsed {
  points: DriftPoint[];
  perSatellite: boolean;
  hasIqr: boolean;
}

const SAT_COLORS = [ACCENT_2, ACCENT, '#7fb2ea', '#c9a3ff', '#f4a582'];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asNumbers(v: unknown): [number, number] | null {
  if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
    return [v[0], v[1]];
  }
  if (typeof v === 'number' && Number.isFinite(v)) return [v, v];
  return null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** Median local acquisition hour per satellite per year, with IQR where supplied. */
function parseDrift(data: JsonFile | null): DriftParsed {
  const raw = data?.rows;
  if (!Array.isArray(raw)) return { points: [], perSatellite: false, hasIqr: false };

  const perSat = raw.some((r) => isObj(r) && typeof r.satellite === 'string');
  if (!perSat) {
    // Monthly single-series fallback: one satellite set, one row per month.
    const byYear = new Map<number, number[]>();
    for (const r of raw) {
      if (!isObj(r)) continue;
      const hour = typeof r.median_local_hour === 'number' ? r.median_local_hour : null;
      const ym = typeof r.ym === 'number' ? r.ym : null;
      if (hour === null || ym === null) continue;
      const year = Math.floor(ym / 12);
      const arr = byYear.get(year) ?? [];
      arr.push(hour);
      byYear.set(year, arr);
    }
    return {
      perSatellite: false,
      hasIqr: false,
      points: [...byYear.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([year, hours]) => ({
          satellite: 'Observed record',
          year,
          hour: median(hours),
          lo: Math.min(...hours),
          hi: Math.max(...hours),
          n: hours.length,
        })),
    };
  }

  const groups = new Map<string, { hours: number[]; los: number[]; his: number[] }>();
  let hasIqr = false;
  for (const r of raw) {
    if (!isObj(r)) continue;
    const satellite = typeof r.satellite === 'string' ? r.satellite : null;
    const hour = typeof r.median_local_hour === 'number' ? r.median_local_hour : null;
    const year =
      typeof r.year === 'number'
        ? r.year
        : typeof r.ym === 'number'
          ? Math.floor(r.ym / 12)
          : null;
    if (!satellite || hour === null || year === null) continue;
    const key = `${satellite}|${year}`;
    let g = groups.get(key);
    if (!g) {
      g = { hours: [], los: [], his: [] };
      groups.set(key, g);
    }
    g.hours.push(hour);
    const iqr = asNumbers(r.iqr) ?? asNumbers(r.range);
    if (iqr) {
      hasIqr = true;
      g.los.push(iqr[0]);
      g.his.push(iqr[1]);
    }
  }

  const points: DriftPoint[] = [...groups.entries()]
    .map(([key, g]) => {
      const [satellite, yearStr] = key.split('|');
      return {
        satellite,
        year: Number(yearStr),
        hour: median(g.hours),
        lo: g.los.length ? Math.min(...g.los) : Math.min(...g.hours),
        hi: g.his.length ? Math.max(...g.his) : Math.max(...g.hours),
        n: g.hours.length,
      };
    })
    .sort((a, b) => a.year - b.year || a.satellite.localeCompare(b.satellite));

  return { points, perSatellite: true, hasIqr };
}

/**
 * Sampling-time drift: median local acquisition hour per satellite per year,
 * with the interquartile range where the file provides it. It is a diagnostic
 * of observation geometry — never a correction.
 */
export function DriftDiagnostic({ data }: { data: JsonFile | null }) {
  const parsed = useMemo(() => parseDrift(data), [data]);
  const satellites = useMemo(
    () => [...new Set(parsed.points.map((p) => p.satellite))],
    [parsed.points]
  );

  if (parsed.points.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-ink-dim">
        No drift rows loaded. Required: drift.rows[] with {`{satellite, year, median_local_hour, iqr}`}.
      </p>
    );
  }

  const W = 560;
  const H = 200;
  const M = { top: 16, right: 14, bottom: 26, left: 38 };
  const years = parsed.points.map((p) => p.year);
  const hours = parsed.points.flatMap((p) => [p.lo ?? p.hour, p.hi ?? p.hour, p.hour]);
  const xMin = Math.min(...years) - 0.5;
  const xMax = Math.max(...years) + 0.5;
  const yMin = Math.floor(Math.min(...hours) - 0.5);
  const yMax = Math.ceil(Math.max(...hours) + 0.5);
  const x = (year: number) => M.left + ((year - xMin) / (xMax - xMin || 1)) * (W - M.left - M.right);
  const y = (v: number) => H - M.bottom - ((v - yMin) / (yMax - yMin || 1)) * (H - M.top - M.bottom);

  const tickYears = [...new Set(years)].filter((yr) => yr % 2 === 0 || years.length < 8);

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Median local acquisition hour per satellite per year"
      >
        {Array.from({ length: yMax - yMin + 1 }, (_, i) => yMin + i).map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(t)}
              y2={y(t)}
              stroke={LINE}
              strokeWidth={0.6}
              strokeDasharray="2 4"
              opacity={0.45}
            />
            <text x={M.left - 6} y={y(t) + 3} fontSize={8.5} fill={INK_DIM} textAnchor="end">
              {String(t).padStart(2, '0')}h
            </text>
          </g>
        ))}
        {tickYears.map((yr) => (
          <text key={yr} x={x(yr)} y={H - 8} fontSize={8.5} fill={INK_DIM} textAnchor="middle">
            {yr}
          </text>
        ))}
        {satellites.map((sat, si) => {
          const pts = parsed.points.filter((p) => p.satellite === sat).sort((a, b) => a.year - b.year);
          if (pts.length === 0) return null;
          const color = SAT_COLORS[si % SAT_COLORS.length];
          const line = pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.year).toFixed(1)},${y(p.hour).toFixed(1)}`)
            .join(' ');
          const band = parsed.hasIqr
            ? `${pts
                .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.year).toFixed(1)},${y(p.hi ?? p.hour).toFixed(1)}`)
                .join(' ')} ${pts
                .slice()
                .reverse()
                .map((p) => `L${x(p.year).toFixed(1)},${y(p.lo ?? p.hour).toFixed(1)}`)
                .join(' ')} Z`
            : '';
          return (
            <g key={sat}>
              {band && <path d={band} fill={color} opacity={0.12} />}
              <path d={line} fill="none" stroke={color} strokeWidth={1.9} strokeLinejoin="round" />
              {pts.map((p) => (
                <circle key={`${sat}-${p.year}`} cx={x(p.year)} cy={y(p.hour)} r={2.8} fill={color}>
                  <title>{`${sat} ${p.year}: median ${fmt(p.hour, 2)}h local solar${
                    p.lo !== null && p.hi !== null ? ` (range ${fmt(p.lo, 2)}–${fmt(p.hi, 2)}h)` : ''
                  }`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        <text x={M.left} y={M.top - 5} fontSize={8.5} fill={INK_DIM}>
          median local acquisition hour
        </text>
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-dim">
        {satellites.map((sat, i) => (
          <span key={sat} className="inline-flex items-center gap-1.5">
            <span
              className="h-[2px] w-4 rounded"
              style={{ background: SAT_COLORS[i % SAT_COLORS.length] }}
            />
            {sat}
          </span>
        ))}
        <span className="ml-auto font-mono">
          {parsed.hasIqr ? 'band = interquartile range' : 'band = spread of monthly medians'}
        </span>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-dim">
        {parsed.perSatellite
          ? 'A moving median local hour is orbit drift, not a change in when fires burn. Read it beside the Fire Clock Dial.'
          : 'Only a regional monthly median is loaded, so satellite-specific lines cannot be drawn. Per-satellite values appear here when drift rows carry a satellite field — they are never estimated.'}{' '}
        {parsed.hasIqr
          ? 'The band is the supplied interquartile range.'
          : 'The band spans the monthly medians inside each year.'}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">
        Diagnostic only — nothing in the headline index is clock-corrected or drift-corrected.
      </p>
    </>
  );
}
