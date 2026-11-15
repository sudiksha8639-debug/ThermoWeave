import { useMemo } from 'react';
import {
  SENSOR_MODES,
  tmNum,
  ymToLabel,
  type TileGeometry,
  type TmCol,
  type TrustLabel,
} from '../types';
import { LabelChip } from './LabelChip';
import { SaturationFlag } from './SaturationFlag';
import { Meter } from './primitives';
import { trustScore } from '../lib/derive';
import type { InspectTarget } from '../state';

interface Props {
  target: InspectTarget | null;
  rowsForYm: Map<number, import('../types').TmCell[]>;
  columns: string[];
  geometry: TileGeometry[];
  valueCol: TmCol;
  /** Trust label for the region/month context (e.g. era trust). */
  regionTrust?: TrustLabel | null;
}

export function InspectPanel({ target, rowsForYm, columns, geometry, valueCol, regionTrust }: Props) {
  const detail = useMemo(() => {
    if (!target?.tile && target?.ym === undefined) return null;
    const g = target.tile !== undefined ? geometry[target.tile] : undefined;
    const row = target.tile !== undefined ? rowsForYm.get(target.tile) : undefined;
    if (!g && !row) return null;
    return { g, row };
  }, [target, rowsForYm, geometry]);

  if (!detail) {
    return (
      <aside className="card p-4 text-sm">
        <h2 className="section-label mb-2">Inspect</h2>
        <div className="flex items-start gap-2.5 text-ink-dim">
          <span aria-hidden="true" className="mt-0.5 text-accent-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <p className="text-[11.5px] leading-relaxed">
            Click a tile on the map to inspect it, or drag a rectangle to filter. Use the tile
            list below the map for keyboard navigation.
          </p>
        </div>
      </aside>
    );
  }

  const { g, row } = detail;
  const ym = row ? (row[columns.indexOf('ym')] as number) : target?.ym;
  const trust = row ? (row[columns.indexOf('trust')] as string | undefined) : undefined;
  const lo = row ? tmNum(row, columns, 'lo') : null;
  const hi = row ? tmNum(row, columns, 'hi') : null;
  const frac = row ? tmNum(row, columns, 'frac_burning') : null;
  const harm = row ? tmNum(row, columns, 'harm') : null;
  const scoreLabel =
    typeof trust === 'string' && trust.toLowerCase().includes('relay')
      ? 'Provisional'
      : (regionTrust ?? null);
  const score = trustScore(valueCol === 'harm' ? harm : tmNum(row ?? [], columns, valueCol), lo, hi, scoreLabel);
  void valueCol;

  return (
    <aside className="card p-4 text-sm" aria-live="polite">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="section-label">Inspect</h2>
        {target?.tile !== undefined && (
          <span className="rounded border border-line/80 bg-surface/50 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
            tile {target.tile}
          </span>
        )}
      </header>
      {ym !== undefined && <p className="text-sm text-ink">{ymToLabel(ym)}</p>}
      {g && (
        <p className="mb-2 mt-0.5 font-mono text-[10.5px] text-ink-dim">
          {g.cy.toFixed(4)}°N, {g.cx.toFixed(4)}°E · res {g.res}
        </p>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-dim">
        {regionTrust && (
          <span className="inline-flex items-center gap-1.5">
            Region trust <LabelChip label={regionTrust} />
          </span>
        )}
        {trust && (
          <span className="inline-flex items-center gap-1.5">
            Tile trust <LabelChip label={trust} />
          </span>
        )}
      </div>
      {!row && (
        <p className="text-[11.5px] text-ink-dim">
          No observation for this tile-month — a data gap, not zero.
        </p>
      )}
      {row && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink-dim">
              <th className="pb-1 font-medium">Sensor mode</th>
              <th className="pb-1 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {SENSOR_MODES.map((s) => {
              const active = s.column === valueCol;
              return (
                <tr
                  key={s.id}
                  className={active ? 'bg-accent-2/[0.07] text-ink' : 'text-ink-dim'}
                >
                  <td className={`py-1 ${active ? 'pl-1.5 font-semibold' : ''}`}>{s.label}</td>
                  <td className="py-1 pr-1.5 text-right font-mono">
                    {tmNum(row, columns, s.column) ?? '—'}
                    <span className="ml-1 text-[9px] uppercase text-ink-dim">tile-days</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {row && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/60 pt-2 text-xs text-ink-dim">
          {lo !== null && hi !== null && (
            <span className="font-mono text-[10.5px]">
              lo–hi {lo}–{hi}
            </span>
          )}
          <SaturationFlag fracBuring={frac} />
        </div>
      )}
      {row && score && (
        <div className="mt-2 border-t border-line/60 pt-2" title={score.note}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[10.5px] text-ink-dim">
            <span>Trust score</span>
            <span className="font-mono text-ink">
              {score.score}/100
              <span className="ml-1 text-[9px] text-ink-dim">era ×{score.eraFactor}</span>
            </span>
          </div>
          <Meter value={score.score} tone={score.score >= 66 ? 'teal' : score.score >= 33 ? 'ember' : 'blue'} />
          <p className="mt-1 text-[9.5px] leading-snug text-ink-dim">
            Band width {score.bandWidthPct.toFixed(0)}% of the value · score per tile-month, not a
            probability.
          </p>
        </div>
      )}
    </aside>
  );
}
