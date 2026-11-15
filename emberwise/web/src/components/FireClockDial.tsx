import { useMemo, useState } from 'react';
import type { JsonFile } from '../types';
import { ACCENT, ACCENT_2, INK, INK_DIM, LINE } from '../theme';

// Fire Clock Dial — a transparency diagnostic. It shows when each satellite
// looked, never a corrected fire cycle.
// Required caption (never change the meaning):
// "Satellites only look at these times. This shows when we looked, not the
// full daily fire cycle."
export const DIAL_CAPTION =
  'Satellites only look at these times. This shows when we looked, not the full daily fire cycle.';

interface HourRow {
  local_hour: number;
  hotspots: number;
  satellite?: string;
  year?: number;
}

function readRows(hourly: JsonFile | null): HourRow[] {
  const raw = hourly?.rows;
  if (!Array.isArray(raw)) return [];
  const out: HourRow[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    const hour = typeof o.local_hour === 'number' ? o.local_hour : null;
    const hotspots =
      typeof o.hotspots === 'number'
        ? o.hotspots
        : typeof o.n_hotspots === 'number'
          ? o.n_hotspots
          : null;
    if (hour === null || hotspots === null) continue;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    out.push({
      local_hour: hour,
      hotspots,
      satellite: typeof o.satellite === 'string' ? o.satellite : undefined,
      year: typeof o.year === 'number' ? o.year : undefined,
    });
  }
  return out;
}

// Nominal local overpass times. Reference geometry, not measured values.
const WINDOWS: { label: string; hour: number; color: string }[] = [
  { label: 'Terra', hour: 10.5, color: '#7fb2ea' },
  { label: 'Aqua', hour: 13.5, color: '#c9a3ff' },
  { label: 'Suomi NPP', hour: 13.5, color: ACCENT_2 },
  { label: 'NOAA-20', hour: 13.5, color: ACCENT },
];

