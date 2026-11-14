import type { TrustLabel } from '../types';

const STYLES: Record<TrustLabel, { cls: string; title: string }> = {
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

export function LabelChip({
  label,
  className = '',
}: {
  label: TrustLabel | string;
  className?: string;
}) {
  const s = STYLES[label as TrustLabel] ?? {
    cls: 'bg-line/40 text-ink-dim border-line',
    title: label,
  };
  return (
    <span
      title={s.title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide ${s.cls} ${className}`}
    >
      {label}
    </span>
  );
}
