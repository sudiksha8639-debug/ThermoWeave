import { useEffect, useMemo, useState } from 'react';
import { useApp, ymStr } from '../state';
import {
  loadClimatology,
  loadHourly,
  loadManifest,
  loadRegionDaily,
  loadRegions,
  loadTileGeometry,
  loadTileMonth,
} from '../data';
import { useData } from '../hooks';
import {
  ERAS,
  SENSOR_MODES,
  SENSOR_MODE_LABEL,
  eraForYm,
  erasFromManifest,
  tmNum,
  ymRange,
  ymToLabel,
  type TileGeometry,
  type TileMonthFile,
  type TmCol,
} from '../types';
import { AreaPicker } from '../components/AreaPicker';
import { HexMap } from '../components/HexMap';
import { SeriesChartSlot } from '../components/SeriesChart';
import { FireClockDialSlot } from '../components/FireClockDial';
import { CsvPanel } from '../components/CsvPanel';
import { InspectPanel } from '../components/InspectPanel';
import { ThisMonthCard } from '../components/ThisMonthCard';
import { LabelChip } from '../components/LabelChip';
import { INK_DIM, LINE, viridis } from '../theme';

const NO_DATA_MSG = 'No data loaded here. Choose a preset or a loaded region.';
// Res-6 payloads above this many tiles automatically fall back to res 5.
const RES6_BUDGET = 5500;

