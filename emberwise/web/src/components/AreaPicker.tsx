import { useMemo, useState } from 'react';
import { useApp, ymOf, ymStr } from '../state';
import { loadRegions } from '../data';
import { useData } from '../hooks';
import type { Region } from '../types';

// build a real month list 2019-01 .. 2026-11
const ALL_MONTHS: string[] = [];
for (let y = 2019; y <= 2026; y++)
  for (let m = 1; m <= 12; m++) {
    if (y === 2026 && m > 11) break;
    ALL_MONTHS.push(`${y}-${String(m).padStart(2, '0')}`);
  }

function inBBox(lon: number, lat: number, b: [number, number, number, number]) {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

export function AreaPicker() {
  // On small screens the picker collapses into a drawer; on lg+ it is always open.
  const [open, setOpen] = useState(false);
  const { regionId, startYm, endYm } = useApp();
  return (
    <section aria-label="Area picker" className="card overflow-hidden">
      <button
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left lg:hidden"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="area-picker-body"
      >
        <span>
          <span className="section-label">Area &amp; period</span>
          <span className="mt-0.5 block text-xs text-ink-dim">
            {regionId.replace(/_/g, ' ')} · {ymStr(startYm)} → {ymStr(endYm)}
          </span>
        </span>
        <span
          className={`text-ink-dim transition ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>
      <div id="area-picker-body" className={open ? 'block' : 'hidden lg:block'}>
        <AreaPickerBody />
      </div>
    </section>
  );
}

function AreaPickerBody() {
  const { regionId, setRegionId, startYm, endYm, setRange } = useApp();
  const { data, loading, error, retry } = useData(loadRegions, []);
  const regions = data?.regions ?? [];
  const region: Region | undefined = regions.find((r) => r.id === regionId);

  // custom lat/long box state
  const [box, setBox] = useState({ w: '', s: '', e: '', n: '' });
  const [boxMsg, setBoxMsg] = useState<string | null>(null);

  const insideLoaded = useMemo(() => {
    const vals = [box.w, box.s, box.e, box.n].map(Number);
    if (vals.some((v) => !Number.isFinite(v))) return null;
    const [w, s, e, n] = vals;
    if (w >= e || s >= n) return 'West must be < East and South < North.';
    const hit = regions.find((r) =>
      inBBox(w, s, r.bbox) && inBBox(e, n, r.bbox)
    );
    return hit ? hit.id : 'outside';
  }, [box, regions]);

  const applyBox = () => {
    if (insideLoaded === null) {
      setBoxMsg('Enter a valid W/S/E/N box.');
      return;
    }
    if (insideLoaded === 'outside') {
      setBoxMsg('No data loaded here. Choose a preset or a loaded region.');
      return;
    }
    if (insideLoaded.includes('<')) {
      setBoxMsg(insideLoaded);
      return;
    }
    setBoxMsg(null);
    setRegionId(insideLoaded);
  };

  return (
    <div className="p-4">
      <div className="mb-4 hidden items-baseline justify-between gap-3 border-b border-line/60 pb-3 lg:flex">
        <div>
          <h2 className="card-title">Area &amp; period</h2>
          <p className="mt-0.5 text-[11px] text-ink-dim">
            Preset regions and control boxes share the same tile grid.
          </p>
        </div>
        <span className="font-mono text-[11px] text-ink-dim">
          {ymStr(startYm)} → {ymStr(endYm)}
        </span>
      </div>
      {loading && <p className="text-sm text-ink-dim">Loading regions…</p>}
      {error && (
        <p className="flex items-center gap-2 text-sm text-red-300">
          <span>{error}</span>
          <button onClick={retry} className="btn btn-ghost btn-sm">
            Retry
          </button>
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1fr]">
        <div>
          <label htmlFor="region" className="field-label mb-1.5 block">
            Region
          </label>
          <select
            id="region"
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
            className="control"
          >
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
                {r.kind === 'control' ? ' (control)' : ''}
              </option>
            ))}
          </select>
          {region && (
            <p className="mt-1.5 text-[11px] leading-snug text-ink-dim">
              Boundary: {region.boundary_source ?? 'unknown'} · tiles res{' '}
              {(region.tiles_res ?? []).join('/')}
            </p>
          )}
        </div>

        <div>
          <span className="field-label mb-1.5 block">Custom lat/long box</span>
          <div className="grid grid-cols-4 gap-1.5">
            {(['w', 's', 'e', 'n'] as const).map((k) => (
              <input
                key={k}
                aria-label={`${k.toUpperCase()} bound`}
                placeholder={k.toUpperCase()}
                inputMode="decimal"
                value={box[k]}
                onChange={(e) => setBox({ ...box, [k]: e.target.value })}
                className="control px-1.5 py-1.5 text-center font-mono text-xs"
              />
            ))}
          </div>
          <button onClick={applyBox} className="btn btn-ghost btn-sm mt-2">
            Apply box
          </button>
          {boxMsg && <p className="mt-1.5 text-[11px] text-amber-300">{boxMsg}</p>}
          {insideLoaded &&
            typeof insideLoaded === 'string' &&
            regions.some((r) => r.id === insideLoaded) && (
              <p className="mt-1.5 text-[11px] text-accent-2">
                Inside loaded region: {regions.find((r) => r.id === insideLoaded)?.label}
              </p>
            )}
        </div>

        <div>
          <span className="field-label mb-1.5 block">Period</span>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="from" className="mb-1 block text-[10px] text-ink-dim">
                From
              </label>
              <select
                id="from"
                value={ymStr(startYm)}
                onChange={(e) => {
                  const v = ymOf(e.target.value);
                  if (v !== null) setRange(v, Math.max(v, endYm));
                }}
                className="control"
              >
                {ALL_MONTHS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="to" className="mb-1 block text-[10px] text-ink-dim">
                To
              </label>
              <select
                id="to"
                value={ymStr(endYm)}
                onChange={(e) => {
                  const v = ymOf(e.target.value);
                  if (v !== null) setRange(Math.min(v, startYm), v);
                }}
                className="control"
              >
                {ALL_MONTHS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
