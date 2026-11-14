import { useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { RegionDailyRow } from '../types';
import { INK, INK_DIM, LINE, ACCENT_2 } from '../theme';

// SLOT: teammate-owned series chart. This is a working baseline —
// replace the internals, keep the props signature.
export function SeriesChartSlot({
  rows,
  height = 220,
  title = 'Daily harmonized burning tile-days',
  bare = false,
}: {
  rows: RegionDailyRow[];
  height?: number;
  title?: string;
  bare?: boolean;
}) {
  const W = 720;
  const M = { top: 16, right: 14, bottom: 26, left: 42 };
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const chart = useMemo(() => {
    const data = rows
      .filter((r) => r.harm !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (data.length === 0) return null;
    const dates = data.map((d) => new Date(d.date));
    const x = d3
      .scaleTime()
      .domain(d3.extent(dates) as [Date, Date])
      .range([M.left, W - M.right]);
    const maxY = d3.max(data, (d) => d.hi ?? d.harm ?? 0) ?? 1;
    const y = d3
      .scaleLinear()
      .domain([0, maxY * 1.05])
      .nice()
      .range([height - M.bottom, M.top]);
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
    return {
      data,
      dates,
      x,
      y,
      path: line(data) ?? '',
      band: area(data) ?? '',
      ticksX: x.ticks(5),
      ticksY: y.ticks(4),
    };
  }, [rows, height]);

  if (!chart) {
    return (
      <div
        className={`flex h-40 items-center justify-center px-4 text-center text-sm text-ink-dim ${
          bare ? '' : 'card'
        }`}
      >
        No daily data for this region and period.
      </div>
    );
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = chart.x.invert(px).getTime();
    let best = 0;
    let bestD = Infinity;
    chart.dates.forEach((d, i) => {
      const dd = Math.abs(d.getTime() - t);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    setHover(best);
  };

  const h = hover !== null ? chart.data[hover] : null;
  const hx = h ? chart.x(new Date(h.date)) : 0;
  const hy = h ? chart.y(h.harm ?? 0) : 0;
  const tipW = 150;
  const tipX = hx > W - tipW - 12 ? hx - tipW - 8 : hx + 8;

  return (
    <figure className={bare ? '' : 'card p-3'}>
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
        <span className="text-xs text-ink-dim">{title}</span>
        <span className="text-[10px] text-ink-dim">band = lo–hi · hover for detail</span>
      </figcaption>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        className="w-full touch-none"
        role="img"
        aria-label={title}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {chart.ticksY.map((t) => (
          <g key={`y${t}`}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={chart.y(t)}
              y2={chart.y(t)}
              stroke={LINE}
              strokeWidth={0.6}
              strokeDasharray={t === 0 ? undefined : '2 4'}
              opacity={0.8}
            />
            <text x={M.left - 8} y={chart.y(t) + 3} fontSize={9.5} fill={INK_DIM} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {chart.ticksX.map((t) => (
          <g key={`x${t.toISOString()}`}>
            <line
              x1={chart.x(t)}
              x2={chart.x(t)}
              y1={M.top}
              y2={height - M.bottom}
              stroke={LINE}
              strokeWidth={0.5}
              opacity={0.45}
            />
            <text
              x={chart.x(t)}
              y={height - 8}
              fontSize={9.5}
              fill={INK_DIM}
              textAnchor="middle"
            >
              {d3.timeFormat('%Y-%m')(t)}
            </text>
          </g>
        ))}
        <path d={chart.band} fill={ACCENT_2} opacity={0.14} />
        <path d={chart.path} fill="none" stroke={ACCENT_2} strokeWidth={1.7} strokeLinejoin="round" />
        <text x={M.left} y={M.top - 4} fontSize={9} fill={INK_DIM}>
          tile-days
        </text>
        {hover !== null && h && (
          <g pointerEvents="none">
            <line
              x1={hx}
              x2={hx}
              y1={M.top}
              y2={height - M.bottom}
              stroke={ACCENT_2}
              strokeWidth={0.8}
              strokeDasharray="3 3"
              opacity={0.7}
            />
            <circle cx={hx} cy={hy} r={3.2} fill={ACCENT_2} stroke="#07101c" strokeWidth={1.5} />
            <g transform={`translate(${tipX},${Math.max(M.top, hy - 34)})`}>
              <rect width={tipW} height={44} rx={6} fill="#0b1322" stroke={LINE} opacity={0.97} />
              <text x={8} y={15} fontSize={9.5} fill={INK_DIM}>
                {h.date}
              </text>
              <text x={8} y={29} fontSize={10.5} fill={INK}>
                harm {h.harm ?? '—'} tile-days
              </text>
              <text x={8} y={40} fontSize={9} fill={INK_DIM}>
                lo–hi {h.lo ?? '—'}–{h.hi ?? '—'}
              </text>
            </g>
          </g>
        )}
      </svg>
    </figure>
  );
}
