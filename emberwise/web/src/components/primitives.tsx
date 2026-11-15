import type { ReactNode } from 'react';

export function Stat({
  label,
  value,
  hint,
  className = '',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card card-hover px-3.5 py-3 ${className}`}>
      <p className="section-label truncate">{label}</p>
      <p className="stat-value mt-1 text-ink">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-ink-dim">{hint}</p>}
    </div>
  );
}

export function Meter({
  value,
  max = 100,
  className = '',
  tone = 'teal',
}: {
  value: number;
  max?: number;
  className?: string;
  tone?: 'teal' | 'ember' | 'blue';
}) {
  const pct = Math.max(0, Math.min(100, max === 0 ? 0 : (value / max) * 100));
  const fill =
    tone === 'ember'
      ? 'linear-gradient(90deg, #c9762a, #f6a544)'
      : tone === 'blue'
        ? 'linear-gradient(90deg, #3f6fb5, #7fb2ea)'
        : 'linear-gradient(90deg, #2f8f88, #5ee0d0)';
  return (
    <div className={`meter ${className}`} role="presentation">
      <span style={{ width: `${pct}%`, background: fill }} />
    </div>
  );
}

export function RawJson({
  data,
  label = 'Raw JSON',
  limit = 4000,
}: {
  data: unknown;
  label?: string;
  limit?: number;
}) {
  if (!data) return null;
  return (
    <details className="mt-3 min-w-0">
      <summary className="cursor-pointer text-[11px] text-ink-dim transition hover:text-ink">
        {label}
      </summary>
      <pre className="mt-2 max-h-44 max-w-full overflow-auto rounded-lg border border-line/70 bg-surface/70 p-2.5 text-[10px] leading-relaxed text-ink-dim">
        {JSON.stringify(data, null, 1).slice(0, limit)}
      </pre>
    </details>
  );
}
