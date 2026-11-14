import { useMemo, useState, type ReactNode } from 'react';
import {
  loadClimatology,
  loadConversion,
  loadCoverage,
  loadDrift,
  loadHourly,
  loadPeriods,
  loadRegionDaily,
  loadRelaySim,
  loadValidation,
} from '../data';
import { useData } from '../hooks';
import type { ClimatologyRow, Period, RegionDailyRow } from '../types';
import { LabelChip } from '../components/LabelChip';
import { FireClockDialSlot } from '../components/FireClockDial';
import { Meter, RawJson } from '../components/primitives';
import { SeriesChartSlot } from '../components/SeriesChart';
import { ACCENT, ACCENT_2, GAP_COLOR, INK, INK_DIM, LINE } from '../theme';

type LabState = { loading: boolean; error: string | null; retry: () => void };

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LETTER = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function fmt(v: number | null, digits = 1): string {
  return v === null ? '—' : v.toFixed(digits);
}

function scale(v: number, d0: number, d1: number, r0: number, r1: number): number {
  return r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
}

function monthLabel(id: string): string {
  return id.replace(/_/g, ' ');
}

// Each card is a drop-in slot: teammate components can replace the body while
// the Workspace/Proof grid stays stable.
function LabCard({
  title,
  chip,
  subtitle,
  state,
  raw,
  className = '',
  children,
}: {
  title: string;
  chip: string;
  subtitle?: string;
  state: LabState;
  raw: unknown;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card flex min-w-0 flex-col p-4 ${className}`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="card-title">{title}</h2>
          {subtitle && (
            <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{subtitle}</p>
          )}
        </div>
        <LabelChip label={chip} />
      </header>
      {state.loading && <p className="py-8 text-center text-xs text-ink-dim">Loading…</p>}
      {state.error && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-red-300">
          <span>{state.error}</span>
          <button onClick={state.retry} className="btn btn-ghost btn-sm">
            Retry
          </button>
        </p>
      )}
      {!state.loading && !state.error && <div className="flex flex-1 flex-col">{children}</div>}
      {!state.loading && !state.error && <RawJson data={raw} />}
    </section>
  );
}

function Metric({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface/40 px-3 py-2.5">
      <p className="section-label">{label}</p>
      <p className="mt-1.5 font-mono text-[17px] font-semibold leading-none text-ink">
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-ink-dim">{unit}</span>}
      </p>
      {hint && <p className="mt-1.5 text-[10px] leading-snug text-ink-dim">{hint}</p>}
    </div>
  );
}

export function ValidationSlot() {
  const q = useData(loadValidation, []);
  const metrics = (q.data?.metrics ?? {}) as Record<string, unknown>;
  const mae = num(metrics.mae_tile_days);
  const within = num(metrics.within_band_pct);
  const weeks = num(metrics.n_weeks);

  return (
    <LabCard
      title="Validation"
      chip="Provisional"
      subtitle="Harmonized tile-days checked against held-out VIIRS weeks."
      state={q}
      raw={q.data}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="MAE" value={fmt(mae)} unit="tile-days" hint="Mean absolute error" />
        <Metric
          label="Within band"
          value={within === null ? '—' : `${Math.round(within)}%`}
          hint="Held-out weeks inside lo–hi"
        />
        <Metric
          label="Weeks"
          value={weeks === null ? '—' : weeks.toLocaleString()}
          hint="Evaluation window"
        />
      </div>
      {within !== null && (
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between text-[10.5px] text-ink-dim">
            <span>Share of weeks inside the lo–hi band</span>
            <span className="font-mono text-ink">{Math.round(within)} / 100</span>
          </div>
          <Meter value={within} />
        </div>
      )}
      <p className="mt-auto pt-3 text-[11px] leading-relaxed text-ink-dim">
        Errors are expressed in tile-days, never as fire counts. Validation stays Provisional
        until the relay era has a full overlap window.
      </p>
    </LabCard>
  );
}

export function RelaySimSlot() {
  const q = useData(loadRelaySim, []);
  const points = useMemo(() => {
    const raw = (q.data?.points as { hour_utc?: unknown; rel_visits?: unknown }[] | undefined) ?? [];
    return raw
      .map((p) => ({ hour: Number(p.hour_utc), visits: Number(p.rel_visits) }))
      .filter((p) => Number.isFinite(p.hour) && Number.isFinite(p.visits))
      .sort((a, b) => a.hour - b.hour);
  }, [q.data]);
  const max = Math.max(1, ...points.map((p) => p.visits));
  const peakHours = points.filter((p) => p.visits === max).map((p) => p.hour);

  return (
    <LabCard
      title="Relay satellite simulation"
      chip="Estimated"
      subtitle="Modelled overpass opportunities for the relay sensor, by UTC hour."
      state={q}
      raw={q.data}
    >
      {points.length === 0 ? (
        <p className="py-8 text-center text-xs text-ink-dim">No relay points loaded.</p>
      ) : (
        <>
          <div className="flex h-40 items-end gap-[3px] rounded-xl border border-line/70 bg-surface/40 px-2 pb-1 pt-2">
            {points.map((p) => {
              const frac = p.visits / max;
              return (
                <div
                  key={p.hour}
                  title={`${String(p.hour).padStart(2, '0')}:00 UTC — ${p.visits} visits`}
                  className="flex-1 rounded-t-[3px]"
                  style={{
                    height: `${Math.max(4, frac * 100)}%`,
                    background: `linear-gradient(180deg, ${ACCENT_2}, rgba(94,224,208,.25))`,
                    opacity: 0.4 + 0.6 * frac,
                  }}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9px] text-ink-dim">
            <span>00 UTC</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-ink-dim">
            Peak of {max} visits at{' '}
            <span className="font-mono text-ink">
              {peakHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')}
            </span>{' '}
            UTC. More visits shrink the window between passes — they do not add detections.
          </p>
        </>
      )}
    </LabCard>
  );
}

function ConversionChart({ rows }: { rows: { month: number; factor: number }[] }) {
  const data = useMemo(() => [...rows].sort((a, b) => a.month - b.month), [rows]);
  if (data.length === 0) {
    return <p className="py-8 text-center text-xs text-ink-dim">No conversion rows loaded.</p>;
  }
  const W = 560;
  const H = 190;
  const M = { top: 14, right: 12, bottom: 24, left: 34 };
  const factors = data.map((d) => d.factor);
  const lo = Math.floor((Math.min(1, ...factors) - 0.04) * 10) / 10;
  const hi = Math.ceil((Math.max(1, ...factors) + 0.04) * 10) / 10;
  const x = (month: number) => scale(month, 1, 12, M.left, W - M.right);
  const y = (v: number) => scale(v, lo, hi, H - M.bottom, M.top);
  const yTicks: number[] = [];
  for (let v = lo; v <= hi + 0.001; v += 0.1) yTicks.push(Math.round(v * 10) / 10);
  const path = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(d.month).toFixed(1)},${y(d.factor).toFixed(1)}`)
    .join(' ');
  const area = `${path} L${x(12).toFixed(1)},${y(lo).toFixed(1)} L${x(1).toFixed(1)},${y(lo).toFixed(1)} Z`;
  const peak = data.reduce((a, b) => (b.factor > a.factor ? b : a), data[0]);

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="MODIS to VIIRS conversion factor by month"
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(t)}
              y2={y(t)}
              stroke={LINE}
              strokeWidth={0.6}
              strokeDasharray={t === 1 ? undefined : '2 4'}
              opacity={t === 1 ? 0.75 : 0.45}
            />
            <text x={M.left - 7} y={y(t) + 3} fontSize={9} fill={INK_DIM} textAnchor="end">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        <line
          x1={M.left}
          x2={W - M.right}
          y1={y(1)}
          y2={y(1)}
          stroke={ACCENT_2}
          strokeWidth={1}
          strokeDasharray="4 4"
          opacity={0.6}
        />
        <text x={W - M.right} y={y(1) - 4} fontSize={9} fill={ACCENT_2} textAnchor="end">
          1.0 parity
        </text>
        <path d={area} fill={ACCENT} opacity={0.09} />
        <path d={path} fill="none" stroke={ACCENT} strokeWidth={1.9} strokeLinejoin="round" />
        {data.map((d) => (
          <circle key={d.month} cx={x(d.month)} cy={y(d.factor)} r={2.4} fill={ACCENT} />
        ))}
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <text key={m} x={x(m)} y={H - 8} fontSize={9} fill={INK_DIM} textAnchor="middle">
            {MONTH_LETTER[m - 1]}
          </text>
        ))}
      </svg>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">
        Peak factor <span className="font-mono text-ink">{peak.factor.toFixed(2)}×</span> in{' '}
        {MONTH_SHORT[peak.month - 1]}. Factors above parity mean the harmonized scale reads higher
        than raw MODIS.
      </p>
    </>
  );
}

