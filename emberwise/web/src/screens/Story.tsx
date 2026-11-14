import { ERAS } from '../types';
import { LabelChip } from '../components/LabelChip';
import { useApp } from '../state';

export function Story() {
  const { go } = useApp();
  return (
    <article className="max-w-3xl space-y-6 text-sm leading-relaxed text-ink">
      <header>
        <h1 className="text-2xl font-bold">EMBERWISE</h1>
        <p className="mt-1 text-ink-dim">
          One harmonized MODIS–VIIRS fire record for Indian Punjab and Haryana.
        </p>
      </header>

      <section className="rounded-lg border border-line bg-surface-2 p-4">
        <h2 className="mb-2 font-semibold">What the number means</h2>
        <p>
          The counting unit is a <strong>burning tile-day</strong>: one H3
          resolution-6 tile (about 36 km²) with at least one clean hotspot on
          one local solar date. Values are <strong>relative burning activity at
          VIIRS scale</strong> — not fire size, burned area, or a count of
          fires. MODIS and VIIRS counts are never added together; each day has
          one source of truth.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Trust labels</h2>
        <ul className="space-y-2">
          {(
            [
              ['Measured', 'Direct observation from a consistent sensor.'],
              ['Estimated', 'Modelled across overlapping sensors; wider uncertainty bands.'],
              ['Indicative', 'Early single-sensor era — directional only.'],
              ['Provisional', 'Newest data, pending cross-calibration.'],
            ] as const
          ).map(([l, d]) => (
            <li key={l} className="flex items-start gap-2">
              <LabelChip label={l} className="mt-0.5 shrink-0" />
              <span className="text-ink-dim">{d}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Eras</h2>
        <ul className="space-y-2">
          {ERAS.map((e) => (
            <li key={e.id} className="rounded border border-line bg-surface-2 p-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-ink-dim">
                  {e.start} → {e.end || 'open'}
                </span>
                <LabelChip label={e.trust} />
              </div>
              <p className="mt-1 text-xs text-ink-dim">{e.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-4">
        <p className="text-xs leading-relaxed text-amber-200/90">
          Not an official fire alert, perimeter map or emergency tool. Missing
          data is shown as a gap, never as zero. The Fire Clock Dial is a
          transparency diagnostic: satellites only look at these times — it
          shows when we looked, not the full daily fire cycle.
        </p>
      </section>

      <button
        onClick={() => go('workspace')}
        className="rounded bg-accent px-4 py-2 font-medium text-surface"
      >
        Open the workspace →
      </button>
    </article>
  );
}
