import { useMemo, useState } from 'react';
import { LabelChip } from './LabelChip';
import type { JsonFile } from '../types';
import { ACCENT, ACCENT_2, INK_DIM, LINE } from '../theme';
import { fmtPct } from '../lib/derive';

interface Mission {
  name: string;
  sensor: string;
  from: string; // YYYY-MM
  to: string | null;
  role: string;
}

// Nominal mission windows from the build plan. They are drawn as reference
// bands, not measured coverage — the coverage panel shows what actually
// arrived.
const MISSIONS: Mission[] = [
  { name: 'Terra', sensor: 'MODIS', from: '2000-02', to: '2027-01', role: 'Era A · Terra only' },
  { name: 'Aqua', sensor: 'MODIS', from: '2002-05', to: '2027-09', role: 'Era B · Terra ∪ Aqua' },
  { name: 'Suomi NPP', sensor: 'VIIRS', from: '2012-01', to: '2026-11', role: 'Era C · measured reference' },
  { name: 'NOAA-20', sensor: 'VIIRS', from: '2018-01', to: null, role: 'Relay from 3 Nov 2026' },
];

const T0 = 2000;
const T1 = 2028;
const todayIso = new Date().toISOString().slice(0, 10);

function yearFraction(iso: string): number {
  const [y, m] = iso.split('-').map(Number);
  return y + (m - 1) / 12;
}

function pct(x: number): string {
  return `${((x - T0) / (T1 - T0)) * 100}%`;
}

interface SimRow {
  label: string;
  actual: number;
  built: number;
  diff: number;
}

function readSimSeries(sim: JsonFile | null): SimRow[] {
  const raw = sim?.series;
  if (!Array.isArray(raw)) return [];
  const out: SimRow[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    const actual = typeof o.suomi_actual === 'number' ? o.suomi_actual : null;
    const built = typeof o.relay_built === 'number' ? o.relay_built : null;
    if (actual === null || built === null) continue;
    out.push({
      label: typeof o.date === 'string' ? o.date : typeof o.week === 'string' ? o.week : '',
      actual,
      built,
      diff: typeof o.pct_diff === 'number' ? o.pct_diff : actual > 0 ? ((built - actual) / actual) * 100 : 0,
    });
  }
  return out;
}

