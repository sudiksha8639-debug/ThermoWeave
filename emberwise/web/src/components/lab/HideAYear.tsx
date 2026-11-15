import { useMemo } from 'react';
import { LabelChip } from '../LabelChip';
import { ACCENT, ACCENT_2, INK, INK_DIM, LINE } from '../../theme';
import { fmt, fmtPct, hideAYear, type MonthAgg } from '../../lib/derive';

/**
 * Hide-a-year experiment: learn the MODIS→VIIRS ratio from every year except
 * one, predict the held-out year from MODIS alone, compare with the VIIRS
 * record. Error by activity level is reported separately so tail error cannot
 * hide inside a single average.
 */
export function HideAYearPanel({
  months,
  loading,
  error,
  onRetry,
  regionLabel,
}: {
  months: MonthAgg[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  regionLabel: string | null;
}) {
  const result = useMemo(() => hideAYear(months), [months]);

  const W = 560;
  const H = 190;
  const M = { top: 16, right: 14, bottom: 26, left: 40 };

  const chart = useMemo(() => {
    if (!result) return null;
    const maxY = Math.max(...result.rows.flatMap((r) => [r.viirs, r.predicted])) * 1.08;
    const bw = (W - M.left - M.right) / result.rows.length;
    const x = (i: number) => M.left + (i + 0.5) * bw;
    const y = (v: number) => H - M.bottom - (v / maxY) * (H - M.top - M.bottom);
    return { maxY, bw, x, y };
  }, [result]);

  return (
    <section className="card flex min-w-0 flex-col p-4 lg:col-span-2" aria-labelledby="hay-title">
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="hay-title" className="card-title">
            Hide-a-year experiment
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
            One year is hidden, the MODIS→VIIRS ratio is learned from the others, and that year is
            predicted from MODIS alone. {regionLabel ?? 'Selected region'} · development window.
          </p>
        </div>
        <LabelChip label="Estimated" />
      </header>

      {loading && <p className="py-10 text-center text-xs text-ink-dim">Running hide-a-year…</p>}
      {error && !loading && (
        <p className="flex flex-wrap items-center gap-2 py-6 text-xs text-red-300">
          <span>{error}</span>
          <button onClick={onRetry} className="btn btn-ghost btn-sm">
            Retry
          </button>
        </p>
      )}

      {!loading && !error && !result && (
        <div className="flex flex-1 flex-col justify-center py-6 text-center">
          <p className="text-xs text-ink-dim">
            Not enough years with both sensors in the loaded window. At least three complete years
            are needed to hide one and learn from the rest.
          </p>
        </div>
      )}

      {!loading && !error && result && chart && (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <Metric label="Mean abs error" value={`${fmt(result.meanAbsErrorPct, 1)}%`} />
            <Metric label="Mean bias" value={fmtPct(result.meanBiasPct, 1)} />
            <Metric
              label="Rank correlation"
              value={result.rankCorrelation === null ? '—' : result.rankCorrelation.toFixed(2)}
              hint="Spearman, MODIS vs VIIRS yearly totals"
            />
            <Metric
              label="Ratio spread"
              value={result.ratioCvPct === null ? '—' : `${fmt(result.ratioCvPct, 1)}%`}
              hint="Coefficient of variation of yearly ratios"
            />
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="mt-2 w-full"
            role="img"
            aria-label="Predicted versus actual VIIRS tile-days for each hidden year"
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1={M.left}
                  x2={W - M.right}
                  y1={chart.y(chart.maxY * f)}
                  y2={chart.y(chart.maxY * f)}
                  stroke={LINE}
                  strokeWidth={0.6}
                  strokeDasharray={f === 0 ? undefined : '2 4'}
                  opacity={0.6}
                />
                <text
                  x={M.left - 8}
                  y={chart.y(chart.maxY * f) + 3}
                  fontSize={9}
                  fill={INK_DIM}
                  textAnchor="end"
                >
                  {Math.round(chart.maxY * f).toLocaleString()}
                </text>
              </g>
            ))}
            {result.rows.map((r, i) => {
              const cx = chart.x(i);
              const bw = chart.bw * 0.34;
              return (
                <g key={r.year}>
                  <rect
                    x={cx - bw / 2}
                    y={chart.y(r.viirs)}
                    width={bw}
                    height={Math.max(1, chart.y(0) - chart.y(r.viirs))}
                    rx={2}
                    fill={ACCENT_2}
                    opacity={0.45}
                  >
                    <title>{`${r.year} actual VIIRS ${fmt(r.viirs)} tile-days`}</title>
                  </rect>
                  <line
                    x1={cx + bw / 2}
                    x2={cx + bw / 2 + 6}
                    y1={chart.y(r.viirs)}
                    y2={chart.y(r.predicted)}
                    stroke={ACCENT}
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                  <rect
                    x={cx + bw / 2 + 6}
                    y={chart.y(r.predicted) - 1.5}
                    width={5}
                    height={5}
                    fill={ACCENT}
                    transform={`rotate(45 ${cx + bw / 2 + 8.5} ${chart.y(r.predicted)})`}
                  >
                    <title>{`${r.year} predicted ${fmt(r.predicted)} tile-days (${fmtPct(
                      r.errorPct,
                      1
                    )})`}</title>
                  </rect>
                  <text x={cx} y={H - 8} fontSize={9} fill={INK_DIM} textAnchor="middle">
                    {r.year}
                  </text>
                  <text
                    x={cx}
                    y={chart.y(Math.max(r.viirs, r.predicted)) - 5}
                    fontSize={8.5}
                    fill={INK}
                    textAnchor="middle"
                  >
                    {fmtPct(r.errorPct, 0)}
                  </text>
                </g>
              );
            })}
            <text x={M.left} y={M.top - 5} fontSize={9} fill={INK_DIM}>
              tile-days
            </text>
          </svg>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-dim">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm" style={{ background: ACCENT_2, opacity: 0.45 }} />
              actual VIIRS
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rotate-45" style={{ background: ACCENT }} />
              predicted from MODIS
            </span>
            <span className="ml-auto font-mono">error % above each year</span>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-[11px]">
              <thead>
                <tr className="text-left text-ink-dim">
                  <th className="py-1 pr-2 font-medium">Activity level</th>
                  <th className="py-1 pr-2 text-right font-medium">Mean abs error</th>
                  <th className="py-1 pr-2 text-right font-medium">Bias</th>
                  <th className="py-1 text-right font-medium">Years</th>
                </tr>
              </thead>
              <tbody>
                {result.byLevel.map((b) => (
                  <tr key={b.level} className="border-t border-line/60">
                    <td className="py-1 pr-2 text-ink">{b.label}</td>
                    <td className="py-1 pr-2 text-right font-mono">{fmt(b.meanAbsErrorPct, 1)}%</td>
                    <td className="py-1 pr-2 text-right font-mono">{fmtPct(b.biasPct, 1)}</td>
                    <td className="py-1 text-right font-mono text-ink-dim">{b.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-dim">
            {result.rows.length} usable years, {result.pilotMonths.length ? 'Oct–Nov pilot months' : 'all months'} ·{' '}
            {result.rows.length < 8
              ? `${result.rows.length} years cannot support a precise interval-coverage claim.`
              : 'Eight years still cannot support a precise coverage claim.'}{' '}
            One ratio per zone-month assumes MODIS scales linearly to VIIRS; if the error grows in
            the low or high third, that assumption is the reason and the isotonic mapping is the
            planned T2 replacement.
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">
            Computed in the browser from the loaded development files — not the official record and
            not a published validation result. Near-zero error here is a property of the synthetic
            mocks; real files will not be this clean.
          </p>
        </>
      )}
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface/40 px-3 py-2.5">
      <p className="section-label">{label}</p>
      <p className="mt-1.5 font-mono text-[16px] font-semibold leading-none text-ink">{value}</p>
      {hint && <p className="mt-1.5 text-[9.5px] leading-snug text-ink-dim">{hint}</p>}
    </div>
  );
}
