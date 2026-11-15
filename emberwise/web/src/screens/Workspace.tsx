import { useEffect, useMemo, useState } from 'react';
import { useApp, ymStr } from '../state';
import {
  loadClimatology,
  loadHourly,
  loadManifest,
  loadRegionDaily,
  loadRegions,
  loadRelaySim,
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
import { BurnCalendar } from '../components/Calendar';
import { RelayTimeline } from '../components/RelayTimeline';
import { aggregateTileMonths } from '../lib/derive';
import { LabelChip } from '../components/LabelChip';
import { Stat } from '../components/primitives';
import { LINE, viridis } from '../theme';

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
  const relayQ = useData(loadRelaySim, []);

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
    setDrawPolygon(false);
    setPolyMsg(
      sel.size
        ? `${sel.size.toLocaleString()} tiles inside polygon ∩ ${region?.label ?? regionId}.`
        : NO_DATA_MSG
    );
  };

  const fileList = useMemo(() => [...files.values()], [files]);

  // Calendar aggregates: res-6 tile rows inside the selected region.
  const regionScope6 = useMemo(() => {
    const list = region?.tiles_in_scope?.['6'];
    return list && list.length ? new Set(list) : null;
  }, [region]);
  const monthlyAgg = useMemo(
    () => aggregateTileMonths(fileList, regionScope6),
    [fileList, regionScope6]
  );

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

  const monthStats = useMemo(() => {
    let max = 0;
    let sum = 0;
    let n = 0;
    for (const t of tilesWithData) {
      if (t.value !== null) {
        n += 1;
        sum += t.value;
        if (t.value > max) max = t.value;
      }
    }
    return { max, mean: n ? sum / n : null };
  }, [tilesWithData]);

  const loading = regionsQ.loading || geomQ.loading || filesLoading;
  const error = regionsQ.error || geomQ.error || filesError;
  const retryAll = () => {
    regionsQ.retry(); geomQ.retry(); dailyQ.retry(); climQ.retry(); hourlyQ.retry();
    setFilesTick((t) => t + 1);
  };

  return (
    <div className="space-y-4">
      <header className="rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-label">Workspace</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Burn map</h1>
          <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink-dim">
            One tile grid, one harmonized scale. Pick an area and period, then inspect a tile or
            draw an area of interest.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line/70 bg-surface/40 px-2.5 py-1 text-[11px] text-ink-dim">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent-2" />
            {region?.label ?? regionId}
          </span>
          <span className="rounded-full border border-line/70 bg-surface/40 px-2.5 py-1 font-mono text-[11px] text-ink-dim">
            {ymStr(startYm)} → {ymStr(endYm)}
          </span>
          <LabelChip label={regionTrust} />
        </div>
      </header>

      <AreaPicker />

      {/* at-a-glance numbers for the month on the map */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat
          label="Month shown"
          value={<span className="font-mono">{ymToLabel(clampedSelected)}</span>}
          hint={`${SENSOR_MODE_LABEL[sensor]} scale`}
        />
        <Stat
          label="Tiles with data"
          value={tilesWithData.length.toLocaleString()}
          hint={`of ${mapTiles.length.toLocaleString()} mapped`}
        />
        <Stat
          label="Peak tile-days"
          value={monthStats.max.toLocaleString()}
          hint={monthStats.mean !== null ? `mean ${monthStats.mean.toFixed(1)}` : 'no values'}
        />
        <Stat
          label="Selected tiles"
          value={(selectedTiles?.size ?? 0).toLocaleString()}
          hint={selectedTiles ? 'drag or polygon selection' : 'none selected'}
        />
      </div>

      {/* era banner */}
      <div className="card flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        <span className="section-label">Era</span>
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
      <section className="card p-3.5 sm:p-4">
        <div className="flex flex-col gap-3.5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div>
              <span className="field-label mb-1.5 block">Sensor mode</span>
              <div role="radiogroup" aria-label="Sensor mode" className="seg">
                {SENSOR_MODES.map((s) => (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={sensor === s.id}
                    onClick={() => setSensor(s.id)}
                    className="seg-item"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="map-month" className="field-label mb-1.5 block">
                Month
              </label>
              <select
                id="map-month"
                value={ymToLabel(clampedSelected)}
                onChange={(e) => {
                  const [y, m] = e.target.value.split('-').map(Number);
                  setSelectedYm(y * 12 + m - 1);
                }}
                className="control w-auto"
              >
                {monthOptions.map((ym) => (
                  <option key={ym} value={ymToLabel(ym)}>
                    {ymToLabel(ym)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="field-label mb-1.5 block">Min tile-days</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  aria-label="Minimum tile-days"
                  min={0}
                  max={20}
                  step={0.5}
                  value={minValue}
                  onChange={(e) => setMinValue(Number(e.target.value))}
                  className="range w-28"
                  style={{
                    background: `linear-gradient(90deg, #f6a544 ${(minValue / 20) * 100}%, #2a3550 ${(minValue / 20) * 100}%)`,
                  }}
                />
                <span className="min-w-9 rounded-md border border-line/70 bg-surface/50 px-1.5 py-0.5 text-center font-mono text-[11px] text-ink">
                  {minValue}
                </span>
              </div>
            </div>
            {res5Available && (
              <div>
                <span className="field-label mb-1.5 block">Map resolution</span>
                <div role="radiogroup" aria-label="Map resolution" className="seg">
                  {([6, 5] as const).map((r) => (
                    <button
                      key={r}
                      role="radio"
                      aria-checked={mapRes === r}
                      onClick={() => setResPref(r)}
                      className="seg-item"
                    >
                      res {r}
                      {r === 6 && autoFallback ? ' (auto→5)' : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <button
              onClick={() => {
                if (drawPolygon) {
                  setDrawPolygon(false);
                } else {
                  setDrawPolygon(true);
                  setPolygon(null);
                  setSelectedTiles(null);
                  setPolyMsg(null);
                }
              }}
              aria-pressed={drawPolygon}
              className={`btn btn-sm ${drawPolygon ? 'btn-primary' : 'btn-ghost'}`}
            >
              {drawPolygon ? 'Finish polygon (dbl-click)' : 'Draw polygon'}
            </button>
            {selectedTiles && (
              <button
                onClick={() => {
                  setSelectedTiles(null);
                  setPolygon(null);
                  setPolyMsg(null);
                }}
                className="btn btn-ghost btn-sm text-accent-2"
              >
                Clear selection ({selectedTiles.size.toLocaleString()} tiles)
              </button>
            )}
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-dim">
          <span>Tiles below the threshold are drawn as gaps. Missing data is never zero.</span>
          {autoFallback && (
            <span className="text-amber-300">
              auto: res-6 payload over budget ({res6Count.toLocaleString()} tiles)
            </span>
          )}
        </div>
      </section>

      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <button onClick={retryAll} className="btn btn-ghost btn-sm">
            Retry
          </button>
        </div>
      )}
      {polyMsg && <p className="text-sm text-accent-2">{polyMsg}</p>}

      {/* map + side panel */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 px-4 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 className="card-title">Burn map</h2>
              <span className="font-mono text-[11px] text-ink-dim">
                {ymToLabel(clampedSelected)} · res {mapRes}
              </span>
            </div>
            <span className="text-[11px] text-ink-dim">
              {tilesWithData.length.toLocaleString()} tiles with data
              {selectedTiles ? ` · ${selectedTiles.size.toLocaleString()} selected` : ''}
            </span>
          </div>
          <div className="relative h-[360px] sm:h-[460px] lg:h-[600px]">
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
            {loading && (
              <div className="absolute inset-0 grid place-items-center text-sm text-ink-dim">
                Loading tiles and monthly data…
              </div>
            )}
            {!loading && !error && (
              <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-line/70 bg-surface/85 px-2.5 py-2 text-[10px] text-ink-dim backdrop-blur">
                <span className="mb-1 block font-semibold text-ink">tile-days</span>
                <span
                  className="inline-block h-2.5 w-36 rounded"
                  style={{
                    background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1]
                      .map((t) => viridis(t))
                      .join(', ')})`,
                  }}
                />
                <span className="mt-0.5 flex justify-between">
                  <span>0</span>
                  <span>max</span>
                </span>
                <div className="mt-1.5 flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: '#3a4152' }}
                    />
                    zero
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: '#20263a' }}
                    />
                    gap / filtered
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>
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

      {/* summary — every number carries a label chip */}
      <div className="card flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[11px] text-ink-dim">
        <span className="font-semibold text-ink">{SENSOR_MODE_LABEL[sensor]} tile-days</span>
        <LabelChip label={regionTrust} />
        <span>region trust · {ymToLabel(clampedSelected)}</span>
        <span className="ml-auto font-mono">
          {mapRes === 6 ? 'res 6' : 'res 5'} · {mapTiles.length.toLocaleString()} mapped
        </span>
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
      <SeriesChartSlot
        rows={dailyRows}
        title={`Daily harmonized burning tile-days — ${region?.label ?? regionId}`}
        caption="Range of yearly ratios, widened by tested error; not a confidence interval. Shaded bands mark the sensor eras; gaps in the line are days without a usable observation."
      />

      <BurnCalendar
        months={monthlyAgg}
        selectedYm={clampedSelected}
        onPick={(ym) => setSelectedYm(ym)}
        regionLabel={region?.label ?? regionId}
        eras={eras}
        loading={filesLoading}
        error={filesError}
        onRetry={() => setFilesTick((t) => t + 1)}
      />

      <RelayTimeline
        sim={relayQ.data}
        loading={relayQ.loading}
        error={relayQ.error}
        onRetry={relayQ.retry}
      />

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

      <p className="px-1 text-[11px] leading-relaxed text-ink-dim">
        Relative burning activity at VIIRS scale — not fire size, burned area or total fires.
        Numbers carry their label chip: Measured, Estimated, Indicative or Provisional.
      </p>
      {mapTiles.length === 0 && !loading && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-200">
          {NO_DATA_MSG}
        </p>
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
    <section className="card p-4 text-sm">
      <header className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 className="section-label">Tiles with data</h2>
        <span className="font-mono text-[10.5px] text-ink-dim">{tiles.length.toLocaleString()}</span>
      </header>
      <label htmlFor="tile-select" className="mb-1 block text-[10.5px] text-ink-dim">
        Keyboard: focus the map and use arrow keys, or pick a tile here.
      </label>
      <select
        id="tile-select"
        aria-label="Tile list for selected month"
        value={inspected ?? ''}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onPick(v);
        }}
        className="control text-xs"
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
        <p className="mt-1 text-[10px] text-ink-dim">
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
    <details className="card overflow-hidden text-xs">
      <summary className="cursor-pointer px-4 py-2.5 text-ink-dim transition hover:text-ink">
        Selection summary — {selectedTiles.size.toLocaleString()} tiles · {ymToLabel(ym)} (text alternative to the map)
      </summary>
      {
        <div className="max-h-64 overflow-auto border-t border-line/70 px-4 py-2">
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
  const [aSel, setA] = useState<string | null>(null);
  const [bSel, setB] = useState<string | null>(null);
  if (presets.length < 2) return null;

  // Regions arrive asynchronously, so resolve the selections against the
  // current list instead of freezing the initial (empty) value.
  const a = presets.some((r) => r.id === aSel) ? (aSel as string) : presets[0].id;
  const b = presets.some((r) => r.id === bSel)
    ? (bSel as string)
    : presets[1]?.id ?? presets[0].id;

  const from = `${ymStr(startYm)}-01`;
  const toYm = ymStr(endYm);
  const forRegion = (id: string) =>
    rows.filter((r) => r.region === id && r.date >= from && r.date.slice(0, 7) <= toYm);
  const labelOf = (id: string) => regions.find((r) => r.id === id)?.label ?? id;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="section-label">Compare regions (harmonized)</h2>
        <div className="flex flex-wrap items-center gap-2">
          {([['A', a, setA], ['B', b, setB]] as const).map(([tag, val, set]) => (
            <label key={tag} className="flex items-center gap-1.5 text-[11px] text-ink-dim">
              <span className="font-mono text-ink">{tag}</span>
              <select
                value={val}
                onChange={(e) => set(e.target.value)}
                className="control w-auto text-xs"
              >
                {presets.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <SeriesChartSlot rows={forRegion(a)} height={180} title={`${labelOf(a)} — harm tile-days`} />
        <SeriesChartSlot rows={forRegion(b)} height={180} title={`${labelOf(b)} — harm tile-days`} />
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
    <section className="card p-4 text-xs">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="card-title">Area tools</h2>
        <span className="text-[10.5px] text-ink-dim">GeoJSON · polygon · rectangle</span>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn btn-ghost btn-sm cursor-pointer">
          Upload GeoJSON polygon
          <input type="file" accept=".geojson,.json,application/geo+json" className="hidden" onChange={onFile} />
        </label>
        <span className="max-w-xl text-[10.5px] leading-relaxed text-ink-dim">
          Draw mode: click points on the map, double-click to close. Only tiles inside loaded
          regions count.
        </span>
      </div>
      {msg && <p className="mt-1.5 text-[11px] text-amber-300">{msg}</p>}
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
  const pos = (v: number | null) => {
    if (!row || v === null || row.p10 === null || row.p90 === null) return null;
    const span = row.p90 - row.p10;
    return span > 0 ? ((v - row.p10) / span) * 100 : 50;
  };
  const pcts: [string, number | null][] = row
    ? [
        ['p10', row.p10],
        ['p25', row.p25],
        ['p50', row.p50],
        ['p75', row.p75],
        ['p90', row.p90],
      ]
    : [];
  return (
    <section className="card p-4 text-sm">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="section-label">Climatology · May</h2>
        <span className="text-[10px] text-ink-dim">harm scale</span>
      </header>
      {row ? (
        <div>
          <div className="relative h-8">
            <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-surface-3" />
            {pos(row.p10) !== null && pos(row.p90) !== null && (
              <div
                className="absolute top-3 h-2 rounded-full bg-accent-2/25"
                style={{
                  left: `${pos(row.p10)}%`,
                  width: `${Math.max(0, (pos(row.p90) ?? 0) - (pos(row.p10) ?? 0))}%`,
                }}
              />
            )}
            {pos(row.p25) !== null && pos(row.p75) !== null && (
              <div
                className="absolute top-2 h-4 rounded bg-accent-2/45"
                style={{
                  left: `${pos(row.p25)}%`,
                  width: `${Math.max(0, (pos(row.p75) ?? 0) - (pos(row.p25) ?? 0))}%`,
                }}
              />
            )}
            {pos(row.p50) !== null && (
              <div
                className="absolute top-1 h-6 w-0.5 -translate-x-1/2 rounded bg-ink"
                style={{ left: `${pos(row.p50)}%` }}
              />
            )}
          </div>
          <div className="mt-1 grid grid-cols-5 gap-1 text-center font-mono text-[9.5px] text-ink-dim">
            {pcts.map(([k, v]) => (
              <span key={k} className={k === 'p50' ? 'text-ink' : undefined}>
                {k}
                <br />
                {v ?? '—'}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-ink-dim">No climatology loaded.</p>
      )}
      <p className="mt-2 text-[10px] text-ink-dim">Tile-day units · baseline for May.</p>
    </section>
  );
}
