import { useMemo, useState } from 'react';
import { fetchHotspotsCsv, toCsv, downloadText } from '../data';
import { SENSOR_MODES, ymToLabel, type Region, type TileGeometry, type TileMonthFile } from '../types';

interface Props {
  region: Region | undefined;
  files: TileMonthFile[];
  geometry: TileGeometry[];
  columns: string[];
  startYm: number;
  endYm: number;
  selectedTiles: Set<number> | null;
}

function regionTileSet(region: Region | undefined): Set<number> | null {
  if (!region?.tiles_in_scope) return null;
  const s = new Set<number>();
  for (const idxs of Object.values(region.tiles_in_scope)) for (const i of idxs) s.add(i);
  return s;
}

export function CsvPanel({ region, files, geometry, columns, startYm, endYm, selectedTiles }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const inScope = useMemo(() => regionTileSet(region), [region]);
  const presetOnly = region?.kind === 'preset';

  const monthlyRows = useMemo(() => {
    const out: Record<string, unknown>[] = [];
    const col = (c: string) => columns.indexOf(c);
    const iTile = col('tile'), iYm = col('ym'), iLo = col('lo'), iHi = col('hi');
    const sensorCols = SENSOR_MODES.map((s) => col(s.column)).filter((i) => i >= 0);
    const sensorNames = SENSOR_MODES.map((s) => s.column).filter((_, i) => sensorCols[i] >= 0);
    const trustI = col('trust');
    for (const f of files) {
      for (const r of f.data) {
        const ym = r[iYm] as number;
        if (ym < startYm || ym > endYm) continue;
        const tile = r[iTile] as number;
        if (inScope && !inScope.has(tile)) continue;
        if (selectedTiles && !selectedTiles.has(tile)) continue;
        const g = geometry[tile];
        const row: Record<string, unknown> = {
          ym: ymToLabel(ym),
          tile_index: tile,
          lat: g ? +g.cy.toFixed(4) : '',
          lon: g ? +g.cx.toFixed(4) : '',
          lo: r[iLo],
          hi: r[iHi],
          trust: trustI >= 0 ? r[trustI] : '',
        };
        sensorCols.forEach((ci, i) => (row[sensorNames[i] as string] = r[ci]));
        out.push(row);
      }
    }
    return out;
  }, [files, geometry, columns, startYm, endYm, inScope, selectedTiles]);

  const downloadMonthly = () => {
    downloadText(
      `emberwise_tile_months_${region?.id ?? 'region'}_${ymToLabel(startYm)}_${ymToLabel(endYm)}.csv`,
      toCsv(monthlyRows)
    );
    setMsg(`${monthlyRows.length.toLocaleString()} monthly tile rows downloaded (H3 tile aggregates).`);
  };

  const yearsInRange = useMemo(() => {
    const ys = new Set<number>();
    for (let ym = startYm; ym <= endYm; ym++) ys.add(Math.floor(ym / 12));
    return [...ys].sort();
  }, [startYm, endYm]);

  const downloadHotspots = async (year: number) => {
    if (!region || !presetOnly) return;
    setBusy(String(year));
    setMsg(null);
    try {
      const csv = await fetchHotspotsCsv(region.id, year);
      downloadText(`emberwise_hotspots_${region.id}_${year}.csv`, csv);
      setMsg(`Hotspot-level file for ${year} downloaded — individual detections (~1 km), not tile aggregates.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed to load hotspot file.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="CSV downloads" className="card p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="card-title">Export CSV</h2>
        <span className="text-[11px] text-ink-dim">tile aggregates · hotspot detections</span>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={downloadMonthly}
          disabled={monthlyRows.length === 0}
          className="btn btn-primary btn-sm"
        >
          Monthly tile rows ({monthlyRows.length.toLocaleString()})
        </button>
        {presetOnly ? (
          yearsInRange.map((y) => (
            <button
              key={y}
              onClick={() => downloadHotspots(y)}
              disabled={busy !== null}
              className="btn btn-ghost btn-sm"
            >
              {busy === String(y) ? 'Loading…' : `Hotspots ${y}`}
            </button>
          ))
        ) : (
          <span className="text-xs text-ink-dim">
            Hotspot-level files exist only for presets, not control boxes.
          </span>
        )}
      </div>
      <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-dim">
        Monthly tile rows are H3 tile aggregates for the selected range
        {selectedTiles ? ' and drag-selected tiles' : ''}. Hotspot files are
        per-preset, per-year point detections at native satellite resolution —
        fetched only when you click.
      </p>
      {msg && <p className="mt-1.5 text-[11px] text-accent-2">{msg}</p>}
    </section>
  );
}
