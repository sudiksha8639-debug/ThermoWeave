import { useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Era, RegionDailyRow } from '../types';
import { ERAS } from '../types';
import { INK, INK_DIM, LINE, ACCENT_2, ACCENT } from '../theme';

// SLOT: teammate-owned series chart. This is a working baseline —
// replace the internals, keep the props signature.
export function SeriesChartSlot({
  rows,
  height = 220,
  title = 'Daily harmonized burning tile-days',
  bare = false,
  caption,
  showRaw = true,
  eras,
}: {
  rows: RegionDailyRow[];
  height?: number;
  title?: string;
  bare?: boolean;
  /** Caption under the chart. Defaults to the range wording for the ribbon. */
  caption?: string;
  showRaw?: boolean;
  /** Era bands drawn behind the series (defaults to the four configured eras). */
  eras?: Era[];
}) {
  const W = 720;
  const M = { top: 16, right: 14, bottom: 26, left: 42 };
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [raw, setRaw] = useState(showRaw);
  const eraList = eras ?? ERAS;

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
    const maxY =
      d3.max(data, (d) => Math.max(d.hi ?? d.harm ?? 0, d.raw_modis ?? 0, d.raw_viirs ?? 0)) ?? 1;
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
    const rawLine = (pick: (d: RegionDailyRow) => number | null) =>
      d3
        .line<RegionDailyRow>()
        .x((d) => x(new Date(d.date)))
        .y((d) => y(pick(d) ?? 0))
        .defined((d) => pick(d) !== null)(data) ?? '';

    // Era bands clipped to the visible domain.
    const [t0, t1] = x.domain();
    const eraBands = eraList
      .map((e) => {
        const start = d3.timeParse('%Y-%m')(e.start);
        const end = e.end ? d3.timeParse('%Y-%m')(e.end) : null;
        if (!start) return null;
        const a = start < t0 ? t0 : start;
        const b = end === null || end > t1 ? t1 : end;
        if (b < t0 || a > t1 || b <= a) return null;
        return { era: e, x0: x(a), x1: x(b) };
      })
      .filter((v): v is { era: Era; x0: number; x1: number } => v !== null);

    return {
      data,
      dates,
      x,
      y,
      path: line(data) ?? '',
      band: area(data) ?? '',
      modisPath: rawLine((d) => d.raw_modis),
      viirsPath: rawLine((d) => d.raw_viirs),
      ticksX: x.ticks(5),
      ticksY: y.ticks(4),
      eraBands,
    };
  }, [rows, height, eraList]);

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
  const tipW = 172;
  const tipH = 58;
  const tipX = hx > W - tipW - 12 ? hx - tipW - 8 : hx + 8;

  return (
    <figure className={bare ? '' : 'card p-3'}>
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
        <span className="text-xs text-ink-dim">{title}</span>
        <span className="flex items-center gap-2 text-[10px] text-ink-dim">
          <button
            onClick={() => setRaw((v) => !v)}
            aria-pressed={raw}
            className={`rounded border px-1.5 py-0.5 transition ${
              raw ? 'border-accent/45 text-accent' : 'border-line text-ink-dim hover:text-ink'
            }`}
          >
            raw sensor lines
          </button>
          <span className="hidden sm:inline">band = lo–hi</span>
        </span>
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
        {chart.eraBands.map((b, i) => (
          <g key={`${b.era.id}-${i}`}>
            <rect
              x={b.x0}
              y={M.top}
              width={Math.max(0, b.x1 - b.x0)}
              height={height - M.top - M.bottom}
              fill={i % 2 === 0 ? '#5ec8c0' : '#f0a03c'}
              opacity={0.045}
            />
            <text
              x={(b.x0 + b.x1) / 2}
              y={M.top + 9}
              fontSize={8}
              fill={INK_DIM}
              textAnchor="middle"
              opacity={0.85}
            >
              {b.era.id}
            </text>
          </g>
        ))}
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
        {raw && (
          <>
            <path d={chart.modisPath} fill="none" stroke={ACCENT} strokeWidth={0.9} opacity={0.55} />
            <path d={chart.viirsPath} fill="none" stroke="#7fb2ea" strokeWidth={0.9} opacity={0.5} />
          </>
        )}
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
            <g transform={`translate(${tipX},${Math.max(M.top, hy - 40)})`}>
              <rect width={tipW} height={tipH} rx={6} fill="#0b1322" stroke={LINE} opacity={0.97} />
              <text x={8} y={15} fontSize={9.5} fill={INK_DIM}>
                {h.date}
              </text>
              <text x={8} y={29} fontSize={10.5} fill={INK}>
                harm {h.harm ?? '—'} tile-days
              </text>
              <text x={8} y={41} fontSize={9} fill={INK_DIM}>
                lo–hi {h.lo ?? '—'}–{h.hi ?? '—'}
              </text>
              {raw && (
                <text x={8} y={52} fontSize={8.5} fill={INK_DIM}>
                  MODIS {h.raw_modis ?? '—'} · VIIRS {h.raw_viirs ?? '—'}
                </text>
              )}
            </g>
          </g>
        )}
      </svg>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1 text-[9.5px] text-ink-dim">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-4 rounded" style={{ background: ACCENT_2 }} />
          harmonized
        </span>
        {raw && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-[2px] w-4 rounded" style={{ background: ACCENT }} />
              raw MODIS
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-[2px] w-4 rounded" style={{ background: '#7fb2ea' }} />
              raw VIIRS
            </span>
          </>
        )}
        <span className="ml-auto">era bands: A B C D</span>
      </div>
      {caption && (
        <figcaption className="px-1 pt-1 text-[10px] leading-relaxed text-ink-dim">{caption}</figcaption>
      )}
    </figure>
  );
}