function SensorLoss({
  sim,
  series,
}: {
  sim: JsonFile | null;
  series: SimRow[];
}) {
  const [mode, setMode] = useState<'compare' | 'difference'>('compare');
  const season = typeof sim?.season === 'string' ? sim.season : null;
  const relaySat = typeof sim?.relay_satellite === 'string' ? sim.relay_satellite : null;
  const overlap = typeof sim?.overlap_years === 'number' ? sim.overlap_years : null;

  const W = 560;
  const H = 170;
  const M = { top: 14, right: 12, bottom: 24, left: 40 };
  const maxY = Math.max(1, ...series.flatMap((r) => [r.actual, r.built])) * 1.08;
  const minDiff = mode === 'difference' ? Math.min(-1, ...series.map((r) => r.diff)) : 0;
  const maxDiff = mode === 'difference' ? Math.max(1, ...series.map((r) => r.diff)) : 0;
  const x = (i: number) => M.left + (i / Math.max(1, series.length - 1)) * (W - M.left - M.right);
  const y = (v: number) =>
    mode === 'difference'
      ? H - M.bottom - ((v - minDiff) / (maxDiff - minDiff || 1)) * (H - M.top - M.bottom)
      : H - M.bottom - (v / maxY) * (H - M.top - M.bottom);
  const line = (pick: (r: SimRow) => number) =>
    series.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pick(r)).toFixed(1)}`).join(' ');
  const meanDiff = series.length ? series.reduce((s, r) => s + r.diff, 0) / series.length : 0;

  return (
    <div className="mt-3 border-t border-line/60 pt-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-semibold text-ink">Sensor-Loss simulation</h3>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-dim">
            Pretend Suomi NPP stopped at the start of a past season, rebuild the series through the
            relay, and compare with what Suomi NPP actually saw.
            {season ? ` Season ${season}.` : ''}
          </p>
        </div>
        <LabelChip label={series.length ? 'Estimated' : 'Not supplied'} />
      </div>

      {series.length === 0 ? (
        <div className="mt-2 rounded-xl border border-dashed border-line/80 bg-surface/30 p-3">
          <p className="text-[10.5px] leading-relaxed text-ink-dim">
            The matched season series is not in the loaded relay file, so no percent difference can
            be shown. A simulated number here would be invented, so the panel stays empty until the
            simulation is supplied.
          </p>
          <p className="mt-1.5 rounded-md border border-line/60 bg-surface/50 px-2 py-1.5 font-mono text-[9.5px] leading-relaxed text-ink-dim">
            Required: relay_sim.series[] — {'{'}date, suomi_actual, relay_built, pct_diff{'}'} plus
            season, relay_satellite, overlap_years (M2)
          </p>
          <p className="mt-1.5 text-[9.5px] leading-snug text-ink-dim">
            Sensor-Loss is a simulation, not a measured real-world percentage. Data after 2 November
            2026 is Provisional and carries no percent claim.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="seg" role="radiogroup" aria-label="Sensor-Loss view">
              <button
                role="radio"
                aria-checked={mode === 'compare'}
                onClick={() => setMode('compare')}
                className="seg-item"
              >
                Actual vs relay
              </button>
              <button
                role="radio"
                aria-checked={mode === 'difference'}
                onClick={() => setMode('difference')}
                className="seg-item"
              >
                Percent difference
              </button>
            </div>
            <span className="ml-auto font-mono text-[11px] text-ink-dim">
              mean {fmtPct(meanDiff, 1)}
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label="Sensor-Loss simulation">
            {[0, 0.5, 1].map((f) => (
              <line
                key={f}
                x1={M.left}
                x2={W - M.right}
                y1={M.top + f * (H - M.top - M.bottom)}
                y2={M.top + f * (H - M.top - M.bottom)}
                stroke={LINE}
                strokeWidth={0.6}
                strokeDasharray="2 4"
                opacity={0.55}
              />
            ))}
            {mode === 'difference' ? (
              <>
                <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke={ACCENT_2} strokeWidth={1} opacity={0.6} />
                <path d={line((r) => r.diff)} fill="none" stroke={ACCENT} strokeWidth={2} />
                <text x={M.left - 6} y={y(0) + 3} fontSize={8.5} fill={ACCENT_2} textAnchor="end">
                  0
                </text>
              </>
            ) : (
              <>
                <path d={line((r) => r.actual)} fill="none" stroke={ACCENT_2} strokeWidth={2} />
                <path d={line((r) => r.built)} fill="none" stroke={ACCENT} strokeWidth={1.8} strokeDasharray="4 3" />
              </>
            )}
            <text x={M.left} y={M.top - 4} fontSize={8.5} fill={INK_DIM}>
              {mode === 'difference' ? 'relay − actual (%)' : 'tile-days'}
            </text>
          </svg>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-dim">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-[2px] w-4 rounded" style={{ background: ACCENT_2 }} />
              Suomi NPP actual
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-[2px] w-4 rounded" style={{ background: ACCENT }} />
              relay-built
            </span>
            <span className="ml-auto font-mono">
              {relaySat ?? 'relay'}
              {overlap ? ` · ${overlap} shared years` : ''}
            </span>
          </div>
          <p className="mt-1.5 text-[9.5px] leading-snug text-ink-dim">
            Simulation only — never a measured real-world percentage. The toggle switches between
            what Suomi NPP saw and what the relay would have rebuilt.
          </p>
        </>
      )}
    </div>
  );
}

/** Relay timeline for the current handover, plus the Sensor-Loss simulation UI. */
export function RelayTimeline({
  sim,
  loading = false,
  error = null,
  onRetry,
}: {
  sim: JsonFile | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const series = useMemo(() => readSimSeries(sim), [sim]);
  const todayFrac = yearFraction(todayIso.slice(0, 7));

  return (
    <section className="card p-4" aria-labelledby="relay-title">
      <header className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 id="relay-title" className="card-title">
            Relay timeline
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
            Suomi NPP stopped delivering on 2 Nov 2026. The relay satellite is aligned on shared
            years and carries the record from 3 Nov 2026; those months are Provisional.
          </p>
        </div>
        <LabelChip label="Provisional" />
      </header>

      {loading && <p className="py-8 text-center text-xs text-ink-dim">Loading relay data…</p>}
      {error && !loading && (
        <p className="flex flex-wrap items-center gap-2 py-4 text-xs text-red-300">
          <span>{error}</span>
          {onRetry && (
            <button onClick={onRetry} className="btn btn-ghost btn-sm">
              Retry
            </button>
          )}
        </p>
      )}

      {!loading && !error && (
        <>
          <div className="relative pt-1">
            <div className="mb-1 flex justify-between font-mono text-[9px] text-ink-dim">
              {[2000, 2006, 2012, 2018, 2024, 2028].map((y) => (
                <span key={y}>{y}</span>
              ))}
            </div>
            <div className="relative space-y-1.5">
              <div
                aria-hidden="true"
                className="absolute inset-y-0 rounded-sm border border-dashed border-accent-2/30 bg-accent-2/[0.05]"
                style={{ left: pct(2019), width: `calc(${pct(2026.85)} - ${pct(2019)})` }}
              />
              {MISSIONS.map((m) => {
                const to = m.to ?? '2028-01';
                const start = yearFraction(m.from);
                const end = yearFraction(to);
                const relayed = m.name === 'NOAA-20';
                return (
                  <div key={m.name} className="relative h-6">
                    <div
                      className="absolute top-0 flex h-6 items-center overflow-hidden rounded-[5px] border px-1.5"
                      style={{
                        left: pct(start),
                        width: `calc(${pct(end)} - ${pct(start)})`,
                        borderColor: relayed ? 'rgba(246,165,68,.55)' : 'rgba(94,224,208,.35)',
                        background: relayed ? 'rgba(246,165,68,.14)' : 'rgba(94,224,208,.10)',
                      }}
                      title={`${m.name} (${m.sensor}) ${m.from} → ${m.to ?? 'open'} · ${m.role}`}
                    >
                      <span className="truncate text-[9.5px] text-ink">
                        {m.name} <span className="text-ink-dim">· {m.sensor}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
              <div
                aria-hidden="true"
                className="absolute -top-1 bottom-0 w-px bg-ink/50"
                style={{ left: pct(todayFrac) }}
              />
              <span
                className="absolute -top-5 -translate-x-1/2 font-mono text-[9px] text-ink-dim"
                style={{ left: pct(todayFrac) }}
              >
                today
              </span>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-dim">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-sm border border-accent-2/40 bg-accent-2/10" />
              VIIRS reference
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-sm border border-accent/50 bg-accent/15" />
              relay
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-sm border border-dashed border-accent-2/40" />
              bundled data window
            </span>
          </div>
          <p className="mt-1.5 text-[9.5px] leading-snug text-ink-dim">
            Nominal mission windows from the build plan, not measured availability — the sensor
            coverage panel shows what actually arrived.
          </p>

          <SensorLoss sim={sim} series={series} />
        </>
      )}
    </section>
  );
}
