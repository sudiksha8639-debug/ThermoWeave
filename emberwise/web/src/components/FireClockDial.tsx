import { useMemo } from 'react';
import type { JsonFile } from '../types';
import { INK_DIM } from '../theme';

// SLOT: teammate-owned Fire Clock Dial. This baseline renders the hourly
// distribution as a 24-hour polar diagnostic.
// Required caption (never change the meaning):
// "Satellites only look at these times. This shows when we looked, not the
// full daily fire cycle."
export const DIAL_CAPTION =
  'Satellites only look at these times. This shows when we looked, not the full daily fire cycle.';

function dialColor(t: number): string {
  const a = [94, 224, 208];
  const b = [246, 165, 68];
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

export function FireClockDialSlot({ hourly }: { hourly: JsonFile | null }) {
  const byHour = useMemo(() => {
    const out = Array<number>(24).fill(0);
    const rows = (hourly?.rows as { local_hour: number; hotspots: number }[] | undefined) ?? [];
    for (const r of rows) {
      if (
        r &&
        Number.isInteger(r.local_hour) &&
        r.local_hour >= 0 &&
        r.local_hour < 24 &&
        typeof r.hotspots === 'number'
      ) {
        out[r.local_hour] = r.hotspots;
      }
    }
    return out;
  }, [hourly]);

  const total = byHour.reduce((s, v) => s + v, 0);
  const max = Math.max(1, ...byHour);
  const peak = byHour.indexOf(max);
  const cx = 128;
  const cy = 124;
  const R = 92;

  if (total === 0) {
    return (
      <figure className="card p-4">
        <figcaption className="mb-1 text-xs text-ink-dim">Fire Clock Dial</figcaption>
        <p className="py-8 text-center text-xs text-ink-dim">No hourly distribution loaded.</p>
      </figure>
    );
  }

  return (
    <figure className="card p-4">
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="card-title text-[13px]">Fire Clock Dial</span>
        <span className="text-[10px] text-ink-dim">peak {String(peak).padStart(2, '0')}:00</span>
      </figcaption>
      <svg
        viewBox="0 0 256 244"
        className="mx-auto w-full max-w-[300px]"
        role="img"
        aria-label="24-hour observing-time dial"
      >
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="#24304a" strokeWidth={1} />
        <circle cx={cx} cy={cy} r={R - 50} fill="none" stroke="#1b2438" strokeWidth={1} />
        {Array.from({ length: 24 }, (_, h) => {
          const a = (((h - 6 + 24) % 24) / 24) * Math.PI * 2 - Math.PI / 2;
          const v = byHour[h];
          const r0 = R - 6;
          const r1 = r0 - (v / max) * 46;
          const x0 = cx + Math.cos(a) * r0;
          const y0 = cy + Math.sin(a) * r0;
          const x1 = cx + Math.cos(a) * r1;
          const y1 = cy + Math.sin(a) * r1;
          const major = h % 3 === 0;
          return (
            <g key={h}>
              <line
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke={dialColor(v / max)}
                strokeWidth={major ? 5 : 3.5}
                strokeLinecap="round"
                opacity={0.45 + 0.55 * (v / max)}
              />
              {major && (
                <text
                  x={cx + Math.cos(a) * (R + 12)}
                  y={cy + Math.sin(a) * (R + 12) + 3}
                  fontSize={8.5}
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
        <text x={cx} y={cy - 4} fontSize={9.5} fill={INK_DIM} textAnchor="middle">
          local solar hour
        </text>
        <text x={cx} y={cy + 10} fontSize={9} fill={INK_DIM} textAnchor="middle">
          {total.toLocaleString()} observations
        </text>
        <text x={cx} y={cy + 24} fontSize={8.5} fill={INK_DIM} textAnchor="middle" opacity={0.7}>
          peak {max.toLocaleString()}
        </text>
      </svg>
      <p className="mt-1 text-center text-[10.5px] leading-snug text-ink-dim">{DIAL_CAPTION}</p>
    </figure>
  );
}
