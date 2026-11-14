import { useMemo } from 'react';
import { SENSOR_MODES, tmNum, ymToLabel, type TileGeometry, type TmCol } from '../types';
import { LabelChip } from './LabelChip';
import type { InspectTarget } from '../state';

interface Props {
  target: InspectTarget | null;
  rowsForYm: Map<number, import('../types').TmCell[]>;
  columns: string[];
  geometry: TileGeometry[];
  valueCol: TmCol;
}

export function InspectPanel({ target, rowsForYm, columns, geometry, valueCol }: Props) {
  const detail = useMemo(() => {
    if (!target?.tile && target?.ym === undefined) return null;
    const g = target.tile !== undefined ? geometry[target.tile] : undefined;
    const row = target.tile !== undefined ? rowsForYm.get(target.tile) : undefined;
    if (!g && !row) return null;
    return { g, row };
  }, [target, rowsForYm, geometry]);

  if (!detail) {
    return (
      <aside className="rounded-lg border border-line bg-surface-2 p-4 text-sm text-ink-dim">
        Click a tile on the map to inspect it, or drag a rectangle to filter.
      </aside>
    );
  }

  const { g, row } = detail;
  const ym = row ? (row[columns.indexOf('ym')] as number) : target?.ym;
  const trust = row ? (row[columns.indexOf('trust')] as string | undefined) : undefined;
  const lo = row ? tmNum(row, columns, 'lo') : null;
  const hi = row ? tmNum(row, columns, 'hi') : null;

  return (
    <aside className="rounded-lg border border-line bg-surface-2 p-4 text-sm" aria-live="polite">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-dim">
        Inspect
      </h2>
      {ym !== undefined && <p className="mb-1 text-ink">Month: {ymToLabel(ym)}</p>}
      {g && (
        <p className="mb-2 text-xs text-ink-dim">
          Tile centre {g.cy.toFixed(4)}°N, {g.cx.toFixed(4)}°E · res {g.res}
        </p>
      )}
      {!row && (
        <p className="text-ink-dim">
          No observation for this tile-month — a data gap, not zero.
        </p>
      )}
      {row && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink-dim">
              <th className="py-0.5">Sensor mode</th>
              <th className="py-0.5 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {SENSOR_MODES.map((s) => (
              <tr key={s.id} className={s.column === valueCol ? 'font-semibold text-ink' : 'text-ink-dim'}>
                <td className="py-0.5">{s.label}</td>
                <td className="py-0.5 text-right">
                  {tmNum(row, columns, s.column) ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {row && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-dim">
          {trust && <LabelChip label={trust} />}
          {lo !== null && hi !== null && (
            <span>
              lo–hi: {lo} – {hi}
            </span>
          )}
        </div>
      )}
    </aside>
  );
}
