import { useMemo, useRef, useState } from 'react';
import { LabelChip } from './LabelChip';
import { ERAS, type Era, type TrustLabel } from '../types';
import { eraOfYm } from '../lib/derive';
import {
  busiestMonths,
  calendarGrid,
  fmt,
  monthShort,
  yearlyTotals,
  type MonthAgg,
} from '../lib/derive';
import { viridis } from '../theme';

type CalView = 'harm' | 'hotspots';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function cellTitle(view: CalView, agg: MonthAgg, trust: TrustLabel | null): string {
  const head = `${agg.year}-${String(agg.month).padStart(2, '0')}`;
  const main =
    view === 'harm'
      ? `harmonized ${fmt(agg.harm, 1)} tile-days${agg.harm !== null ? ` (range ${fmt(agg.lo, 1)}–${fmt(agg.hi, 1)})` : ''}`
      : `raw hotspot count ${fmt(agg.hotspots)}`;
  return `${head} · ${main}${trust ? ` · ${trust}` : ''}${agg.tiles ? ` · ${fmt(agg.tiles)} tiles` : ''}`;
}

/**
 * Burning Activity Calendar — year × month, harmonized tile-days with a plain
 * raw-hotspot-count view beside it. Colour is never the only clue: cells from
 * estimated or provisional eras carry a dot pattern, and the whole grid has a
 * text-table alternative.
 */