export function Workspace() {
  const {
    regionId, startYm, endYm, sensor, setSensor,
    selectedYm, setSelectedYm, selectedTiles, setSelectedTiles,
    inspected, setInspected,
  } = useApp();
  const [minValue, setMinValue] = useState(0);
  const [resPref, setResPref] = useState<5 | 6>(6);
  const [drawPolygon, setDrawPolygon] = useState(false);
  const [polygon, setPolygon] = useState<[number, number][] | null>(null);
  const [polyMsg, setPolyMsg] = useState<string | null>(null);
  const [filesTick, setFilesTick] = useState(0);

  const regionsQ = useData(loadRegions, []);
  const geomQ = useData(loadTileGeometry, []);
  const dailyQ = useData(loadRegionDaily, []);
  const climQ = useData(loadClimatology, []);
  const hourlyQ = useData(loadHourly, []);
  const manifestQ = useData(loadManifest, []);

  const years = useMemo(() => {
    const ys = new Set<number>();
    for (let ym = startYm; ym <= endYm; ym++) ys.add(Math.floor(ym / 12));
    return [...ys].sort();
  }, [startYm, endYm]);

  // load each tile_month year lazily; combine into one view
  const [files, setFiles] = useState<Map<number, TileMonthFile>>(new Map());
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const yearsKey = years.join(',');
  useEffect(() => {
    let cancelled = false;
    setFilesLoading(true);
    setFilesError(null);
    Promise.all(
      years.map((y) =>
        loadTileMonth(y).catch((e) => {
          throw new Error(`tile_month_${y}: ${e instanceof Error ? e.message : e}`);
        })
      )
    )
      .then((fs) => {
        if (cancelled) return;
        setFiles(new Map(fs.map((f) => [f.year, f])));
        setFilesLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setFilesError(e instanceof Error ? e.message : String(e));
        setFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearsKey, filesTick]);

  const region = regionsQ.data?.regions.find((r) => r.id === regionId);
  const allGeom = geomQ.data?.tile_geometry ?? [];

  // res-5 availability: region lists res-5 tiles, or res-5 geometry exists in scope
  const res5Available = useMemo(() => {
    if (!region) return false;
    const listed = (region.tiles_in_scope?.['5']?.length ?? 0) > 0;
    if (listed) return true;
    const [w, s, e, n] = region.bbox;
    return allGeom.some(
      (g) => g.res === 5 && g.cx >= w && g.cx <= e && g.cy >= s && g.cy <= n
    );
  }, [region, allGeom]);

  const res6Count = region?.tiles_in_scope?.['6']?.length ?? 0;
  // res 6 is default; when its payload is over budget we fall back to res 5
  // automatically (the manual switch stays available either way).
  const autoFallback = resPref === 6 && res6Count > RES6_BUDGET && res5Available;
  const mapRes: 5 | 6 = autoFallback ? 5 : resPref;

  const mapTiles = useMemo<TileGeometry[]>(() => {
    if (!region) return [];
    const idxs = region.tiles_in_scope?.[String(mapRes)];
    if (idxs && idxs.length) {
      const set = new Set(idxs);
      return allGeom.filter((g) => g.res === mapRes && set.has(g.index));
    }
    const [w, s, e, n] = region.bbox;
    return allGeom.filter(
      (g) => g.res === mapRes && g.cx >= w && g.cx <= e && g.cy >= s && g.cy <= n
    );
  }, [allGeom, region, mapRes]);

  // polygon / GeoJSON → tile selection: only tiles inside loaded regions count
  const regionTileIndex = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const r of regionsQ.data?.regions ?? []) {
      const s = new Set<number>();
      for (const list of Object.values(r.tiles_in_scope ?? {})) for (const i of list) s.add(i);
      m.set(r.id, s);
    }
    return m;
  }, [regionsQ.data]);

  const pointInPoly = (lon: number, lat: number, poly: [number, number][]) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  const onPolygonComplete = (poly: [number, number][]) => {
    setPolygon(poly);
    const scope = regionTileIndex.get(regionId);
    const sel = new Set<number>();
    for (const t of mapTiles) {
      if (pointInPoly(t.cx, t.cy, poly) && (!scope || scope.has(t.index))) sel.add(t.index);
    }
    setSelectedTiles(sel.size ? sel : null);
    setInspected(null);
    setPolyMsg(
      sel.size
        ? `${sel.size.toLocaleString()} tiles inside polygon ∩ ${region?.label ?? regionId}.`
        : NO_DATA_MSG
    );
  };

  const fileList = useMemo(() => [...files.values()], [files]);
  const columns = fileList[0]?.columns ?? [];
  const valueCol: TmCol = SENSOR_MODES.find((s) => s.id === sensor)?.column ?? 'harm';

  const monthOptions = useMemo(() => ymRange(startYm, endYm), [startYm, endYm]);
  const clampedSelected = monthOptions.includes(selectedYm) ? selectedYm : endYm;
  const monthFile = files.get(Math.floor(clampedSelected / 12)) ?? null;

  // rows for selected month across the file (for inspect panel)
  const rowsForYm = useMemo(() => {
    const m = new Map<number, import('../types').TmCell[]>();
    if (!monthFile) return m;
    const iT = columns.indexOf('tile'), iYm = columns.indexOf('ym');
    for (const r of monthFile.data) if (r[iYm] === clampedSelected) m.set(r[iT] as number, r);
    return m;
  }, [monthFile, columns, clampedSelected]);

  // era boundaries: manifest first, then the four config eras
  const eras = useMemo(
    () => erasFromManifest(manifestQ.data) ?? ERAS,
    [manifestQ.data]
  );

  // era banner: eras overlapping selected range (month granularity)
  const eraOverlap = useMemo(
    () =>
      eras.filter((e) => {
        const s = e.start;
        const [sy, sm] = s.split('-').map(Number);
        const sYm = sy * 12 + sm - 1;
        const endParts = (e.end || '2100-01').split('-').map(Number);
        const eYm = endParts[0] * 12 + endParts[1] - 1;
        return startYm <= eYm && endYm >= sYm;
      }),
    [eras, startYm, endYm]
  );

  const regionTrust = eraForYm(clampedSelected, eras).trust;

  // daily rows for series chart
  const dailyRows = useMemo(() => {
    if (!dailyQ.data || !region) return [];
    const from = `${ymStr(startYm)}-01`;
    return dailyQ.data.rows.filter(
      (r) =>
        r.region === region.id &&
        r.date >= from &&
        r.date.slice(0, 7) <= ymStr(endYm)
    );
  }, [dailyQ.data, region, startYm, endYm]);

  // tiles with data for the selected month (keyboard-navigable list)
  const tilesWithData = useMemo(() => {
    const out: { index: number; value: number | null }[] = [];
    for (const [idx, row] of rowsForYm) {
      out.push({ index: idx, value: tmNum(row, columns, valueCol) });
    }
    out.sort((a, b) => a.index - b.index);
    return out;
  }, [rowsForYm, columns, valueCol]);

  const loading = regionsQ.loading || geomQ.loading || filesLoading;
  const error = regionsQ.error || geomQ.error || filesError;
  const retryAll = () => {
    regionsQ.retry(); geomQ.retry(); dailyQ.retry(); climQ.retry(); hourlyQ.retry();
    setFilesTick((t) => t + 1);
  };

  return (
    <div className="space-y-4">
      <AreaPicker />

      {/* era banner */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-dim">Era</span>
        {eraOverlap.map((e, i) => (
          <span key={`${e.id}-${i}`} className="flex items-center gap-2">
            <LabelChip label={e.trust} />
            <span className="text-xs text-ink">{e.name}</span>
            <span className="font-mono text-[10px] text-ink-dim">
              {e.start} → {e.end || 'open'}
            </span>
          </span>
        ))}
        <span className="text-[11px] text-ink-dim">
          {eraOverlap[eraOverlap.length - 1]?.note}
        </span>
      </div>

      {/* sensor mode + month + threshold + resolution */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface-2 px-4 py-3">
        <div role="radiogroup" aria-label="Sensor mode" className="flex gap-1">
          {SENSOR_MODES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={sensor === s.id}
              onClick={() => setSensor(s.id)}
              className={`rounded px-3 py-1.5 text-sm ${
                sensor === s.id
                  ? 'bg-accent font-semibold text-surface'
                  : 'border border-line text-ink-dim hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-dim">
          Month
          <select
            value={ymToLabel(clampedSelected)}
            onChange={(e) => {
              const [y, m] = e.target.value.split('-').map(Number);
              setSelectedYm(y * 12 + m - 1);
            }}
            className="rounded border border-line bg-surface px-2 py-1 text-sm text-ink"
          >
            {monthOptions.map((ym) => (
              <option key={ym} value={ymToLabel(ym)}>
                {ymToLabel(ym)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-dim">
          Min tile-days
          <input
            type="range"
            min={0}
            max={20}
            step={0.5}
            value={minValue}
            onChange={(e) => setMinValue(Number(e.target.value))}
            className="w-28 accent-[#f0a03c]"
          />
          <span className="w-10 font-mono text-ink">{minValue}</span>
        </label>
        {res5Available && (
          <div role="radiogroup" aria-label="Map resolution" className="flex items-center gap-1 text-xs text-ink-dim">
            <span>Map resolution</span>
            {([6, 5] as const).map((r) => (
              <button
                key={r}
                role="radio"
                aria-checked={mapRes === r}
                onClick={() => setResPref(r)}
                className={`rounded px-2 py-1 ${
                  mapRes === r
                    ? 'bg-line/70 font-semibold text-ink'
                    : 'border border-line text-ink-dim hover:text-ink'
                }`}
              >
                res {r}
                {r === 6 && autoFallback ? ' (auto→5)' : ''}
              </button>
            ))}
            {autoFallback && (
              <span className="text-[10px] text-amber-300">
                auto: res-6 payload over budget ({res6Count.toLocaleString()} tiles)
              </span>
            )}
          </div>
        )}
        <button
          onClick={() => {
            setDrawPolygon((d) => !d);
            if (drawPolygon) { setPolygon(null); setSelectedTiles(null); setPolyMsg(null); }
          }}
          aria-pressed={drawPolygon}
          className={`rounded border px-2 py-1 text-xs ${
            drawPolygon
              ? 'border-accent-2 bg-accent-2/15 font-semibold text-accent-2'
              : 'border-line text-ink-dim hover:text-ink'
          }`}
        >
          {drawPolygon ? 'Finish polygon (dbl-click)' : 'Draw polygon'}
        </button>
        {selectedTiles && (
          <button
            onClick={() => { setSelectedTiles(null); setPolygon(null); setPolyMsg(null); }}
            className="rounded border border-accent-2 px-2 py-1 text-xs text-accent-2"
          >
            Clear selection ({selectedTiles.size.toLocaleString()} tiles)
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          <span>{error}</span>
          <button
            onClick={retryAll}
            className="rounded border border-red-400/50 px-2 py-0.5 text-xs hover:bg-red-500/20"
          >
            Retry
          </button>
        </div>
      )}
      {loading && <p className="text-sm text-ink-dim">Loading tiles and monthly data…</p>}
      {polyMsg && <p className="text-sm text-accent-2">{polyMsg}</p>}

      {/* map + side panel */}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="h-[320px] overflow-hidden rounded-lg border border-line bg-surface-2 sm:h-[420px] lg:h-[560px]">
          {!loading && !error && (
            <HexMap
              tiles={mapTiles}
              tileMonth={monthFile}
              columns={columns}
              valueCol={valueCol}
              selectedYm={clampedSelected}
              minValue={minValue}
              drawPolygon={drawPolygon}
              polygonPoints={polygon}
              onPolygonComplete={onPolygonComplete}
            />
          )}
        </div>
        <div className="space-y-4">
          <InspectPanel
            target={inspected}
            rowsForYm={rowsForYm}
            columns={columns}
            geometry={allGeom}
            valueCol={valueCol}
            regionTrust={regionTrust}
          />
          <ThisMonthCard regionId={regionId} />
          {/* SLOT: teammate drops in the real dial here */}
          <FireClockDialSlot hourly={hourlyQ.data} />
          {/* SLOT: teammate drops in climatology panel here */}
          <ClimatologySlot rows={climQ.data?.rows ?? []} regionId={regionId} />
          <TileList
            tiles={tilesWithData}
            columns={columns}
            geometry={allGeom}
            valueCol={valueCol}
            inspected={inspected?.tile}
            onPick={(idx) => setInspected({ tile: idx, ym: clampedSelected })}
          />
        </div>
      </div>

      {/* legend / summary — every number carries a label chip */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 py-2 text-[11px] text-ink-dim">
        <span>{SENSOR_MODE_LABEL[sensor]} tile-days</span>
        <LabelChip label={regionTrust} />
        <span className="text-ink-dim">region trust · {ymToLabel(clampedSelected)}</span>
        <span
          className="inline-block h-2.5 w-40 rounded"
          style={{
            background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => viridis(t)).join(', ')})`,
          }}
        />
        <span>0 → max</span>
        <span className="ml-3 inline-block h-2.5 w-4 rounded" style={{ background: '#3a4152' }} />
        <span>zero</span>
        <span className="inline-block h-2.5 w-4 rounded" style={{ background: '#20263a' }} />
        <span>gap / filtered</span>
      </div>

      {/* text-table alternative for the map selection */}
      <SelectionTable
        selectedTiles={selectedTiles}
        rowsForYm={rowsForYm}
        columns={columns}
        geometry={allGeom}
        valueCol={valueCol}
        ym={clampedSelected}
      />

      {/* SLOT: teammate series chart */}
      <SeriesChartSlot rows={dailyRows} title={`Daily harmonized burning tile-days — ${region?.label ?? regionId}`} />

      <RegionCompare
        rows={dailyQ.data?.rows ?? []}
        regions={regionsQ.data?.regions ?? []}
        startYm={startYm}
        endYm={endYm}
      />

      <GeoJsonUpload
        mapTiles={mapTiles}
        inScope={regionTileIndex.get(regionId)}
        onSelect={(sel, msg) => {
          setSelectedTiles(sel.size ? sel : null);
          setInspected(null);
          setPolyMsg(msg);
        }}
      />

      <CsvPanel
        region={region}
        files={fileList}
        geometry={allGeom}
        columns={columns}
        startYm={startYm}
        endYm={endYm}
        selectedTiles={selectedTiles}
      />

      <p className="text-xs text-ink-dim">
        Relative burning activity at VIIRS scale — not fire size, burned area or
        total fires. Numbers carry their label chip: Measured, Estimated,
        Indicative or Provisional.
      </p>
      {mapTiles.length === 0 && !loading && (
        <p className="text-sm text-amber-300">{NO_DATA_MSG}</p>
      )}
    </div>
  );
}

// Keyboard-navigable list of tiles with data for the selected month.
// Arrow keys / typeahead work natively on <select>; picking one inspects it.
function TileList({
  tiles,
  columns,
  geometry,
  valueCol,
  inspected,
  onPick,
}: {
  tiles: { index: number; value: number | null }[];
  columns: string[];
  geometry: TileGeometry[];
  valueCol: TmCol;
  inspected?: number;
  onPick: (idx: number) => void;
}) {
  void columns;
  return (
    <section className="rounded-lg border border-line bg-surface-2 p-4 text-sm">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: INK_DIM }}>
        Tiles with data ({tiles.length.toLocaleString()})
      </h2>
      <label className="mb-1 block text-[11px]" style={{ color: INK_DIM }}>
        Keyboard: focus the map and use arrow keys, or pick a tile here.
      </label>
      <select
        aria-label="Tile list for selected month"
        value={inspected ?? ''}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onPick(v);
        }}
        className="w-full rounded border border-line bg-surface px-2 py-1.5 text-xs text-ink"
        size={1}
      >
        <option value="">— select a tile —</option>
        {tiles.slice(0, 500).map((t) => {
          const g = geometry[t.index];
          const loc = g ? `${g.cy.toFixed(2)}°N ${g.cx.toFixed(2)}°E` : '';
          return (
            <option key={t.index} value={t.index}>
              tile {t.index} · {loc} · {t.value ?? 'gap'} {valueCol} tile-days
            </option>
          );
        })}
      </select>
      {tiles.length > 500 && (
        <p className="mt-1 text-[10px]" style={{ color: INK_DIM }}>
          Showing first 500 of {tiles.length.toLocaleString()} — use arrow keys on the map for the rest.
        </p>
      )}
    </section>
  );
}