export function ConversionSlot() {
  const q = useData(loadConversion, []);
  const rows = useMemo(() => {
    const raw = (q.data?.rows as { month?: unknown; factor?: unknown }[] | undefined) ?? [];
    return raw
      .map((r) => ({ month: Number(r.month), factor: Number(r.factor) }))
      .filter((r) => Number.isFinite(r.month) && Number.isFinite(r.factor));
  }, [q.data]);

  return (
    <LabCard
      title="MODIS→VIIRS conversion"
      chip="Estimated"
      subtitle="Monthly harmonization factor that puts MODIS on the VIIRS reference scale."
      state={q}
      raw={q.data}
    >
      <ConversionChart rows={rows} />
    </LabCard>
  );
}

function DriftChart({ rows }: { rows: { ym: number; hour: number }[] }) {
  if (rows.length < 2) {
    return <p className="py-8 text-center text-xs text-ink-dim">No drift rows loaded.</p>;
  }
  const W = 560;
  const H = 190;
  const M = { top: 14, right: 12, bottom: 24, left: 34 };
  const values = rows.map((r) => r.hour);
  const lo = Math.floor(Math.min(...values));
  const hi = Math.ceil(Math.max(...values));
  const x = (i: number) => scale(i, 0, rows.length - 1, M.left, W - M.right);
  const y = (v: number) => scale(v, lo, hi, H - M.bottom, M.top);
  const path = rows
    .map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(r.hour).toFixed(1)}`)
    .join(' ');
  const area = `${path} L${x(rows.length - 1).toFixed(1)},${y(lo).toFixed(1)} L${x(0).toFixed(
    1
  )},${y(lo).toFixed(1)} Z`;
  const yearMarks = rows
    .map((r, i) => ({ i, year: Math.floor(r.ym / 12), month: r.ym % 12 }))
    .filter((r) => r.month === 0);
  const first = values[0];
  const last = values[values.length - 1];

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Median local observing hour by month"
      >
        {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((t) => (
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
            <text x={M.left - 7} y={y(t) + 3} fontSize={9} fill={INK_DIM} textAnchor="end">
              {t}h
            </text>
          </g>
        ))}
        {yearMarks.map((m) => (
          <g key={m.year}>
            <line
              x1={x(m.i)}
              x2={x(m.i)}
              y1={M.top}
              y2={H - M.bottom}
              stroke={LINE}
              strokeWidth={0.5}
              opacity={0.4}
            />
            <text x={x(m.i)} y={H - 8} fontSize={9} fill={INK_DIM} textAnchor="middle">
              {m.year}
            </text>
          </g>
        ))}
        <path d={area} fill={ACCENT} opacity={0.08} />
        <path d={path} fill="none" stroke={ACCENT} strokeWidth={1.9} strokeLinejoin="round" />
        <circle cx={x(0)} cy={y(first)} r={2.6} fill={ACCENT} />
        <text x={x(0) + 5} y={y(first) + 10} fontSize={9} fill={INK}>
          {first.toFixed(1)}h
        </text>
        <circle cx={x(rows.length - 1)} cy={y(last)} r={2.6} fill={ACCENT} />
        <text x={x(rows.length - 1) - 5} y={y(last) + 10} fontSize={9} fill={INK} textAnchor="end">
          {last.toFixed(1)}h
        </text>
      </svg>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">
        Median local solar hour drifts seasonally between{' '}
        <span className="font-mono text-ink">{Math.min(...values).toFixed(1)}h</span> and{' '}
        <span className="font-mono text-ink">{Math.max(...values).toFixed(1)}h</span> — read the
        Fire Clock Dial with that shift in mind.
      </p>
    </>
  );
}

export function DriftSlot() {
  const q = useData(loadDrift, []);
  const rows = useMemo(() => {
    const raw = (q.data?.rows as { ym?: unknown; median_local_hour?: unknown }[] | undefined) ?? [];
    return raw
      .map((r) => ({ ym: Number(r.ym), hour: Number(r.median_local_hour) }))
      .filter((r) => Number.isFinite(r.ym) && Number.isFinite(r.hour))
      .sort((a, b) => a.ym - b.ym);
  }, [q.data]);

  return (
    <LabCard
      title="Observing-time drift"
      chip="Indicative"
      subtitle="Median local observing hour per month — the geometry behind the Fire Clock Dial."
      state={q}
      raw={q.data}
    >
      <DriftChart rows={rows} />
    </LabCard>
  );
}

export function HourlySlot() {
  const q = useData(loadHourly, []);
  if (q.loading) {
    return (
      <p className="card py-10 text-center text-xs text-ink-dim">Loading hourly distribution…</p>
    );
  }
  if (q.error) {
    return (
      <section className="card p-4">
        <p className="flex flex-wrap items-center gap-2 text-xs text-red-300">
          <span>{q.error}</span>
          <button onClick={q.retry} className="btn btn-ghost btn-sm">
            Retry
          </button>
        </p>
      </section>
    );
  }
  return (
    <div className="flex flex-col">
      <FireClockDialSlot hourly={q.data} />
      <RawJson data={q.data} />
    </div>
  );
}

function ClimatologyBands({ months }: { months: Map<number, ClimatologyRow> }) {
  const rows = Array.from(months.values());
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-ink-dim">
        No climatology rows for this selection.
      </p>
    );
  }
  const W = 720;
  const H = 190;
  const M = { top: 12, right: 8, bottom: 22, left: 34 };
  const max = Math.max(1, ...rows.map((r) => r.p90 ?? r.p50 ?? 0)) * 1.08;
  const bw = (W - M.left - M.right) / 12;
  const x = (m: number) => M.left + (m - 0.5) * bw;
  const y = (v: number) => scale(v, 0, max, H - M.bottom, M.top);
  const ticks = [0, max / 2, max];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Monthly climatology percentile bands"
    >
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={M.left}
            x2={W - M.right}
            y1={y(t)}
            y2={y(t)}
            stroke={LINE}
            strokeWidth={0.6}
            strokeDasharray={i === 0 ? undefined : '2 4'}
            opacity={0.5}
          />
          <text x={M.left - 7} y={y(t) + 3} fontSize={9} fill={INK_DIM} textAnchor="end">
            {Math.round(t)}
          </text>
        </g>
      ))}
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
        const r = months.get(m);
        if (!r) return null;
        const w = bw * 0.56;
        const p10 = r.p10 ?? r.p50;
        const p90 = r.p90 ?? r.p50;
        const p25 = r.p25 ?? p10;
        const p75 = r.p75 ?? p90;
        return (
          <g key={m}>
            {p10 !== null && p90 !== null && (
              <rect
                x={x(m) - w / 2}
                y={y(p90)}
                width={w}
                height={Math.max(1, y(p10) - y(p90))}
                rx={3}
                fill={ACCENT_2}
                opacity={0.2}
              />
            )}
            {p25 !== null && p75 !== null && (
              <rect
                x={x(m) - w / 2}
                y={y(p75)}
                width={w}
                height={Math.max(1, y(p25) - y(p75))}
                rx={3}
                fill={ACCENT_2}
                opacity={0.45}
              />
            )}
            {r.p50 !== null && (
              <line
                x1={x(m) - w / 2}
                x2={x(m) + w / 2}
                y1={y(r.p50)}
                y2={y(r.p50)}
                stroke={ACCENT}
                strokeWidth={1.7}
              />
            )}
            <text x={x(m)} y={H - 8} fontSize={9} fill={INK_DIM} textAnchor="middle">
              {MONTH_LETTER[m - 1]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ClimatologyLabSlot() {
  const q = useData(loadClimatology, []);
  const rows = q.data?.rows ?? [];
  const [regionPick, setRegionPick] = useState('indian_punjab');
  const [sensorPick, setSensorPick] = useState('harm');

  const regions = useMemo(() => Array.from(new Set(rows.map((r) => r.region))).sort(), [rows]);
  const region = regions.includes(regionPick) ? regionPick : (regions[0] ?? regionPick);
  const sensors = useMemo(
    () =>
      Array.from(new Set(rows.filter((r) => r.region === region).map((r) => r.sensor))).sort(
        (a, b) => (a === 'harm' ? -1 : b === 'harm' ? 1 : a.localeCompare(b))
      ),
    [rows, region]
  );
  const sensor = sensors.includes(sensorPick) ? sensorPick : (sensors[0] ?? sensorPick);
  const months = useMemo(() => {
    const out = new Map<number, ClimatologyRow>();
    for (const r of rows) {
      if (r.region === region && r.sensor === sensor && r.period_kind === 'month') {
        out.set(r.period, r);
      }
    }
    return out;
  }, [rows, region, sensor]);

  return (
    <LabCard
      title="Climatology"
      chip="Measured"
      subtitle="Monthly p10–p90 envelope from the baseline period. The ember line is the median."
      state={q}
      raw={q.data}
      className="lg:col-span-2"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="seg" role="group" aria-label="Climatology region">
          {regions.map((r) => (
            <button
              key={r}
              className="seg-item capitalize"
              aria-pressed={r === region}
              onClick={() => setRegionPick(r)}
            >
              {monthLabel(r)}
            </button>
          ))}
        </div>
        <div className="seg ml-auto" role="group" aria-label="Climatology sensor">
          {sensors.map((s) => (
            <button
              key={s}
              className="seg-item uppercase"
              aria-pressed={s === sensor}
              onClick={() => setSensorPick(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <ClimatologyBands months={months} />
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-dim">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm" style={{ background: ACCENT_2, opacity: 0.2 }} />
          p10–p90
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm" style={{ background: ACCENT_2, opacity: 0.45 }} />
          p25–p75
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-4 rounded" style={{ background: ACCENT }} />
          median p50
        </span>
        <span className="ml-auto font-mono">tile-days</span>
      </div>
    </LabCard>
  );
}

export function CoverageSlot() {
  const q = useData(loadCoverage, []);
  const rows = q.data?.rows ?? [];
  const sets = useMemo(() => {
    const map = new Map<
      string,
      { total: number; yes: number; years: Map<number, { total: number; yes: number }> }
    >();
    for (const r of rows) {
      let e = map.get(r.sensor_set);
      if (!e) {
        e = { total: 0, yes: 0, years: new Map() };
        map.set(r.sensor_set, e);
      }
      e.total += 1;
      if (r.has_data) e.yes += 1;
      const year = Number(r.date.slice(0, 4));
      let y = e.years.get(year);
      if (!y) {
        y = { total: 0, yes: 0 };
        e.years.set(year, y);
      }
      y.total += 1;
      if (r.has_data) y.yes += 1;
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const years = useMemo(
    () => Array.from(new Set(rows.map((r) => Number(r.date.slice(0, 4))))).sort((a, b) => a - b),
    [rows]
  );

  return (
    <LabCard
      title="Sensor coverage"
      chip="Measured"
      subtitle="Days each sensor set actually delivered a usable observation."
      state={q}
      raw={{ ...q.data, rows: undefined }}
      className="lg:col-span-2"
    >
      {sets.length === 0 ? (
        <p className="py-8 text-center text-xs text-ink-dim">No coverage rows loaded.</p>
      ) : (
        <>
          <div className="-mx-1 overflow-x-auto px-1">
          <div
            className="grid min-w-[520px] items-center gap-1 text-[9px] text-ink-dim"
            style={{
              gridTemplateColumns: `minmax(120px, 1.5fr) repeat(${years.length}, minmax(0, 1fr))`,
            }}
          >
            <span />
            {years.map((y) => (
              <span key={y} className="text-center font-mono">
                {y}
              </span>
            ))}
            {sets.map(([name, e]) => {
              const pct = e.total === 0 ? 0 : (e.yes / e.total) * 100;
              return (
                <div key={name} className="contents">
                  <div className="min-w-0 pr-2">
                    <p className="truncate text-[11px] font-medium capitalize text-ink">{name}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Meter value={pct} className="flex-1" />
                      <span className="font-mono text-[10px] text-ink-dim">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  {years.map((y) => {
                    const v = e.years.get(y);
                    const p = v && v.total > 0 ? v.yes / v.total : 0;
                    return (
                      <div
                        key={y}
                        title={`${name} · ${y}: ${Math.round(p * 100)}% of days with data`}
                        className="h-8 rounded-[5px] border border-line/60"
                        style={{
                          background:
                            p === 0 ? GAP_COLOR : `rgba(94, 224, 208, ${0.08 + 0.5 * p})`,
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-ink-dim">
            Dark cells are days with no usable observation — gaps, not zeros. Missing MODIS days
            are never silently filled.
          </p>
        </>
      )}
    </LabCard>
  );
}

export function RegionDailyLabSlot() {
  const q = useData(loadRegionDaily, []);
  const rows = q.data?.rows ?? [];
  const [regionPick, setRegionPick] = useState('indian_punjab');
  const regions = useMemo(() => Array.from(new Set(rows.map((r) => r.region))).sort(), [rows]);
  const region = regions.includes(regionPick) ? regionPick : (regions[0] ?? regionPick);
  const daily = useMemo<RegionDailyRow[]>(
    () => rows.filter((r) => r.region === region),
    [rows, region]
  );

  return (
    <LabCard
      title="Region daily series"
      chip="Measured"
      subtitle="Daily harmonized tile-days with the lo–hi band for each preset region."
      state={q}
      raw={{ ...q.data, rows: undefined }}
      className="lg:col-span-2"
    >
      <div className="seg mb-2" role="group" aria-label="Region daily series region">
        {regions.map((r) => (
          <button
            key={r}
            className="seg-item capitalize"
            aria-pressed={r === region}
            onClick={() => setRegionPick(r)}
          >
            {monthLabel(r)}
          </button>
        ))}
      </div>
      <SeriesChartSlot
        rows={daily}
        height={210}
        bare
        title={`Daily harmonized burning tile-days — ${monthLabel(region)}`}
      />
      <p className="mt-1 px-1 text-[11px] leading-relaxed text-ink-dim">
        Days without a usable observation stay as gaps in the line. Hover the chart for the exact
        value and its lo–hi band.
      </p>
    </LabCard>
  );
}

const SEVERITY: Record<Period['severity'], { label: string; bar: string; color: string }> = {
  low: { label: 'Low', bar: 'linear-gradient(90deg,#2f8f88,#5ee0d0)', color: '#5ee0d0' },
  moderate: { label: 'Moderate', bar: 'linear-gradient(90deg,#3f6fb5,#7fb2ea)', color: '#7fb2ea' },
  high: { label: 'High', bar: 'linear-gradient(90deg,#c9762a,#f6a544)', color: '#f6a544' },
  extreme: { label: 'Extreme', bar: 'linear-gradient(90deg,#ff8a3d,#ffc06b)', color: '#ff8a3d' },
};

export function PeriodsSlot() {
  const q = useData(loadPeriods, []);
  const periods = q.data?.periods ?? [];
  const bounds = useMemo(() => {
    if (periods.length === 0) return null;
    const starts = periods.map((p) => Date.parse(p.start));
    const ends = periods.map((p) =>
      p.end ? Date.parse(p.end) : Date.parse(p.start) + 1000 * 60 * 60 * 24 * 90
    );
    return { min: Math.min(...starts), max: Math.max(...ends) };
  }, [periods]);

  return (
    <LabCard
      title="Narrative periods"
      chip="Mixed"
      subtitle="Named episodes behind the storyline — each carries its severity and trust state."
      state={q}
      raw={q.data}
      className="lg:col-span-2"
    >
      {periods.length === 0 || !bounds ? (
        <p className="py-8 text-center text-xs text-ink-dim">No narrative periods loaded.</p>
      ) : (
        <>
          <ul className="space-y-0">
            {periods.map((p, i) => {
              const s = Date.parse(p.start);
              const e = p.end ? Date.parse(p.end) : bounds.max;
              const span = bounds.max - bounds.min || 1;
              const left = ((s - bounds.min) / span) * 100;
              const width = Math.max(1.5, ((e - s) / span) * 100);
              const sev = SEVERITY[p.severity] ?? SEVERITY.moderate;
              return (
                <li
                  key={`${p.start}-${i}`}
                  className="border-t border-line/60 py-2.5 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10.5px] text-ink-dim">
                      {p.start} → {p.end || 'open'}
                    </span>
                    <LabelChip label={p.firm ? 'Measured' : 'Provisional'} />
                    <span
                      className="ml-auto text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: sev.color }}
                    >
                      {sev.label}
                    </span>
                  </div>
                  <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-surface/70 ring-1 ring-line/50">
                    <span
                      className="absolute top-0 h-full rounded-full"
                      style={{ left: `${left}%`, width: `${width}%`, background: sev.bar }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">{p.sentence}</p>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 flex justify-between font-mono text-[9px] text-ink-dim">
            <span>{new Date(bounds.min).getUTCFullYear()}</span>
            <span>{new Date(bounds.max).getUTCFullYear()}</span>
          </div>
        </>
      )}
    </LabCard>
  );
}

function ReadingKey() {
  return (
    <section className="card flex flex-col p-4">
      <h2 className="card-title">How to read these diagnostics</h2>
      <ul className="mt-3 space-y-3 text-[11.5px] leading-relaxed text-ink-dim">
        <li className="flex gap-2">
          <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-2" />
          <span>
            <strong className="font-semibold text-ink">Trust labels are per card.</strong> Measured
            means one consistent sensor; Estimated and Provisional widen the lo–hi band.
          </span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-2" />
          <span>
            <strong className="font-semibold text-ink">Gaps stay gaps.</strong> Absent rows and null
            cells are drawn as missing — never as zero burning.
          </span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-2" />
          <span>
            <strong className="font-semibold text-ink">One relative scale.</strong> Everything is
            burning tile-days at VIIRS resolution — not fire counts, fire size or burned area.
          </span>
        </li>
      </ul>
      <p className="mt-auto pt-3">
        <span className="block rounded-lg border border-accent/25 bg-accent/[0.06] px-2.5 py-2 text-[10.5px] leading-relaxed text-amber-200">
          MODIS and VIIRS are harmonized onto one scale. They are never added together.
        </span>
      </p>
    </section>
  );
}

export function Proof() {
  return (
    <div className="space-y-4">
      <section className="card relative overflow-hidden p-5 sm:p-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(94,224,208,.2), transparent 70%)' }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(246,165,68,.14), transparent 70%)' }}
        />
        <p className="section-label">Proof / Lab</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
          Every number carries its receipt.
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-dim">
          The diagnostic files behind every value: validation, cross-calibration, observing-time
          drift, hourly geometry, climatology, sensor coverage and narrative periods. Each card
          states its trust label; the raw JSON stays one click away.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <LabelChip label="Measured" />
          <LabelChip label="Estimated" />
          <LabelChip label="Indicative" />
          <LabelChip label="Provisional" />
          <span className="ml-1 text-[10.5px] text-ink-dim">
            schema v1.0 · relative burning activity
          </span>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ValidationSlot />
        <RelaySimSlot />
        <ConversionSlot />
        <DriftSlot />
        <ClimatologyLabSlot />
        <CoverageSlot />
        <RegionDailyLabSlot />
        <HourlySlot />
        <ReadingKey />
        <PeriodsSlot />
      </div>
    </div>
  );
}
