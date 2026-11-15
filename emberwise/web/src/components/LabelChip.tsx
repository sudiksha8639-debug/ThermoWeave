import type { TrustLabel } from '../types';

const TRUST: Record<TrustLabel, { cls: string; title: string }> = {
  Measured: {
    cls: 'bg-accent-2/15 text-accent-2 border-accent-2/40',
    title: 'Measured — direct observation from a consistent sensor',
  },
  Estimated: {
    cls: 'bg-accent/15 text-accent border-accent/40',
    title: 'Estimated — modelled from overlapping sensors',
  },
  Indicative: {
    cls: 'bg-sky-400/15 text-sky-300 border-sky-400/40',
    title: 'Indicative — early era, single sensor, treat as directional only',
  },
  Provisional: {
    cls: 'bg-violet-400/15 text-violet-300 border-violet-400/40',
    title: 'Provisional — newest data, pending validation',
  },
};

const EXTRA: Record<string, { cls: string; title: string }> = {
  Saturated: {
    cls: 'bg-amber-400/15 text-amber-300 border-amber-400/40',
    title: 'Saturated — frac_burning near its cap; the value may be truncated',
  },
  'climatology rank': {
    cls: 'bg-line/40 text-ink-dim border-line',
    title: 'Percentile rank of this month against the climatology baseline',
  },
  'Not supplied': {
    cls: 'bg-line/30 text-ink-dim border-dashed border-line',
    title: 'The file this diagnostic needs has not been supplied yet',
  },
  'Development data': {
    cls: 'bg-line/30 text-ink-dim border-line',
    title: 'Bundled development mock data — not the official record',
  },
  frac_burning: {
    cls: 'bg-line/30 text-ink-dim border-line',
    title: 'Fraction of the tile with a burning detection',
  },
};

export function LabelChip({
  label,
  className = '',
}: {
  label: TrustLabel | string;
  className?: string;
}) {
  const s = TRUST[label as TrustLabel] ??
    EXTRA[label] ?? {
      cls: 'bg-line/40 text-ink-dim border-line',
      title: label,
    };
  return (
    <span
      title={s.title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium tracking-wide ${s.cls} ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
}