export function BurnCalendar({
  months,
  selectedYm,
  onPick,
  regionLabel,
  eras = ERAS,
  loading = false,
  error = null,
  onRetry,
}: {
  months: MonthAgg[];
  selectedYm?: number;
  onPick?: (ym: number) => void;
  regionLabel?: string | null;
  eras?: Era[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const [view, setView] = useState<CalView>('harm');
  const gridRef = useRef<HTMLDivElement>(null);
  const grid = useMemo(() => calendarGrid(months), [months]);
  const totals = useMemo(() => yearlyTotals(months), [months]);
  const busiest = useMemo(() => busiestMonths(months, 5), [months]);
  const max = view === 'harm' ? grid.maxHarm : grid.maxHotspots;

  const valueOf = (a: MonthAgg) => (view === 'harm' ? a.harm : a.hotspots);
  const unit = view === 'harm' ? 'tile-days' : 'hotspots';

  // Arrow-key navigation across the calendar grid.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[e.key];
    if (!move || !gridRef.current) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active || !active.dataset.year) return;
    const y = Number(active.dataset.year) + move[0];
    const m = Number(active.dataset.month) + move[1];
    const target = gridRef.current.querySelector<HTMLElement>(
      `[data-year="${y}"][data-month="${m}"]`
    );
    if (target) {
      e.preventDefault();
      target.focus();
    }
  };

  return (
    <section className="card p-4" aria-labelledby="calendar-title">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="calendar-title" className="card-title">
            Burning activity calendar
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
            Year × month for {regionLabel ?? 'the selected region'}; the years follow the selected
            period. Colour shows how much; a dot pattern marks boxes whose era is not fully measured,
            so colour is never the only clue.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="radiogroup" aria-label="Calendar view">
            <button
              role="radio"
              aria-checked={view === 'harm'}
              onClick={() => setView('harm')}
              className="seg-item"
            >
              Harmonized activity
            </button>
            <button
              role="radio"
              aria-checked={view === 'hotspots'}
              onClick={() => setView('hotspots')}
              className="seg-item"
            >
              Hotspot count
            </button>
          </div>
        </div>
      </header>

      {loading && <p className="py-10 text-center text-xs text-ink-dim">Loading calendar…</p>}
      {error && !loading && (
        <p className="flex flex-wrap items-center gap-2 py-6 text-xs text-red-300">
          <span>{error}</span>
          {onRetry && (
            <button onClick={onRetry} className="btn btn-ghost btn-sm">
              Retry
            </button>
          )}
        </p>
      )}
      {!loading && !error && months.length === 0 && (
        <p className="py-10 text-center text-xs text-ink-dim">
          No months loaded for this region and period. Gaps are missing observations, not zeros —
          widen the period or pick another preset.
        </p>
      )}

      {!loading && !error && months.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_200px]">
          <div className="min-w-0">
            <div className="overflow-x-auto">
              <div className="min-w-[520px]">
                <div
                  className="grid items-center gap-1"
                  style={{ gridTemplateColumns: '44px repeat(12, minmax(0,1fr)) 58px' }}
                >
                  <span />
                  {MONTHS.map((m) => (
                    <span key={m} className="text-center font-mono text-[9.5px] text-ink-dim">
                      {monthShort(m)}
                    </span>
                  ))}
                  <span className="text-right font-mono text-[9px] text-ink-dim">year</span>
                </div>

                <div ref={gridRef} onKeyDown={onKeyDown} className="mt-1 space-y-1">
                  {grid.years.map((year) => {
                    const row = grid.cells.get(year) ?? [];
                    const total = totals.find((t) => t.year === year);
                    return (
                      <div
                        key={year}
                        className="grid items-center gap-1"
                        style={{ gridTemplateColumns: '44px repeat(12, minmax(0,1fr)) 58px' }}
                      >
                        <span className="font-mono text-[10.5px] text-ink-dim">{year}</span>
                        {row.map((cell, i) => {
                          const agg = cell.agg;
                          const era = agg ? eraOfYm(cell.ym, eras) : null;
                          const trust = era?.trust ?? null;
                          const value = agg ? valueOf(agg) : null;
                          const t = value !== null && max > 0 ? Math.pow(value / max, 0.72) : 0;
                          const selected = agg !== null && selectedYm === cell.ym;
                          const dotted = trust === 'Estimated' || trust === 'Indicative' || trust === 'Provisional';
                          return (
                            <button
                              key={i}
                              type="button"
                              data-year={year}
                              data-month={i + 1}
                              disabled={!agg}
                              onClick={() => agg && onPick?.(cell.ym)}
                              title={agg ? cellTitle(view, agg, trust) : `${year}-${String(i + 1).padStart(2, '0')} · no observation`}
                              aria-label={
                                agg
                                  ? `${year} ${monthShort(i + 1)}: ${fmt(value, view === 'harm' ? 1 : 0)} ${unit}${trust ? `, ${trust}` : ''}`
                                  : `${year} ${monthShort(i + 1)}: no observation`
                              }
                              aria-pressed={selected}
                              className={`relative h-7 overflow-hidden rounded-[5px] border text-[9.5px] transition ${
                                selected
                                  ? 'border-accent-2 ring-1 ring-accent-2/60'
                                  : 'border-line/60 hover:border-accent-2/50'
                              } ${agg ? '' : 'cursor-default'}`}
                              style={{
                                background:
                                  agg && value !== null && value > 0
                                    ? viridis(t)
                                    : 'var(--color-surface-3)',
                              }}
                            >
                              {dotted && (
                                <span
                                  aria-hidden="true"
                                  className="pointer-events-none absolute inset-0 opacity-50"
                                  style={{
                                    backgroundImage:
                                      'radial-gradient(rgba(4,8,16,0.85) 0.9px, transparent 1px)',
                                    backgroundSize: '5px 5px',
                                  }}
                                />
                              )}
                              {agg && value !== null && value > 0 && (
                                <span
                                  className="relative font-mono"
                                  style={{ color: t > 0.55 ? '#0b1020' : '#e8eefb' }}
                                >
                                  {view === 'harm' ? Math.round(value) : Math.round(value)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                        <span className="text-right font-mono text-[9.5px] text-ink-dim">
                          {fmt(view === 'harm' ? total?.harm ?? null : total?.hotspots ?? null)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-ink-dim">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-14 rounded-sm"
                  style={{
                    background: `linear-gradient(90deg, ${viridis(0)}, ${viridis(0.35)}, ${viridis(
                      0.7
                    )}, ${viridis(1)})`,
                  }}
                />
                0 → {fmt(max)} {unit}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-4 rounded-sm"
                  style={{
                    background: viridis(0.55),
                    backgroundImage:
                      'radial-gradient(rgba(4,8,16,0.85) 0.9px, transparent 1px)',
                    backgroundSize: '5px 5px',
                  }}
                />
                dotted = estimated / provisional era
              </span>
              <span className="ml-auto font-mono">
                {view === 'harm' ? 'tile-days' : 'raw hotspot count'}
              </span>
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-dim">
              {view === 'harm'
                ? 'Harmonized burning tile-days at VIIRS scale — relative activity, not fire counts, fire size or burned area.'
                : 'Plain raw hotspot count, shown for comparison. A hotspot is a thermal detection, not a confirmed fire; the count is not comparable across sensors.'}{' '}
              Click a box to load that month on the map.
            </p>
          </div>

          <aside className="rounded-xl border border-line/70 bg-surface/40 p-3">
            <h3 className="section-label">Busiest months</h3>
            {busiest.length === 0 ? (
              <p className="mt-2 text-[11px] text-ink-dim">No months with activity.</p>
            ) : (
              <ol className="mt-2 space-y-1.5">
                {busiest.map((m) => (
                  <li key={m.ym} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <button
                      onClick={() => onPick?.(m.ym)}
                      className="font-mono text-ink-dim transition hover:text-ink"
                    >
                      {m.year}-{String(m.month).padStart(2, '0')}
                    </button>
                    <span className="font-mono text-ink">{fmt(m.harm, 0)}</span>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-3 border-t border-line/60 pt-2">
              <h3 className="section-label">Era of the shaded boxes</h3>
              <ul className="mt-2 space-y-1.5">
                {[...new Set(months.map((m) => eraOfYm(m.ym, eras).id))].map((id) => {
                  const e = eras.find((x) => x.id === id);
                  if (!e) return null;
                  return (
                    <li key={id} className="flex items-center gap-2">
                      <LabelChip label={e.trust} />
                      <span className="text-[10px] text-ink-dim">{e.name}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>
        </div>
      )}

      {!loading && !error && months.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-ink-dim transition hover:text-ink">
            Calendar as a table (text alternative)
          </summary>
          <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line/70">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-surface-2">
                <tr className="text-left text-ink-dim">
                  <th className="px-2 py-1">Month</th>
                  <th className="px-2 py-1 text-right">Harmonized tile-days</th>
                  <th className="px-2 py-1 text-right">lo–hi</th>
                  <th className="px-2 py-1 text-right">Hotspot count</th>
                  <th className="px-2 py-1">Era trust</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.ym} className="border-t border-line/60">
                    <td className="px-2 py-1 font-mono">{m.year}-{String(m.month).padStart(2, '0')}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(m.harm, 1)}</td>
                    <td className="px-2 py-1 text-right font-mono text-ink-dim">
                      {fmt(m.lo, 1)}–{fmt(m.hi, 1)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(m.hotspots)}</td>
                    <td className="px-2 py-1">
                      <LabelChip label={eraOfYm(m.ym, eras).trust} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
