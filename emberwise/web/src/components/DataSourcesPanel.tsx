import { useRef, useSyncExternalStore } from 'react';
import {
  getFileStatuses,
  subscribeFileStatuses,
  tileMonthYears,
  loadClimatology,
  loadConversion,
  loadCoverage,
  loadDrift,
  loadHourly,
  loadManifest,
  loadNarratives,
  loadPeriods,
  loadRegionDaily,
  loadRegions,
  loadRelaySim,
  loadTileDay,
  loadTileGeometry,
  loadTileMonth,
  loadValidation,
  resetDataCache,
} from '../data';
import { INK_DIM, LINE } from '../theme';

// Probe every known file so the panel shows repo-vs-mock for all of them.
// Loaders are cached; failures surface as error rows with the file name.
function probeAll() {
  const jobs: Promise<unknown>[] = [
    loadManifest(), loadRegions(), loadCoverage(), loadValidation(),
    loadRelaySim(), loadConversion(), loadDrift(), loadHourly(),
    loadClimatology(), loadPeriods(), loadRegionDaily(), loadTileGeometry(),
    loadNarratives(), loadTileDay(),
    ...tileMonthYears().map((y) => loadTileMonth(y)),
  ];
  jobs.forEach((p) => p.catch(() => {}));
}

function SourceBadge({ source, error }: { source: string | null; error: string | null }) {
  if (error) {
    return <span className="rounded border border-red-500/50 px-1.5 py-0.5 text-[10px] text-red-300">error</span>;
  }
  if (source === 'repo') {
    return <span className="rounded border border-accent-2/50 px-1.5 py-0.5 text-[10px] text-accent-2">repo data</span>;
  }
  if (source === 'mock') {
    return <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim">synthetic mock</span>;
  }
  return <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim">…</span>;
}

export function DataSourcesPanel() {
  const statuses = useSyncExternalStore(subscribeFileStatuses, getFileStatuses);
  const probed = useRef(false);

  return (
    <details
      className="rounded-lg border border-line bg-surface-2 text-xs"
      onToggle={(e) => {
        // Probe lazily: only when the drawer is opened, so the Story screen
        // does not eagerly parse every tile_month file.
        if ((e.target as HTMLDetailsElement).open && !probed.current) {
          probed.current = true;
          probeAll();
        }
      }}
    >
      <summary
        className="cursor-pointer select-none px-3 py-2 font-medium text-ink-dim hover:text-ink"
        style={{ color: INK_DIM }}
      >
        Data sources ({statuses.filter((s) => s.source === 'repo').length} repo /{' '}
        {statuses.filter((s) => s.source === 'mock').length} mock
        {statuses.some((s) => s.error) ? ` / ${statuses.filter((s) => s.error).length} error` : ''})
      </summary>
      <div className="border-t border-line px-3 py-2">
        <p className="mb-2 text-[11px] leading-snug" style={{ color: INK_DIM }}>
          Each file is tried from the repo (<code>mock-data/</code> →{' '}
          <code>public/data/</code>) first; missing or schema-only files fall
          back to the bundled synthetic mocks. Hotspot CSVs load on demand.
        </p>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left" style={{ color: INK_DIM }}>
              <th className="py-0.5 pr-2">File</th>
              <th className="py-0.5 pr-2">Source</th>
              <th className="py-0.5 pr-2">schema_version</th>
              <th className="py-0.5">Note</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => (
              <tr key={s.name} className="border-t" style={{ borderColor: LINE }}>
                <td className="py-0.5 pr-2 font-mono">{s.name}</td>
                <td className="py-0.5 pr-2">
                  <SourceBadge source={s.source} error={s.error} />
                </td>
                <td className="py-0.5 pr-2 font-mono">{s.schemaVersion ?? '—'}</td>
                <td className="py-0.5" style={{ color: INK_DIM }}>
                  {s.error ? <span className="text-red-300">{s.error}</span> : (s.note ?? '')}
                </td>
              </tr>
            ))}
            {statuses.length === 0 && (
              <tr><td colSpan={4} className="py-1" style={{ color: INK_DIM }}>Loading…</td></tr>
            )}
          </tbody>
        </table>
        <button
          onClick={() => {
            resetDataCache();
            probeAll();
          }}
          className="mt-2 rounded border border-line px-2 py-1 text-[11px] text-ink-dim hover:border-accent-2 hover:text-ink"
        >
          Re-check sources
        </button>
      </div>
    </details>
  );
}
