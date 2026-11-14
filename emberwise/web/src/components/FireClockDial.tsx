import { useMemo } from 'react';
import type { JsonFile } from '../types';
import { INK_DIM, ACCENT } from '../theme';

// SLOT: teammate-owned Fire Clock Dial. This baseline renders the hourly
// distribution as a 24-hour polar diagnostic.
// Required caption (never change the meaning):
// "Satellites only look at these times. This shows when we looked, not the
// full daily fire cycle."
export const DIAL_CAPTION =
  'Satellites only look at these times. This shows when we looked, not the full daily fire cycle.';

export function FireClockDialSlot({ hourly }: { hourly: JsonFile | null }) {
  const rows = useMemo(() => {
    const r = hourly?.rows as { local_hour: number; hotspots: number }[] | undefined;
    return r ?? [];
  }, [hourly]);

  const max = Math.max(1, ...rows.map((r) => r.hotspots));
  const cx = 110, cy = 110, R = 86;

  return (
    <figure className="rounded-lg border border-line bg-surface-2 p-3">
      <figcaption className="mb-1 text-xs text-ink-dim">
        Fire Clock Dial — diagnostic of when satellites observe
      </figcaption>
      <svg viewBox="0 0 220 230" className="mx-auto w-full max-w-[280px]" role="img" aria-label="24-hour observing-time dial">
        {Array.from({ length: 24 }, (_, h) => {
          const a = ((h - 6 + 24) % 24) / 24 * Math.PI * 2 - Math.PI / 2;
          const r0 = R - 8, r1 = R - 8 - (rows[h]?.hotspots ?? 0) / max * 44;
          const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
          const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1;
          return (
            <g key={h}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={ACCENT} strokeWidth={4} strokeLinecap="round" opacity={0.85} />
              <text
                x={cx + Math.cos(a) * (R + 12)}
                y={cy + Math.sin(a) * (R + 12) + 3}
                fontSize={8}
                fill={INK_DIM}
                textAnchor="middle"
              >
                {String(h).padStart(2, '0')}
              </text>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={R - 52} fill="none" stroke="#26314a" strokeWidth={1} />
        <text x={cx} y={cy - 4} fontSize={10} fill={INK_DIM} textAnchor="middle">local solar hour</text>
        <text x={cx} y={cy + 10} fontSize={9} fill={INK_DIM} textAnchor="middle">observations</text>
      </svg>
      <p className="mt-1 text-center text-[11px] leading-snug text-ink-dim">{DIAL_CAPTION}</p>
    </figure>
  );
}
