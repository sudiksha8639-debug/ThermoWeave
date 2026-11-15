import { useEffect, useMemo, useRef, useState } from 'react';
import type { RegionDailyRow } from '../types';
import { ACCENT, ACCENT_2, INK, INK_DIM, LINE } from '../theme';
import { fmt, fmtPct } from '../lib/derive';

interface Point {
  label: string;
  naive: number;
  harm: number;
}

/** Monthly totals: the naive stitched series vs the harmonized series. */
function monthlyPoints(rows: RegionDailyRow[]): Point[] {
  const map = new Map<string, { naive: number; harm: number; naiveDays: number }>();
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    let e = map.get(key);
    if (!e) {
      e = { naive: 0, harm: 0, naiveDays: 0 };
      map.set(key, e);
    }
    if (r.harm !== null) e.harm += r.harm;
    // Naive splice: whatever the sensor of the day reports, stitched with no
    // conversion. MODIS is preferred where present, VIIRS where it is the only
    // source — exactly the shortcut the harmonized line replaces.
    const naive = r.raw_modis ?? r.raw_viirs;
    if (naive !== null) {
      e.naive += naive;
      e.naiveDays += 1;
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([, v]) => v.harm > 0 && v.naive > 0)
    .map(([label, v]) => ({
      label,
      naive: v.naive,
      harm: v.harm,
    }));
}

/**
 * Phantom Surge Reveal — the naive series transitions into the harmonized
 * series. If a sensor handover falls inside the loaded window the step is
 * marked; in the bundled development window it does not, and the caption says
 * so rather than inventing a cliff.
 */
