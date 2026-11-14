import { useThisMonth } from '../hooks';
import { LabelChip } from './LabelChip';
import { Meter } from './primitives';

// "This month" card — built on the useThisMonth(region) hook so teammates can
// restyle freely. Shows the partial-month-aware current value, its label and
// percentile rank vs climatology, all with label chips.
export function ThisMonthCard({ regionId }: { regionId: string }) {
  const m = useThisMonth(regionId);
  const pct = m.percentile;
  return (
    <section className="card p-4" aria-live="polite">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="section-label">This month</h2>
        <span className="rounded-full border border-line/80 px-2 py-0.5 text-[10px] text-ink-dim">
          partial-month aware
        </span>
      </header>
      {m.loading && <p className="text-xs text-ink-dim">Loading…</p>}
      {m.error && <p className="text-xs text-red-300">{m.error}</p>}
      {!m.loading && !m.error && m.value !== null && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="stat-value text-2xl text-ink">{m.value}</span>
            <span className="text-[11px] text-ink-dim">harm tile-days</span>
          </div>
          <p className="text-[11px] text-ink-dim">{m.label}</p>
          {pct !== null && (
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
          {m.clim?.p50 != null && (
            <p className="text-[10px] leading-snug text-ink-dim">
              Baseline p50 {m.clim.p50} · p10–p90 {m.clim.p10 ?? '—'}–{m.clim.p90 ?? '—'}
            </p>
          )}
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