// Text-table alternative for the map: summarises the current tile selection.
function SelectionTable({
  selectedTiles,
  rowsForYm,
  columns,
  geometry,
  valueCol,
  ym,
}: {
  selectedTiles: Set<number> | null;
  rowsForYm: Map<number, import('../types').TmCell[]>;
  columns: string[];
  geometry: TileGeometry[];
  valueCol: TmCol;
  ym: number;
}) {
  if (!selectedTiles || selectedTiles.size === 0) return null;
  const idx = columns.indexOf(valueCol);
  const trustI = columns.indexOf('trust');
  const rows = [...selectedTiles]
    .sort((a, b) => a - b)
    .slice(0, 200)
    .map((t) => {
      const g = geometry[t];
      const row = rowsForYm.get(t);
      return {
        tile: t,
        lat: g ? g.cy.toFixed(4) : '',
        lon: g ? g.cx.toFixed(4) : '',
        value: row && idx >= 0 ? row[idx] : null,
        trust: row && trustI >= 0 ? row[trustI] : null,
      };
    });
  return (
    <details className="rounded-lg border border-line bg-surface-2 text-xs">
      <summary className="cursor-pointer px-4 py-2 text-ink-dim hover:text-ink">
        Selection summary — {selectedTiles.size.toLocaleString()} tiles · {ymToLabel(ym)} (text alternative to the map)
      </summary>
      {
        <div className="max-h-64 overflow-auto border-t border-line px-4 py-2">
          <table className="w-full">
            <thead>
              <tr className="text-left text-ink-dim">
                <th className="py-0.5 pr-2">Tile</th>
                <th className="py-0.5 pr-2">Lat</th>
                <th className="py-0.5 pr-2">Lon</th>
                <th className="py-0.5 pr-2 text-right">{valueCol} (tile-days)</th>
                <th className="py-0.5">Trust</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tile} className="border-t" style={{ borderColor: LINE }}>
                  <td className="py-0.5 pr-2 font-mono">{r.tile}</td>
                  <td className="py-0.5 pr-2 font-mono">{r.lat}</td>
                  <td className="py-0.5 pr-2 font-mono">{r.lon}</td>
                  <td className="py-0.5 pr-2 text-right font-mono">{r.value ?? 'gap'}</td>
                  <td className="py-0.5">{typeof r.trust === 'string' ? <LabelChip label={r.trust} /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selectedTiles.size > 200 && (
            <p className="mt-1 text-[10px] text-ink-dim">
              Showing first 200 of {selectedTiles.size.toLocaleString()}.
            </p>
          )}
        </div>
      }
    </details>
  );
}

