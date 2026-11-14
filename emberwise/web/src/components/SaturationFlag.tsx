import { LabelChip } from './LabelChip';

// SLOT: saturation flag for tile_month frac_burning near its cap.
// Teammates may replace the visuals; keep the props signature.
export const SATURATION_THRESHOLD = 0.9; // frac_burning >= 0.9 → saturated

export function SaturationFlag({
  fracBuring,
  cap = 1,
  className = '',
}: {
  fracBuring: number | null;
  cap?: number;
  className?: string;
}) {
  if (fracBuring === null || fracBuring === undefined) return null;
  const saturated = fracBuring >= SATURATION_THRESHOLD * cap;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <LabelChip label={saturated ? 'Saturated' : 'frac_burning'} />
      <span className="font-mono text-[11px] text-ink-dim">
        {fracBuring.toFixed(2)}
        {saturated && <span className="ml-1 text-amber-300">near cap — value may be truncated</span>}
      </span>
    </span>
  );
}
