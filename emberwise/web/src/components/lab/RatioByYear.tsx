import { useMemo } from 'react';
import { LabelChip } from '../LabelChip';
import { ACCENT, ACCENT_2, INK_DIM, LINE } from '../../theme';
import { LEARNING_WINDOW, fmt, ratioByYear, type MonthAgg } from '../../lib/derive';

/**
 * Ratio by year: the MODIS-to-VIIRS tile-day ratio, 2012–2026 where data
 * exists, with the learning window marked. This is the evidence behind
 * learning the conversion before the satellites drifted — it is shown whatever
 * it reveals.
 */
export function RatioByYearPanel({
  months,
  loading,
  error,
  onRetry,
}: {
  months: MonthAgg[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const rows = useMemo(() => ratioByYear(months), [months]);

  const W = 720;
  const H = 200;
  const M = { top: 16, right: 16, bottom: 26, left: 40 };
  const firstYear = rows.length ? rows[0].year : LEARNING_WINDOW.from;
  const lastYear = rows.length ? rows[rows.length - 1].year : LEARNING_WINDOW.to;
  const domain: [number, number] = [Math.min(LEARNING_WINDOW.from, firstYear), Math.max(lastYear, LEARNING_WINDOW.to)];
  const ratios = rows.map((r) => r.ratio);
  const lo = Math.min(0.9, ...(ratios.length ? ratios : [1])) - 0.05;
  const hi = Math.max(1.1, ...(ratios.length ? ratios : [1])) + 0.05;
  const x = (year: number) =>
    M.left + ((year - domain[0]) / Math.max(1, domain[1] - domain[0])) * (W - M.left - M.right);
  const y = (v: number) => H - M.bottom - ((v - lo) / (hi - lo)) * (H - M.top - M.bottom);

  const path = rows
    .map((r, i) => `${i === 0 ? 'M' : 'L'}${x(r.year).toFixed(1)},${y(r.ratio).toFixed(1)}`)
    .join(' ');

  const significant = useMemo(() => {
    if (rows.length < 4) return null;
    const n = rows.length;
    const mx = rows.reduce((s, r) => s + r.year, 0) / n;
    const my = rows.reduce((s, r) => s + r.ratio, 0) / n;
    let num = 0;
    let den = 0;
    for (const r of rows) {
      num += (r.year - mx) * (r.ratio - my);
      den += (r.year - mx) ** 2;
    }
    if (den === 0) return null;
    const slope = num / den;
    // total change across the loaded span
    return { slope, change: slope * (rows[rows.length - 1].year - rows[0].year) };
  }, [rows]);

  return (
    <section className="card flex min-w-0 flex-col p-4 lg:col-span-2" aria-labelledby="ratio-title">
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="ratio-title" className="card-title">
            Ratio by year · MODIS → VIIRS
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
            MODIS tile-days ÷ VIIRS tile-days for the pilot months, with the 2012–2019 learning
            window marked. The chart is shown whatever it reveals: if the relationship moved after
            about 2020, that is the reason the conversion is learned before the drift.
          </p>
        </div>
        <LabelChip label="Estimated" />
      </header>

      {loading && <p className="py-10 text-center text-xs text-ink-dim">Loading the ratio…</p>}
      {error && !loading && (
        <p className="flex flex-wrap items-center gap-2 py-6 text-xs text-red-300">
          <span>{error}</span>
          <button onClick={onRetry} className="btn btn-ghost btn-sm">
            Retry
          </button>
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="py-10 text-center text-xs text-ink-dim">
          No year has both MODIS and VIIRS tile-days in the loaded files, so no ratio can be
          computed. This is a gap, not a ratio of zero.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label="MODIS to VIIRS tile-day ratio by year with the learning window marked"
          >
            <rect
              x={x(LEARNING_WINDOW.from)}
              y={M.top}
              width={Math.max(0, x(LEARNING_WINDOW.to + 1) - x(LEARNING_WINDOW.from))}
              height={H - M.top - M.bottom}
              fill={ACCENT_2}
              opacity={0.07}
            />
            <text
              x={x(LEARNING_WINDOW.from) + 4}
              y={M.top + 11}
              fontSize={8.5}
              fill={INK_DIM}
            >
              learning window 2012–2019
            </text>

            {[lo, 1, hi].map((t, i) => (
              <g key={i}>
                <line
                  x1={M.left}
                  x2={W - M.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 1 ? ACCENT_2 : LINE}
                  strokeWidth={t === 1 ? 1 : 0.6}
                  strokeDasharray={t === 1 ? '4 4' : '2 4'}
                  opacity={t === 1 ? 0.6 : 0.55}
                />
                <text x={M.left - 8} y={y(t) + 3} fontSize={9} fill={t === 1 ? ACCENT_2 : INK_DIM} textAnchor="end">
                  {t.toFixed(1)}
                </text>
                {t === 1 && (
                  <text x={W - M.right} y={y(1) - 4} fontSize={8.5} fill={ACCENT_2} textAnchor="end">
                    parity
                  </text>
                )}
              </g>
            ))}

            {rows.map((r) => (
              <text key={r.year} x={x(r.year)} y={H - 8} fontSize={8.5} fill={INK_DIM} textAnchor="middle">
                {r.year}
              </text>
            ))}

            <path d={path} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" />
            {rows.map((r) => (
              <circle key={r.year} cx={x(r.year)} cy={y(r.ratio)} r={r.inLearningWindow ? 3.4 : 2.6}
                fill={r.inLearningWindow ? ACCENT_2 : ACCENT}>
                <title>{`${r.year}: ratio ${r.ratio.toFixed(2)} (MODIS ${fmt(r.modis)} · VIIRS ${fmt(
                  r.viirs
                )} tile-days, ${r.months} months)`}</title>
              </circle>
            ))}
            <text x={M.left} y={M.top - 5} fontSize={9} fill={INK_DIM}>
              VIIRS ÷ MODIS tile-days
            </text>
          </svg>

          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-dim">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: ACCENT_2 }} />
              inside learning window
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: ACCENT }} />
              after the learning window
            </span>
            <span className="ml-auto font-mono">1.0 = same count on both scales</span>
          </div>

          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-dim">
            {significant
              ? `${rows.length} years of data: the fitted trend is ${significant.slope >= 0 ? '+' : ''}${(
                  significant.slope * 10
                ).toFixed(3)} per decade (${significant.change >= 0 ? '+' : ''}${significant.change.toFixed(
                  2
                )} across the loaded span). ${
                  Math.abs(significant.change) > 0.15
                    ? 'A move this large is a reason to shorten the learning window, widen the range and flag the zone-month behaviour-sensitive.'
                    : 'No clear move is visible in this window; say so rather than claiming divergence.'
                }`
              : `Only ${rows.length} year${rows.length === 1 ? '' : 's'} of ratio data are loaded, so no trend is fitted. The learning window itself lies mostly before the bundled window.`}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">
            The ratio is not a correction and is not applied to the headline index. Some of any
            movement could reflect changed burning habits rather than sensor difference — that limit
            is stated in Methods.
          </p>
        </>
      )}
    </section>
  );
}
