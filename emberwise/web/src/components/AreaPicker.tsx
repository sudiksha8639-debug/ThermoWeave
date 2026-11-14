import { useMemo, useState } from 'react';
import { useApp, ymOf, ymStr } from '../state';
import { loadRegions } from '../data';
import { useData } from '../hooks';
import type { Region } from '../types';

const MONTHS = Array.from({ length: 12 }, (_, i) => `${2019 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
// build a real month list 2019-01 .. 2026-11
const ALL_MONTHS: string[] = [];
for (let y = 2019; y <= 2026; y++)
  for (let m = 1; m <= 12; m++) {
    if (y === 2026 && m > 11) break;
    ALL_MONTHS.push(`${y}-${String(m).padStart(2, '0')}`);
  }
void MONTHS;

function inBBox(lon: number, lat: number, b: [number, number, number, number]) {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

export function AreaPicker() {
  const { regionId, setRegionId, startYm, endYm, setRange } = useApp();
  const { data, loading, error } = useData(loadRegions, []);
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
    <section aria-label="Area picker" className="rounded-lg border border-line bg-surface-2 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-dim">
        Area &amp; period
      </h2>
      {loading && <p className="text-sm text-ink-dim">Loading regions…</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="region" className="mb-1 block text-xs text-ink-dim">
            Region
          </label>
          <select
            id="region"
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
            className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          >
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
                {r.kind === 'control' ? ' (control)' : ''}
              </option>
            ))}
          </select>
          {region && (
            <p className="mt-1 text-[11px] text-ink-dim">
              Boundary: {region.boundary_source ?? 'unknown'} · tiles res{' '}
              {(region.tiles_res ?? []).join('/')}
            </p>
          )}
        </div>

        <div>
          <span className="mb-1 block text-xs text-ink-dim">Custom lat/long box</span>
          <div className="grid grid-cols-4 gap-1">
            {(['w', 's', 'e', 'n'] as const).map((k) => (
              <input
                key={k}
                aria-label={`${k.toUpperCase()} bound`}
                placeholder={k.toUpperCase()}
                inputMode="decimal"
                value={box[k]}
                onChange={(e) => setBox({ ...box, [k]: e.target.value })}
                className="w-full rounded border border-line bg-surface px-1 py-1.5 text-xs text-ink"
              />
            ))}
          </div>
          <button
            onClick={applyBox}
            className="mt-1 rounded border border-line px-2 py-1 text-xs text-ink-dim hover:border-accent-2 hover:text-ink"
          >
            Apply box (inside loaded regions only)
          </button>
          {boxMsg && <p className="mt-1 text-[11px] text-amber-300">{boxMsg}</p>}
          {insideLoaded &&
            typeof insideLoaded === 'string' &&
            regions.some((r) => r.id === insideLoaded) && (
            <p className="mt-1 text-[11px] text-accent-2">
              Inside loaded region: {regions.find((r) => r.id === insideLoaded)?.label}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="from" className="mb-1 block text-xs text-ink-dim">
              From
            </label>
            <select
              id="from"
              value={ymStr(startYm)}
              onChange={(e) => {
                const v = ymOf(e.target.value);
                if (v !== null) setRange(v, Math.max(v, endYm));
              }}
              className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              {ALL_MONTHS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-xs text-ink-dim">
              To
            </label>
            <select
              id="to"
              value={ymStr(endYm)}
              onChange={(e) => {
                const v = ymOf(e.target.value);
                if (v !== null) setRange(Math.min(v, startYm), v);
              }}
              className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              {ALL_MONTHS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </section>
  );
}
