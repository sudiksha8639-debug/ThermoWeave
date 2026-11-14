import {
  loadClimatology,
  loadConversion,
  loadCoverage,
  loadDrift,
  loadHourly,
  loadPeriods,
  loadRegionDaily,
  loadRelaySim,
  loadValidation,
} from '../data';
import { useData } from '../hooks';
import type { JsonFile } from '../types';
import { LabelChip } from '../components/LabelChip';
import { FireClockDialSlot } from '../components/FireClockDial';
import { INK_DIM } from '../theme';

// SLOT: generic lab card. Teammates can replace the body of each *Slot
// below; keep names stable so Workspace/Proof layout does not change.
function LabCard({
  title,
  chip,
  state,
  children,
}: {
  title: string;
  chip?: string;
  state: { loading: boolean; error: string | null; retry: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface-2 p-4">
      <header className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {chip && <LabelChip label={chip} />}
      </header>
      {state.loading && <p className="text-xs" style={{ color: INK_DIM }}>Loading…</p>}
      {state.error && (
        <p className="flex items-center gap-2 text-xs text-red-300">
          <span>{state.error}</span>
          <button
            onClick={state.retry}
            className="rounded border border-red-400/50 px-1.5 py-0.5 text-[10px] hover:bg-red-500/20"
          >
            Retry
          </button>
        </p>
      )}
      {!state.loading && !state.error && children}
    </section>
  );
}

function JsonPreview({ data }: { data: JsonFile | null }) {
  if (!data) return null;
  const keys = Object.keys(data);
  const summary = keys
    .map((k) => {
      const v = data[k];
      if (Array.isArray(v)) return `${k}: ${v.length} rows`;
      if (v && typeof v === 'object') return `${k}: {${Object.keys(v as object).slice(0, 4).join(', ')}…}`;
      return `${k}: ${String(v)}`;
    })
    .join(' · ');
  return (
    <div>
      <p className="mb-1 text-[11px]" style={{ color: INK_DIM }}>{summary}</p>
      <pre className="max-h-40 overflow-auto rounded bg-surface p-2 text-[10px] leading-snug text-ink-dim">
        {JSON.stringify(data, null, 1).slice(0, 3000)}
      </pre>
    </div>
  );
}

export function ValidationSlot() {
  const q = useData(loadValidation, []);
  return (
    <LabCard title="Validation" chip="Provisional" state={q}>
      <JsonPreview data={q.data} />
    </LabCard>
  );
}
export function RelaySimSlot() {
  const q = useData(loadRelaySim, []);
  return (
    <LabCard title="Relay satellite simulation" chip="Estimated" state={q}>
      <JsonPreview data={q.data} />
    </LabCard>
  );
}
export function ConversionSlot() {
  const q = useData(loadConversion, []);
  return (
    <LabCard title="MODIS→VIIRS conversion" chip="Estimated" state={q}>
      <JsonPreview data={q.data} />
    </LabCard>
  );
}
export function DriftSlot() {
  const q = useData(loadDrift, []);
  return (
    <LabCard title="Observing-time drift" chip="Indicative" state={q}>
      <JsonPreview data={q.data} />
    </LabCard>
  );
}
export function HourlySlot() {
  const q = useData(loadHourly, []);
  return (
    <LabCard title="Hourly distribution" chip="Measured" state={q}>
      <FireClockDialSlot hourly={q.data} />
    </LabCard>
  );
}
export function ClimatologyLabSlot() {
  const q = useData(loadClimatology, []);
  return (
    <LabCard title="Climatology" chip="Measured" state={q}>
      <JsonPreview data={q.data as unknown as JsonFile} />
    </LabCard>
  );
}
export function CoverageSlot() {
  const q = useData(loadCoverage, []);
  return (
    <LabCard title="Sensor coverage" chip="Measured" state={q}>
      <JsonPreview data={q.data as unknown as JsonFile} />
    </LabCard>
  );
}
export function RegionDailyLabSlot() {
  const q = useData(loadRegionDaily, []);
  return (
    <LabCard title="Region daily series" chip="Measured" state={q}>
      <JsonPreview data={q.data as unknown as JsonFile} />
    </LabCard>
  );
}
export function PeriodsSlot() {
  const q = useData(loadPeriods, []);
  const periods = (q.data?.periods ?? []) as { start: string; end: string; severity: string; firm: boolean; sentence: string }[];
  return (
    <LabCard title="Narrative periods" chip="Mixed" state={q}>
      <ul className="space-y-2 text-xs">
        {periods.map((p, i) => (
          <li key={i} className="border-l-2 border-line pl-2">
            <span className="font-mono text-ink-dim">{p.start} → {p.end || 'open'}</span>{' '}
            <LabelChip label={p.firm ? 'Measured' : 'Provisional'} />{' '}
            <span className="text-ink-dim">{p.sentence}</span>
          </li>
        ))}
      </ul>
    </LabCard>
  );
}

export function Proof() {
  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm text-ink-dim">
        The Proof / Lab screen surfaces the diagnostic files behind every number:
        validation, conversion factors, drift, hourly observing geometry,
        climatology, coverage and narrative periods. Each card is a drop-in
        slot — teammate chart components replace the JSON preview without
        layout changes.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <ValidationSlot />
        <RelaySimSlot />
        <ConversionSlot />
        <DriftSlot />
        <HourlySlot />
        <ClimatologyLabSlot />
        <CoverageSlot />
        <RegionDailyLabSlot />
        <PeriodsSlot />
      </div>
    </div>
  );
}
