import { useThisMonth } from '../hooks';
import { LabelChip } from './LabelChip';
import { Meter } from './primitives';
import { fmt, fmtPct } from '../lib/derive';

// "This month" card — built on the useThisMonth(region) hook so teammates can
// restyle freely. Shows the partial-month-aware current value, the same-days
// comparison against past years, the usual range and every label chip.
export function ThisMonthCard({ regionId }: { regionId: string }) {
  const m = useThisMonth(regionId);
  const pct = m.percentile;
  const win = m.window;
  const pctDiff = win?.pctDiff ?? null;

  return (
    <section className="card p-4" aria-live="polite">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="section-label">This month vs usual</h2>
        <span className="rounded-full border border-line/80 px-2 py-0.5 text-[10px] text-ink-dim">
          {win ? `same ${win.days} day${win.days === 1 ? '' : 's'}` : 'partial-month aware'}
        </span>
      </header>
      {m.loading && <p className="text-xs text-ink-dim">Loading…</p>}
      {m.error && <p className="text-xs text-red-300">{m.error}</p>}
      {!m.loading && !m.error && m.value !== null && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="stat-value text-2xl text-ink">{m.value}</span>
            <span className="text-[11px] text-ink-dim">harm tile-days</span>
            {win?.band && (
              <span
                className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] ${
                  win.band === 'much above' || win.band === 'above'
                    ? 'border-accent/45 bg-accent/10 text-accent'
                    : win.band === 'much below' || win.band === 'below'
                      ? 'border-sky-400/40 bg-sky-400/10 text-sky-300'
                      : 'border-line bg-surface/50 text-ink-dim'
                }`}
              >
                {win.band}
              </span>
            )}
          </div>
          <p className="text-[11px] text-ink-dim">{m.label}</p>

          {win && win.median !== null && (
            <div className="rounded-lg border border-line/70 bg-surface/40 px-2.5 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-1">
                <span className="text-[10.5px] text-ink-dim">
                  Same days in {win.priorYears.length} past year{win.priorYears.length === 1 ? '' : 's'} (median)
                </span>
                <span className="font-mono text-[11px] text-ink-dim">{fmt(win.median, 1)}</span>
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span
                  className={`font-mono text-[15px] ${
                    (pctDiff ?? 0) > 0 ? 'text-accent' : (pctDiff ?? 0) < 0 ? 'text-sky-300' : 'text-ink'
                  }`}
                >
                  {fmtPct(pctDiff, 1)}
                </span>
                <span className="text-[10px] leading-snug text-ink-dim">
                  {win.rank === null
                    ? 'no rank'
                    : win.rank >= 50
                      ? `higher than ${Math.round(win.rank)}% of those years`
                      : `lower than ${Math.round(100 - win.rank)}% of those years`}
                </span>
              </div>
              {win.p25 !== null && win.p75 !== null && (
                <p className="mt-1 text-[10px] leading-snug text-ink-dim">
                  Middle half of those years: {fmt(win.p25, 1)}–{fmt(win.p75, 1)} tile-days.
                </p>
              )}
            </div>
          )}

          {pct !== null && (!win || win.priorYears.length < 2) && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-ink-dim">
                  Climatology rank <LabelChip label="climatology rank" />
                </span>
                <span className="font-mono text-ink">p{Math.round(pct)}</span>
              </div>
              <Meter value={pct} tone={pct >= 90 ? 'ember' : 'teal'} />
            </div>
          )}

          {m.clim?.p50 != null && !win && (
            <p className="text-[10px] leading-snug text-ink-dim">
              Full-month baseline p50 {m.clim.p50} · p10–p90 {m.clim.p10 ?? '—'}–{m.clim.p90 ?? '—'}
            </p>
          )}

          <p className="text-[9.5px] leading-snug text-ink-dim">
            The newest days come from near-real-time data and are Provisional. A partial month is
            never compared with a whole past month.
          </p>
        </div>
      )}
      {!m.loading && !m.error && m.value === null && (
        <p className="text-xs text-ink-dim">
          No daily data for this region yet — a gap, not zero.
        </p>
      )}
    </section>
  );
}