export function PhantomSurge({
  rows,
  loading = false,
  error = null,
  onRetry,
  regionLabel,
}: {
  rows: RegionDailyRow[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  regionLabel?: string | null;
}) {
  const data = useMemo(() => monthlyPoints(rows), [rows]);
  const reduced = useRef(
    typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ).current;
  const [reveal, setReveal] = useState(reduced ? 1 : 0);
  const raf = useRef<number | null>(null);

  const play = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    if (reduced) {
      setReveal(1);
      return;
    }
    const start = performance.now();
    const dur = 1500;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      setReveal(t * t * (3 - 2 * t));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    setReveal(0);
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (data.length === 0) return;
    play();
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.length]);

  const stats = useMemo(() => {
    if (data.length === 0) return null;
    const offsets = data.map((p) => ((p.harm - p.naive) / p.naive) * 100);
    const mean = offsets.reduce((s, v) => s + v, 0) / offsets.length;
    const maxGap = Math.max(...offsets.map(Math.abs));
    const peak = data.reduce((a, b) => (b.harm > a.harm ? b : a), data[0]);
    return { mean, maxGap, peak };
  }, [data]);

  const W = 720;
  const H = 226;
  const M = { top: 16, right: 16, bottom: 26, left: 44 };
  const maxY = Math.max(1, ...data.map((p) => Math.max(p.harm, p.naive))) * 1.06;
  const x = (i: number) => M.left + (i / Math.max(1, data.length - 1)) * (W - M.left - M.right);
  const y = (v: number) => H - M.bottom - (v / maxY) * (H - M.top - M.bottom);

  const path = (pick: (p: Point) => number) =>
    data.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(' ');

  const tween = (p: Point) => p.naive + (p.harm - p.naive) * reveal;
  const blendPath = data
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(tween(p)).toFixed(1)}`)
    .join(' ');
  const gapArea = data.length
    ? `${path((p) => p.naive)} L${x(data.length - 1).toFixed(1)},${y(
        data[data.length - 1].harm
      ).toFixed(1)} ${data
        .slice()
        .reverse()
        .map((p, i) => `L${x(data.length - 1 - i).toFixed(1)},${y(p.harm).toFixed(1)}`)
        .join(' ')} Z`
    : '';

  const tickIdx = data
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.label.endsWith('-01'));

  if (loading) {
    return (
      <div className="card p-6">
        <p className="card-title">Phantom Surge Reveal</p>
        <p className="py-10 text-center text-xs text-ink-dim">Loading the series…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <p className="card-title">Phantom Surge Reveal</p>
        <p className="flex flex-wrap items-center gap-2 py-6 text-xs text-red-300">
          <span>{error}</span>
          {onRetry && (
            <button onClick={onRetry} className="btn btn-ghost btn-sm">
              Retry
            </button>
          )}
        </p>
      </div>
    );
  }

  if (data.length === 0 || !stats) {
    return (
      <div className="card p-6">
        <p className="card-title">Phantom Surge Reveal</p>
        <p className="py-8 text-center text-xs text-ink-dim">
          No daily series is loaded for this region, so there is nothing to reveal. Missing days
          stay gaps — they are never drawn as zero.
        </p>
      </div>
    );
  }

  return (
    <section className="card overflow-hidden" aria-labelledby="phantom-title">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-2">
        <div className="max-w-2xl">
          <p className="section-label">The phantom surge</p>
          <h2 id="phantom-title" className="mt-1.5 text-lg font-semibold tracking-tight text-ink">
            A satellite upgrade, not a fire surge.
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-dim">
            The dashed line is the record on the pre-2012 sensor scale — what a satellite switch
            without conversion leaves behind — {' '}{regionLabel ?? 'the selected region'}, monthly
            totals. The ember-to-teal line is the same record after MODIS is converted onto the VIIRS
            scale. Press replay to melt one into the other.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={play} className="btn btn-primary btn-sm">
            Replay reveal
          </button>
          <label className="flex items-center gap-2 text-[10.5px] text-ink-dim">
            <span className="sr-only">Reveal progress</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(reveal * 100)}
              onChange={(e) => {
                if (raf.current !== null) cancelAnimationFrame(raf.current);
                setReveal(Number(e.target.value) / 100);
              }}
              aria-label="Phantom Surge reveal progress"
              className="range w-24"
              style={{
                background: `linear-gradient(90deg, #f6a544 ${reveal * 100}%, #2a3550 ${
                  reveal * 100
                }%)`,
              }}
            />
            <span className="w-8 font-mono text-right">{Math.round(reveal * 100)}%</span>
          </label>
        </div>
      </div>

      <div className="px-3 pb-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label="Naive sensor-spliced series compared with the harmonized series"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const v = maxY * f;
            return (
              <g key={f}>
                <line
                  x1={M.left}
                  x2={W - M.right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke={LINE}
                  strokeWidth={0.6}
                  strokeDasharray={f === 0 ? undefined : '2 4'}
                  opacity={0.65}
                />
                <text x={M.left - 8} y={y(v) + 3} fontSize={9} fill={INK_DIM} textAnchor="end">
                  {Math.round(v)}
                </text>
              </g>
            );
          })}
          {tickIdx.map(({ p, i }) => (
            <text key={p.label} x={x(i)} y={H - 8} fontSize={9} fill={INK_DIM} textAnchor="middle">
              {p.label.slice(0, 4)}
            </text>
          ))}

          <path d={gapArea} fill={ACCENT} opacity={0.1 * (1 - reveal)} />
          <path
            d={path((p) => p.naive)}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1.8}
            strokeDasharray="5 4"
            opacity={1 - 0.85 * reveal}
          />
          <path
            d={path((p) => p.harm)}
            fill="none"
            stroke={ACCENT_2}
            strokeWidth={1.4}
            opacity={0.25 + 0.25 * reveal}
          />
          <path d={blendPath} fill="none" stroke={ACCENT_2} strokeWidth={2.2} strokeLinejoin="round" />

          <text x={M.left} y={M.top - 5} fontSize={9} fill={INK_DIM}>
            tile-days per month
          </text>
          <g>
            <circle cx={W - M.right - 118} cy={M.top + 2} r={3} fill={ACCENT} opacity={1 - reveal} />
            <text x={W - M.right - 110} y={M.top + 5} fontSize={9} fill={INK_DIM} opacity={1 - reveal}>
              MODIS-scale record
            </text>
            <circle cx={W - M.right - 118} cy={M.top + 16} r={3} fill={ACCENT_2} />
            <text x={W - M.right - 110} y={M.top + 19} fontSize={9} fill={INK} opacity={0.4 + 0.6 * reveal}>
              harmonized (VIIRS scale)
            </text>
          </g>
        </svg>
      </div>

      <div className="grid gap-3 border-t border-line/60 px-5 py-3 sm:grid-cols-3">
        <div>
          <p className="section-label">Sensor-scale offset</p>
          <p className="mt-1 font-mono text-lg text-ink">{fmtPct(stats.mean, 1)}</p>
          <p className="mt-0.5 text-[10.5px] leading-snug text-ink-dim">
            Mean gap between the MODIS-scale line and the harmonized line across {data.length} months.
          </p>
        </div>
        <div>
          <p className="section-label">Largest monthly gap</p>
          <p className="mt-1 font-mono text-lg text-ink">{fmt(stats.maxGap, 1)}%</p>
          <p className="mt-0.5 text-[10.5px] leading-snug text-ink-dim">
            Peak harmonized month: {stats.peak.label} at {fmt(stats.peak.harm)} tile-days.
          </p>
        </div>
        <div>
          <p className="section-label">The 2012 seam</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
            The real phantom surge happened at the 2012 MODIS→VIIRS handover. That date lies before
            the bundled data window, so this preview shows the sensor-scale offset the seam was made
            of, not the seam itself.
          </p>
        </div>
      </div>
      <p className="border-t border-line/60 px-5 py-2 text-[10.5px] leading-relaxed text-ink-dim">
        Development window only — computed from the bundled data files. The MODIS-scale line is the
        pre-2012 stand-in, not a second index; MODIS and VIIRS are never added together in the
        headline record.
      </p>
    </section>
  );
}
