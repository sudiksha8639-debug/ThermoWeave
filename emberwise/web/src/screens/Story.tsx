import { useMemo } from 'react';
import { ERAS } from '../types';
import { LabelChip } from '../components/LabelChip';
import { PhantomSurge } from '../components/PhantomSurge';
import { loadRegionDaily, loadRegions } from '../data';
import { useData } from '../hooks';
import { useApp } from '../state';

const TRUST_DOT: Record<string, string> = {
  Measured: 'bg-accent-2',
  Estimated: 'bg-accent',
  Indicative: 'bg-sky-400',
  Provisional: 'bg-violet-400',
};

export function Story() {
  const { go } = useApp();
  const dailyQ = useData(loadRegionDaily, []);
  const regionsQ = useData(loadRegions, []);
  const region = regionsQ.data?.regions.find((r) => r.id === 'punjab_haryana');
  const rows = useMemo(
    () => (dailyQ.data?.rows ?? []).filter((r) => r.region === 'punjab_haryana'),
    [dailyQ.data]
  );

  return (
    <article className="rise space-y-4 sm:space-y-6">
      <section className="card relative overflow-hidden p-6 sm:p-10 lg:px-12 lg:py-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-accent/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-accent-2/10 blur-3xl"
        />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] lg:items-center lg:gap-12">
          <div>
            <p className="section-label">MODIS–VIIRS harmonization · Punjab &amp; Haryana</p>
            <h1 className="mt-4 max-w-3xl text-[2.1rem] font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.5rem]">
              One harmonized fire record for{' '}
              <span className="bg-gradient-to-r from-[#ffbd68] to-[#ef8a2a] bg-clip-text text-transparent">
                Indian Punjab
              </span>{' '}
              &amp; Haryana.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-dim sm:text-base">
              MODIS and VIIRS see the same fires differently. EMBERWISE puts them on one
              comparable scale, so burning activity can be read across years without ever adding
              two sensors together.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button onClick={() => go('workspace')} className="btn btn-primary">
                Open the workspace <span aria-hidden="true">→</span>
              </button>
              <button onClick={() => go('proof')} className="btn btn-ghost">
                See the proof
              </button>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 lg:border-l lg:border-line/70 lg:pl-12">
            {[
              ['res 6', 'H3 grid · ~36 km²'],
              ['2 sensors', 'MODIS + VIIRS'],
              ['1 scale', 'VIIRS reference'],
              ['4 labels', 'Measured → Provisional'],
            ].map(([k, v]) => (
              <div
                key={k}
                className="rounded-xl border border-line/70 bg-surface/40 px-4 py-4 sm:px-5 sm:py-5"
              >
                <dt className="font-mono text-base font-semibold text-ink sm:text-lg">{k}</dt>
                <dd className="mt-1 text-[11.5px] leading-snug text-ink-dim sm:text-xs">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <PhantomSurge
        rows={rows}
        loading={dailyQ.loading || regionsQ.loading}
        error={dailyQ.error}
        onRetry={dailyQ.retry}
        regionLabel={region?.label ?? 'Punjab + Haryana'}
      />

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <section className="card p-6 sm:p-8 lg:col-span-3">
          <header className="mb-4 flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 3c3.4 3 5.6 5.9 5.6 9.5A5.6 5.6 0 0 1 12 18a5.6 5.6 0 0 1-5.6-5.5C6.4 8.9 8.6 6 12 3z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h2 className="card-title card-title-lg">What the number means</h2>
          </header>
          <p className="text-sm leading-relaxed text-ink sm:text-[15px]">
            The counting unit is a <strong>burning tile-day</strong>: one H3 resolution-6 tile
            (about 36 km²) with at least one clean hotspot on one local solar date. Values are{' '}
            <strong>relative burning activity at VIIRS scale</strong> — not fire size, burned
            area, or a count of fires.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <p className="rounded-lg border border-line/70 bg-surface/40 px-4 py-3 text-xs leading-relaxed text-ink-dim sm:text-[12.5px]">
              <span className="font-semibold text-ink">Never added together.</span> MODIS and
              VIIRS counts are not summed; each day has one source of truth.
            </p>
            <p className="rounded-lg border border-line/70 bg-surface/40 px-4 py-3 text-xs leading-relaxed text-ink-dim sm:text-[12.5px]">
              <span className="font-semibold text-ink">Gaps are not zero.</span> Missing
              observations are drawn as gaps and left out of every total.
            </p>
          </div>
        </section>

        <section className="card flex flex-col p-6 sm:p-8 lg:col-span-2">
          <h2 className="card-title card-title-lg mb-4">Trust labels</h2>
          <ul className="flex flex-1 flex-col justify-around gap-3">
            {(
              [
                ['Measured', 'Direct observation from a consistent sensor.'],
                ['Estimated', 'Modelled across overlapping sensors; wider uncertainty bands.'],
                ['Indicative', 'Early single-sensor era — directional only.'],
                ['Provisional', 'Newest data, pending cross-calibration.'],
              ] as const
            ).map(([l, d]) => (
              <li key={l} className="flex items-start gap-2.5">
                <LabelChip label={l} className="mt-0.5 shrink-0" />
                <span className="text-xs leading-relaxed text-ink-dim sm:text-[12.5px]">{d}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card p-6 sm:p-8">
        <header className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <h2 className="card-title card-title-lg">Eras</h2>
          <span className="text-[11px] text-ink-dim">Sensor changes are recorded, not smoothed away.</span>
        </header>
        <div className="mt-4 grid gap-x-10 gap-y-6 lg:grid-cols-2">
          {[ERAS.slice(0, 2), ERAS.slice(2)].map((group, gi) => (
            <ol key={gi}>
              {group.map((e, i) => (
                <li key={e.id} className="relative flex gap-4 pb-5 last:pb-0">
                  <div className="flex flex-col items-center">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface-2 ${
                        TRUST_DOT[e.trust] ?? 'bg-ink-dim'
                      }`}
                    />
                    {i < group.length - 1 && (
                      <span aria-hidden="true" className="w-px flex-1 bg-line" />
                    )}
                  </div>
                  <div className="flex-1 pb-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="text-[15px] font-medium text-ink">{e.name}</span>
                      <LabelChip label={e.trust} />
                      <span className="font-mono text-[10.5px] text-ink-dim">
                        {e.start} → {e.end || 'open'}
                      </span>
                    </div>
                    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-dim sm:text-[12.5px]">
                      {e.note}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ))}
        </div>
      </section>

      <section className="card border-amber-400/25 bg-amber-400/[0.04] p-5 sm:p-6">
        <div className="flex gap-3">
          <span aria-hidden="true" className="mt-0.5 text-amber-300">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
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
          <div className="flex-1">
            <p className="max-w-4xl text-xs leading-relaxed text-amber-200/90 sm:text-[12.5px]">
              Not an official fire alert, perimeter map or emergency tool. Missing data is shown as
              a gap, never as zero. The Fire Clock Dial is a transparency diagnostic: satellites
              only look at these times — it shows when we looked, not the full daily fire cycle.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => go('workspace')} className="btn btn-ghost btn-sm">
                Open the calendar &amp; map
              </button>
              <button onClick={() => go('proof')} className="btn btn-ghost btn-sm">
                See the transparency lab
              </button>
              <button onClick={() => go('methods')} className="btn btn-ghost btn-sm">
                Read methods, limits &amp; provenance
              </button>
            </div>
          </div>
        </div>
      </section>
    </article>
  );
}
