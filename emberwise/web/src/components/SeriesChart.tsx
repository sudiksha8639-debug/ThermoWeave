import { useMemo } from 'react';
import * as d3 from 'd3';
import type { RegionDailyRow } from '../types';
import { INK, INK_DIM, LINE, ACCENT_2, viridis } from '../theme';

// SLOT: teammate-owned series chart. This is a working baseline —
// replace the internals, keep the props signature.
export function SeriesChartSlot({
  rows,
  height = 220,
  title = 'Daily harmonized burning tile-days',
}: {
  rows: RegionDailyRow[];
  height?: number;
  title?: string;
}) {
  const W = 720;

  const { path, band, x, y, dates } = useMemo(() => {
    const data = rows
      .filter((r) => r.harm !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (data.length === 0) return { path: '', band: '', x: null, y: null, dates: [] as string[] };
    const x = d3.scaleTime().domain(d3.extent(data, (d) => new Date(d.date)) as [Date, Date]).range([0, W - 48]);
    const maxY = d3.max(data, (d) => d.hi ?? d.harm ?? 0) ?? 1;
    const y = d3.scaleLinear().domain([0, maxY * 1.05]).range([height - 24, 8]);
    const line = d3
      .line<RegionDailyRow>()
      .x((d) => x(new Date(d.date)))
      .y((d) => y(d.harm ?? 0))
      .defined((d) => d.harm !== null);
    const area = d3
      .area<RegionDailyRow>()
      .x((d) => x(new Date(d.date)))
      .y0((d) => y(d.lo ?? d.harm ?? 0))
      .y1((d) => y(d.hi ?? d.harm ?? 0))
      .defined((d) => d.harm !== null);
    return { path: line(data) ?? '', band: area(data) ?? '', x, y, dates: data.map((d) => d.date) };
  }, [rows, height]);

  if (!x || !y || dates.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-line bg-surface-2 text-sm text-ink-dim">
        No daily data for this region and period.
      </div>
    );
  }

  const ticks = x.ticks(6);
  return (
    <figure className="rounded-lg border border-line bg-surface-2 p-3">
      <figcaption className="mb-1 text-xs text-ink-dim">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t.toISOString()}>
            <line x1={x(t)} y1={8} x2={x(t)} y2={height - 24} stroke={LINE} strokeWidth={0.5} />
            <text x={x(t)} y={height - 8} fontSize={10} fill={INK_DIM} textAnchor="middle">
              {d3.timeFormat('%Y-%m')(t)}
            </text>
          </g>
        ))}
        <path d={band} fill={viridis(0.55)} opacity={0.25} />
        <path d={path} fill="none" stroke={ACCENT_2} strokeWidth={1.6} />
        <text x={4} y={16} fontSize={10} fill={INK}>harm (tile-days)</text>
        <text x={4} y={28} fontSize={10} fill={INK_DIM}>band = lo–hi</text>
      </svg>
    </figure>
  );
}
