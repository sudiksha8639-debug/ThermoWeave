import { useThisMonth } from '../hooks';
import { LabelChip } from './LabelChip';
import { INK_DIM } from '../theme';

// "This month" card — built on the useThisMonth(region) hook so teammates can
// restyle freely. Shows the partial-month-aware current value, its label and
// percentile rank vs climatology, all with label chips.
export function ThisMonthCard({ regionId }: { regionId: string }) {
  const m = useThisMonth(regionId);
  return (
    <section className="rounded-lg border border-line bg-surface-2 p-4 text-sm" aria-live="polite">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: INK_DIM }}>
        This month
      </h2>
      {m.loading && <p className="text-xs" style={{ color: INK_DIM }}>Loading…</p>}
      {m.error && <p className="text-xs text-red-300">{m.error}</p>}
      {!m.loading && !m.error && m.value !== null && (
        <div className="space-y-1.5">
          <p className="font-mono text-lg text-ink">
            {m.value}
            <span className="ml-2 text-[11px] font-normal text-ink-dim">harm tile-days</span>
          </p>
          <p className="text-xs" style={{ color: INK_DIM }}>{m.label}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {m.percentile !== null && (
              <span className="inline-flex items-center gap-1.5">
                Percentile <LabelChip label="climatology rank" />{' '}
                <span className="font-mono">p{Math.round(m.percentile)}</span>
              </span>
            )}
            {m.clim?.p50 != null && (
              <span className="text-ink-dim">
                clim p50 {m.clim.p50} · p10–p90 {m.clim.p10}–{m.clim.p90}
              </span>
            )}
          </div>
        </div>
      )}
      {!m.loading && !m.error && m.value === null && (
        <p className="text-xs" style={{ color: INK_DIM }}>
          No daily data for this region yet — a gap, not zero.
        </p>
      )}
    </section>
  );
}
