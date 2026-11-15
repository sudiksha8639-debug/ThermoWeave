
import { useMemo } from 'react';
import { LabelChip } from '../LabelChip';
import { ACCENT, ACCENT_2, INK_DIM, LINE } from '../../theme';
import { fmt, monthShort, type MonthAgg } from '../../lib/derive';

const THRESHOLD = 0.5;

/**
 * Shows the average tile-month burning fraction.
 * Each tile-month fraction is harm / days in the month.
 */
export function SaturationPanel({
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
  const rows = useMemo(
    () =>
      months
        .filter((m) => m.fracMean !== null)
        .sort((a, b) => (b.fracMean ?? 0) - (a.fracMean ?? 0)),
    [months]
  );

  const near = rows.filter((m) => (m.fracMean ?? 0) >= THRESHOLD);
  const peak = rows[0] ?? null;

  const W = 560;
  const H = 170;
  const M = { top: 14, right: 12, bottom: 24, left: 36 };
  const recent = useMemo(
    () => months.filter((m) => m.fracMean !== null).slice(-24),
    [months]
  );
  const maxFrac = Math.max(THRESHOLD * 1.2, ...recent.map((m) => m.fracMean ?? 0));
  const bw = (W - M.left - M.right) / Math.max(1, recent.length);
  const x = (i: number) => M.left + i * bw;
  const y = (v: number) => H - M.bottom - (v / maxFrac) * (H - M.top - M.bottom);

  return (
    <section className="card flex min-w-0 flex-col p-4" aria-labelledby="sat-title">
      <header className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 id="sat-title" className="card-title">
            Tile-month burning fraction
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
            Average fraction of days with burning activity per in-scope tile.
            Read this alongside the raw hotspot calendar view.
          </p>
        </div>
        <LabelChip label="Measured" />
      </header>

      {loading && <p className="py-8 text-center text-xs text-ink-dim">Loading fractions…</p>}

      {error && !loading && (
        <p className="flex flex-wrap items-center gap-2 py-6 text-xs text-red-300">
          <span>{error}</span>
          <button onClick={onRetry} className="btn btn-ghost btn-sm">
            Retry
          </button>
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="py-8 text-center text-xs text-ink-dim">
          No <span className="font-mono">frac_burning</span> column in the loaded tile-month files,
          so this metric cannot be shown. This is a missing field, not a zero.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-accent-2/40 bg-accent-2/10 px-2.5 py-1 text-[10.5px] text-accent-2">
              {near.length} month{near.length === 1 ? '' : 's'} at or above 50% average tile-month fraction
            </span>
            {peak && (
              <span className="text-[10.5px] text-ink-dim">
                Highest: {peak.year}-{String(peak.month).padStart(2, '0')} ·{' '}
                {fmt((peak.fracMean ?? 0) * 100, 1)}%
              </span>
            )}
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label="Average tile-month burning fraction by month"
          >
            {[0, THRESHOLD, 1].map((t) => (
              <g key={t}>
                <line
                  x1={M.left}
                  x2={W - M.right}
                  y1={y(Math.min(t, maxFrac))}
                  y2={y(Math.min(t, maxFrac))}
                  stroke={t === THRESHOLD ? ACCENT : LINE}
                  strokeWidth={t === THRESHOLD ? 1 : 0.6}
                  strokeDasharray={t === THRESHOLD ? '4 4' : '2 4'}
                  opacity={0.65}
                />
                {t <= maxFrac && (
                  <text
                    x={M.left - 6}
                    y={y(t) + 3}
                    fontSize={8.5}
                    fill={t === THRESHOLD ? ACCENT : INK_DIM}
                    textAnchor="end"
                  >
                    {Math.round(t * 100)}%
                  </text>
                )}
              </g>
            ))}

            {recent.map((m, i) => {
              const v = m.fracMean ?? 0;
              const hot = v >= THRESHOLD;

              return (
                <g key={m.ym}>
                  <rect
                    x={x(i) + bw * 0.18}
                    y={y(v)}
                    width={bw * 0.64}
                    height={Math.max(1, y(0) - y(v))}
                    rx={1.5}
                    fill={hot ? ACCENT : ACCENT_2}
                    opacity={hot ? 0.9 : 0.55}
                  >
                    <title>
                      {`${m.year}-${String(m.month).padStart(2, '0')}: ${fmt(v * 100, 1)}% average tile-month fraction · ${m.nearSat} tile-month rows ≥50%`}
                    </title>
                  </rect>

                  {i % 3 === 0 && (
                    <text
                      x={x(i) + bw / 2}
                      y={H - 8}
                      fontSize={8}
                      fill={INK_DIM}
                      textAnchor="middle"
                    >
                      {monthShort(m.month).slice(0, 1)}
                    </text>
                  )}
                </g>
              );
            })}

            <text x={M.left} y={M.top - 4} fontSize={8.5} fill={INK_DIM}>
              Last {recent.length} months · average tile-month fraction
            </text>
          </svg>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-dim">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm" style={{ background: ACCENT_2, opacity: 0.55 }} />
              Below 50%
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm" style={{ background: ACCENT }} />
              At or above 50%
            </span>
          </div>

          {near.length > 0 && (
            <ul className="mt-2 space-y-1">
              {near.slice(0, 4).map((m) => (
                <li key={m.ym} className="flex flex-wrap items-center gap-2 text-[10.5px]">
                  <span className="font-mono text-ink">
                    {m.year}-{String(m.month).padStart(2, '0')}
                  </span>
                  <span className="text-ink-dim">
                    {m.nearSat} tile-month rows at or above 50%
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">
            Each tile-month fraction is calculated as harmonized tile-days divided by days in that
            month. Higher values indicate more days with burning activity within a tile.
          </p>
        </>
      )}
    </section>
  );
}