// Region comparison: two presets side by side on the harmonized series.
function RegionCompare({
  rows,
  regions,
  startYm,
  endYm,
}: {
  rows: import('../types').RegionDailyRow[];
  regions: import('../types').Region[];
  startYm: number;
  endYm: number;
}) {
  const presets = regions.filter((r) => r.kind === 'preset');
  const [a, setA] = useState(presets[0]?.id ?? '');
  const [b, setB] = useState(presets[1]?.id ?? presets[0]?.id ?? '');
  if (presets.length < 2) return null;

  const from = `${ymStr(startYm)}-01`;
  const toYm = ymStr(endYm);
  const forRegion = (id: string) =>
    rows.filter((r) => r.region === id && r.date >= from && r.date.slice(0, 7) <= toYm);
  const labelOf = (id: string) => regions.find((r) => r.id === id)?.label ?? id;

  return (
    <section className="rounded-lg border border-line bg-surface-2 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: INK_DIM }}>
          Compare regions (harmonized)
        </h2>
        {([['A', a, setA], ['B', b, setB]] as const).map(([tag, val, set]) => (
          <label key={tag} className="flex items-center gap-1 text-xs text-ink-dim">
            {tag}
            <select
              value={val}
              onChange={(e) => set(e.target.value)}
              className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink"
            >
              {presets.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <SeriesChartSlot rows={forRegion(a)} title={`${labelOf(a)} — harm tile-days`} />
        <SeriesChartSlot rows={forRegion(b)} title={`${labelOf(b)} — harm tile-days`} />
      </div>
    </section>
  );
}

// GeoJSON upload: Polygon / MultiPolygon / FeatureCollection. Only tiles
// inside loaded regions count; anything else reports the no-data message.
function GeoJsonUpload({
  mapTiles,
  inScope,
  onSelect,
}: {
  mapTiles: TileGeometry[];
  inScope: Set<number> | undefined;
  onSelect: (sel: Set<number>, msg: string | null) => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);

  const polysOf = (gj: unknown): [number, number][][][] => {
    // returns list of polygons, each a list of rings, each ring [lon,lat][]
    const polys: [number, number][][][] = [];
    const pushGeom = (g: Record<string, unknown>) => {
      const t = g.type;
      const c = g.coordinates;
      if (t === 'Polygon' && Array.isArray(c)) polys.push(c as [number, number][][]);
      if (t === 'MultiPolygon' && Array.isArray(c)) polys.push(...(c as [number, number][][][]));
    };
    const root = gj as Record<string, unknown>;
    if (root?.type === 'FeatureCollection' && Array.isArray(root.features)) {
      for (const f of root.features as Record<string, unknown>[]) {
        const geom = f?.geometry as Record<string, unknown> | undefined;
        if (geom) pushGeom(geom);
      }
    } else if (root && typeof root === 'object') {
      pushGeom(root);
    }
    return polys;
  };

  const pipRing = (lon: number, lat: number, ring: [number, number][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const inPoly = (lon: number, lat: number, poly: [number, number][][]) => {
    // outer ring minus holes
    if (!poly[0] || !pipRing(lon, lat, poly[0])) return false;
    for (let i = 1; i < poly.length; i++) if (pipRing(lon, lat, poly[i])) return false;
    return true;
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const gj = JSON.parse(await f.text()) as unknown;
      const polys = polysOf(gj);
      if (!polys.length) {
        setMsg('GeoJSON has no Polygon or MultiPolygon features.');
        onSelect(new Set(), null);
        return;
      }
      const sel = new Set<number>();
      for (const t of mapTiles) {
        if (inScope && !inScope.has(t.index)) continue;
        if (polys.some((p) => inPoly(t.cx, t.cy, p))) sel.add(t.index);
      }
      onSelect(sel, sel.size ? `${sel.size.toLocaleString()} tiles inside uploaded area.` : NO_DATA_MSG);
      setMsg(null);
    } catch {
      setMsg('Could not parse GeoJSON file.');
    }
  };

  return (
    <section className="rounded-lg border border-line bg-surface-2 p-4 text-xs">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-ink-dim">Area tools</h2>
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded border border-line px-3 py-1.5 text-ink-dim hover:border-accent-2 hover:text-ink">
          Upload GeoJSON polygon
          <input type="file" accept=".geojson,.json,application/geo+json" className="hidden" onChange={onFile} />
        </label>
        <span className="text-ink-dim">
          Draw mode: click points on the map, double-click to close. Only tiles inside loaded regions count.
        </span>
      </div>
      {msg && <p className="mt-1 text-amber-300">{msg}</p>}
    </section>
  );
}

// SLOT: teammate-owned climatology panel. Baseline shows monthly p10–p90.
export function ClimatologySlot({
  rows,
  regionId,
}: {
  rows: import('../types').ClimatologyRow[];
  regionId: string;
}) {
  const row = rows.find((r) => r.region === regionId && r.sensor === 'harm' && r.period === 5);
  return (
    <section className="rounded-lg border border-line bg-surface-2 p-4 text-sm">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: INK_DIM }}>
        Climatology (May, harm)
      </h2>
      {row ? (
        <div className="flex justify-between font-mono text-xs">
          <span>p10 {row.p10}</span><span>p25 {row.p25}</span>
          <span className="text-accent-2">p50 {row.p50}</span>
          <span>p75 {row.p75}</span><span>p90 {row.p90}</span>
        </div>
      ) : (
        <p className="text-xs" style={{ color: INK_DIM }}>No climatology loaded.</p>
      )}
      <p className="mt-1 text-[10px]" style={{ color: LINE }}>
        Tile-day units · climatology baseline slot
      </p>
    </section>
  );
}