function dialColor(t: number): string {
  const a = [94, 224, 208];
  const b = [246, 165, 68];
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

const angleOf = (hour: number) => (((hour - 6 + 24) % 24) / 24) * Math.PI * 2 - Math.PI / 2;

export function FireClockDialSlot({ hourly }: { hourly: JsonFile | null }) {
  const allRows = useMemo(() => readRows(hourly), [hourly]);

  const satellites = useMemo(
    () => [...new Set(allRows.map((r) => r.satellite).filter((s): s is string => !!s))],
    [allRows]
  );
  const years = useMemo(
    () =>
      [...new Set(allRows.map((r) => r.year).filter((y): y is number => typeof y === 'number'))].sort(
        (a, b) => a - b
      ),
    [allRows]
  );
  const [year, setYear] = useState<number | 'all'>('all');
  const [showWindows, setShowWindows] = useState(true);

  const rows = useMemo(
    () => (year === 'all' ? allRows : allRows.filter((r) => r.year === year)),
    [allRows, year]
  );

  const bySat = useMemo(() => {
    const map = new Map<string, number[]>();
    const keyed = satellites.length > 0 ? satellites : ['All detections'];
    for (const s of keyed) map.set(s, Array<number>(24).fill(0));
    for (const r of rows) {
      const key = r.satellite ?? 'All detections';
      const arr = map.get(key) ?? map.get(keyed[0]);
      if (arr) arr[r.local_hour] += r.hotspots;
    }
    return map;
  }, [rows, satellites]);

  const total = rows.reduce((s, r) => s + r.hotspots, 0);
  const peak = useMemo(() => {
    let best = 0;
    let bestV = -1;
    for (const [name, arr] of bySat) {
      void name;
      const max = Math.max(...arr);
      if (max > bestV) {
        bestV = max;
        best = arr.indexOf(max);
      }
    }
    return { hour: best, value: Math.max(0, bestV) };
  }, [bySat]);

  const cx = 132;
  const cy = 128;
  const R = 96;

  if (total === 0) {
    return (
      <figure className="card p-4">
        <figcaption className="mb-1 text-xs text-ink-dim">Fire Clock Dial</figcaption>
        <p className="py-8 text-center text-xs text-ink-dim">
          No hourly distribution loaded, so observation times cannot be shown. The dial needs
          hourly.json with local_hour and hotspot counts.
        </p>
        <p className="text-center text-[10.5px] leading-snug text-ink-dim">{DIAL_CAPTION}</p>
      </figure>
    );
  }

  const rings = [...bySat.entries()];
  const maxAll = Math.max(1, ...rings.flatMap(([, arr]) => arr));

  return (
    <figure className="card p-4">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="card-title text-[13px]">Fire Clock Dial</span>
        <span className="font-mono text-[10px] text-ink-dim">
          peak {String(peak.hour).padStart(2, '0')}:00 local solar
        </span>
      </figcaption>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setShowWindows((s) => !s)}
          aria-pressed={showWindows}
          className={`btn btn-sm ${showWindows ? 'btn-ghost text-accent-2' : 'btn-ghost'}`}
        >
          Nominal windows
        </button>
        {years.length > 1 ? (
          <label className="flex items-center gap-1.5 text-[10.5px] text-ink-dim">
            <span>Year</span>
            <select
              value={String(year)}
              onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="control w-auto py-1 text-[11px]"
            >
              <option value="all">all</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span
            className="text-[10px] text-ink-dim"
            title="Year exploration needs hourly rows carrying satellite and year (M1 output)."
          >
            Year exploration needs satellite × year rows
          </span>
        )}
      </div>

      <svg
        viewBox="0 0 264 252"
        className="mx-auto w-full max-w-[320px]"
        role="img"
        aria-label="24-hour observing-time dial with nominal satellite overpass windows"
      >
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={LINE} strokeWidth={1} />
        <circle cx={cx} cy={cy} r={R - 52} fill="none" stroke={LINE} strokeWidth={0.8} opacity={0.6} />

        {showWindows &&
          WINDOWS.map((w, i) => {
            const a0 = angleOf(w.hour - 0.5) ;
            const a1 = angleOf(w.hour + 0.5);
            const p0 = [cx + Math.cos(a0) * (R + 4), cy + Math.sin(a0) * (R + 4)];
            const p1 = [cx + Math.cos(a1) * (R + 4), cy + Math.sin(a1) * (R + 4)];
            const large = 0;
            return (
              <g key={`${w.label}-${i}`}>
                <path
                  d={`M${p0[0]},${p0[1]} A${R + 4},${R + 4} 0 ${large} 1 ${p1[0]},${p1[1]}`}
                  fill="none"
                  stroke={w.color}
                  strokeWidth={3}
                  opacity={0.55}
                  strokeLinecap="round"
                >
                  <title>{`${w.label} nominal overpass ≈ ${String(Math.floor(w.hour)).padStart(2, '0')}:${String(
                    Math.round((w.hour % 1) * 60)
                  ).padStart(2, '0')} local solar`}</title>
                </path>
                <text
                  x={cx + Math.cos(angleOf(w.hour)) * (R + 16)}
                  y={cy + Math.sin(angleOf(w.hour)) * (R + 16) + 2.5}
                  fontSize={7.5}
                  fill={w.color}
                  textAnchor="middle"
                  opacity={0.85}
                >
                  {w.label}
                </text>
              </g>
            );
          })}

        {rings.map(([name, arr], ring) => {
          const r0 = R - 6 - ring * 13;
          return (
            <g key={name}>
              {arr.map((v, h) => {
                const a = angleOf(h);
                const len = (v / maxAll) * 44;
                const x0 = cx + Math.cos(a) * r0;
                const y0 = cy + Math.sin(a) * r0;
                const x1 = cx + Math.cos(a) * (r0 - len);
                const y1 = cy + Math.sin(a) * (r0 - len);
                const major = h % 3 === 0;
                return (
                  <g key={h}>
                    <line
                      x1={x0}
                      y1={y0}
                      x2={x1}
                      y2={y1}
                      stroke={dialColor(v / maxAll)}
                      strokeWidth={major ? 4.5 : 3.2}
                      strokeLinecap="round"
                      opacity={0.35 + 0.65 * (v / maxAll)}
                    >
                      <title>{`${name} · ${String(h).padStart(2, '0')}:00 — ${v.toLocaleString()} detections`}</title>
                    </line>
                    {major && (
                      <text
                        x={cx + Math.cos(a) * (R + 12)}
                        y={cy + Math.sin(a) * (R + 12) + 3}
                        fontSize={8}
                        fill={INK_DIM}
                        textAnchor="middle"
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      >
                        {String(h).padStart(2, '0')}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        <line
          x1={cx}
          y1={cy}
          x2={cx + Math.cos(angleOf(peak.hour)) * (R - 64)}
          y2={cy + Math.sin(angleOf(peak.hour)) * (R - 64)}
          stroke={ACCENT}
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.7}
        />
        <text x={cx} y={cy - 6} fontSize={9} fill={INK_DIM} textAnchor="middle">
          local solar hour
        </text>
        <text x={cx} y={cy + 8} fontSize={8.5} fill={INK} textAnchor="middle">
          {peak.value.toLocaleString()} peak detections
        </text>
        <text x={cx} y={cy + 20} fontSize={8} fill={INK_DIM} textAnchor="middle">
          {total.toLocaleString()} observations
        </text>
      </svg>

      {rings.length > 1 && (
        <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[9.5px] text-ink-dim">
          {rings.map(([name], i) => (
            <span key={name} className="inline-flex items-center gap-1.5">
              <span
                className="h-1.5 w-3 rounded-full"
                style={{ background: i === 0 ? ACCENT_2 : dialColor(i / rings.length) }}
              />
              {name}
            </span>
          ))}
        </div>
      )}

      <p className="mt-2 text-center text-[10.5px] leading-snug text-ink-dim">{DIAL_CAPTION}</p>
      <p className="mt-1 text-center text-[9.5px] leading-snug text-ink-dim">
        Diagnostic only. Nothing here is clock-corrected or drift-corrected, and the dial changes no
        headline value.
      </p>
    </figure>
  );
}
