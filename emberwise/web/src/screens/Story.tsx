import { ERAS } from '../types';
import { LabelChip } from '../components/LabelChip';
import { useApp } from '../state';

const TRUST_DOT: Record<string, string> = {
  Measured: 'bg-accent-2',
  Estimated: 'bg-accent',
  Indicative: 'bg-sky-400',
  Provisional: 'bg-violet-400',
};

export function Story() {
  const { go } = useApp();
  return (
    <article className="rise mx-auto max-w-5xl space-y-4 sm:space-y-5">
      <section className="card relative overflow-hidden p-5 sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-accent/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-24 h-64 w-64 rounded-full bg-accent-2/10 blur-3xl"
        />
        <div className="relative">
          <p className="section-label">MODIS–VIIRS harmonization · Punjab &amp; Haryana</p>
          <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-[1.08] tracking-tight sm:text-[2.6rem]">
            One harmonized fire record for{' '}
            <span className="bg-gradient-to-r from-[#ffbd68] to-[#ef8a2a] bg-clip-text text-transparent">
              Indian Punjab
            </span>{' '}
            &amp; Haryana.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-dim sm:text-[15px]">
            MODIS and VIIRS see the same fires differently. EMBERWISE puts them on one
            comparable scale, so burning activity can be read across years without ever adding
            two sensors together.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <button onClick={() => go('workspace')} className="btn btn-primary">
              Open the workspace <span aria-hidden="true">→</span>
            </button>
            <button onClick={() => go('proof')} className="btn btn-ghost">
              See the proof
            </button>
          </div>
          <dl className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['res 6', 'H3 grid · ~36 km²'],
              ['2 sensors', 'MODIS + VIIRS'],
              ['1 scale', 'VIIRS reference'],
              ['4 labels', 'Measured → Provisional'],
            ].map(([k, v]) => (
              <div
                key={k}
                className="rounded-xl border border-line/70 bg-surface/40 px-3 py-2.5"
              >
                <dt className="font-mono text-sm font-semibold text-ink">{k}</dt>
                <dd className="mt-0.5 text-[11px] leading-snug text-ink-dim">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-3">
          <header className="mb-3 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/15 text-accent">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 3c3.4 3 5.6 5.9 5.6 9.5A5.6 5.6 0 0 1 12 18a5.6 5.6 0 0 1-5.6-5.5C6.4 8.9 8.6 6 12 3z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h2 className="card-title">What the number means</h2>
          </header>
          <p className="text-sm leading-relaxed text-ink">
            The counting unit is a <strong>burning tile-day</strong>: one H3 resolution-6 tile
            (about 36 km²) with at least one clean hotspot on one local solar date. Values are{' '}
            <strong>relative burning activity at VIIRS scale</strong> — not fire size, burned
            area, or a count of fires.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <p className="rounded-lg border border-line/70 bg-surface/40 px-3 py-2 text-[11.5px] leading-relaxed text-ink-dim">
              <span className="font-semibold text-ink">Never added together.</span> MODIS and
              VIIRS counts are not summed; each day has one source of truth.
            </p>
            <p className="rounded-lg border border-line/70 bg-surface/40 px-3 py-2 text-[11.5px] leading-relaxed text-ink-dim">
              <span className="font-semibold text-ink">Gaps are not zero.</span> Missing
              observations are drawn as gaps and left out of every total.
            </p>
          </div>
        </section>

        <section className="card p-5 lg:col-span-2">
          <h2 className="card-title mb-3">Trust labels</h2>
          <ul className="space-y-2.5">
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
                <span className="text-[11.5px] leading-relaxed text-ink-dim">{d}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card p-5">
        <header className="mb-1 flex items-center justify-between gap-2">
          <h2 className="card-title">Eras</h2>
          <span className="text-[11px] text-ink-dim">Sensor changes are recorded, not smoothed away.</span>
        </header>
        <ol className="mt-3">
          {ERAS.map((e, i) => (
            <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface-2 ${
                    TRUST_DOT[e.trust] ?? 'bg-ink-dim'
                  }`}
                />
                {i < ERAS.length - 1 && <span aria-hidden="true" className="w-px flex-1 bg-line" />}
              </div>
              <div className="flex-1 pb-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-ink">{e.name}</span>
                  <LabelChip label={e.trust} />
                  <span className="font-mono text-[10.5px] text-ink-dim">
                    {e.start} → {e.end || 'open'}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">{e.note}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="card border-amber-400/25 bg-amber-400/[0.04] p-4">
        <div className="flex gap-2.5">
          <span aria-hidden="true" className="mt-0.5 text-amber-300">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4.5 21 20H3L12 4.5z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M12 10v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="12" cy="17" r="0.9" fill="currentColor" />
            </svg>
          </span>
          <p className="text-[11.5px] leading-relaxed text-amber-200/90">
            Not an official fire alert, perimeter map or emergency tool. Missing data is shown as
            a gap, never as zero. The Fire Clock Dial is a transparency diagnostic: satellites
            only look at these times — it shows when we looked, not the full daily fire cycle.
          </p>
        </div>
      </section>
    </article>
  );
}
