import { useEffect, useMemo, useState } from 'react';
import { useApp, ymStr } from '../state';
import {
  loadClimatology,
  loadHourly,
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
import { LabelChip } from '../components/LabelChip';
import { INK_DIM, LINE, viridis } from '../theme';

const NO_DATA_MSG = 'No data loaded here. Choose a preset or a loaded region.';

export function Workspace() {
  const {
    regionId, startYm, endYm, sensor, setSensor,
    selectedYm, setSelectedYm, selectedTiles, setSelectedTiles,
    inspected,
  } = useApp();
  const [minValue, setMinValue] = useState(0);

  const regionsQ = useData(loadRegions, []);
  const geomQ = useData(loadTileGeometry, []);
  const dailyQ = useData(loadRegionDaily, []);
  const climQ = useData(loadClimatology, []);
  const hourlyQ = useData(loadHourly, []);

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
  }, [yearsKey]);

  const region = regionsQ.data?.regions.find((r) => r.id === regionId);

  // tiles in scope. Prefer res 6; if the region is heavy (>6000 res-6 tiles)
  // fall back to res-5 geometry (requires tile_month rows at res 5).
  const mapTiles = useMemo<TileGeometry[]>(() => {
    const all = geomQ.data?.tile_geometry ?? [];
    if (!region) return [];
    const heavy =
      (region.tiles_in_scope?.['6']?.length ?? 0) > 6000;
    const resKey = heavy ? '5' : '6';
    const idxs = region.tiles_in_scope?.[resKey];
    if (idxs && idxs.length) {
      const set = new Set(idxs);
      return all.filter((g) => g.res === Number(resKey) && set.has(g.index));
    }
    const [w, s, e, n] = region.bbox;
    return all.filter(
      (g) => g.res === Number(resKey) && g.cx >= w && g.cx <= e && g.cy >= s && g.cy <= n
    );
  }, [geomQ.data, region]);

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

  // era banner: eras overlapping selected range
  const eras = useMemo(
    () =>
      ERAS.filter((e) => {
        const [sy, sm] = e.start.split('-').map(Number);
        const sYm = sy * 12 + sm - 1;
        const [ey, em] = (e.end || '2100-01').split('-').map(Number);
        const eYm = ey * 12 + em - 1;
        return startYm <= eYm && endYm >= sYm;
      }),
    [startYm, endYm]
  );

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

  const loading = regionsQ.loading || geomQ.loading || filesLoading;
  const error = regionsQ.error || geomQ.error || filesError;

  return (
    <div className="space-y-4">
      <AreaPicker />

      {/* era banner */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-dim">Era</span>
        {eras.map((e) => (
          <span key={e.id} className="flex items-center gap-2">
            <LabelChip label={e.trust} />
            <span className="text-xs text-ink">{e.name}</span>
          </span>
        ))}
        <span className="text-[11px] text-ink-dim">
          {eras[eras.length - 1]?.note}
        </span>
      </div>

      {/* sensor mode + month + threshold */}
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
        {selectedTiles && (
          <button
            onClick={() => setSelectedTiles(null)}
            className="rounded border border-accent-2 px-2 py-1 text-xs text-accent-2"
          >
            Clear selection ({selectedTiles.size.toLocaleString()} tiles)
          </button>
        )}
      </div>

      {error && <p className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
      {loading && <p className="text-sm text-ink-dim">Loading tiles and monthly data…</p>}

      {/* map + side panel */}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="h-[480px] overflow-hidden rounded-lg border border-line bg-surface-2 lg:h-[560px]">
          {!loading && !error && (
            <HexMap
              tiles={mapTiles}
              tileMonth={monthFile}
              columns={columns}
              valueCol={valueCol}
              selectedYm={clampedSelected}
              minValue={minValue}
            />
          )}
        </div>
        <div className="space-y-4">
          <InspectPanel
            target={inspected}
            rowsForYm={rowsForYm}
            columns={columns}
            geometry={geomQ.data?.tile_geometry ?? []}
            valueCol={valueCol}
          />
          {/* SLOT: teammate drops in the real dial here */}
          <FireClockDialSlot hourly={hourlyQ.data} />
          {/* SLOT: teammate drops in climatology panel here */}
          <ClimatologySlot rows={climQ.data?.rows ?? []} regionId={regionId} />
        </div>
      </div>

      {/* legend */}
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 py-2 text-[11px] text-ink-dim">
        <span>{SENSOR_MODE_LABEL[sensor]} tile-days</span>
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

      {/* SLOT: teammate series chart */}
      <SeriesChartSlot rows={dailyRows} title={`Daily harmonized burning tile-days — ${region?.label ?? regionId}`} />

      <CsvPanel
        region={region}
        files={fileList}
        geometry={geomQ.data?.tile_geometry ?? []}
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
      {NO_DATA_MSG && mapTiles.length === 0 && !loading && (
        <p className="text-sm text-amber-300">{NO_DATA_MSG}</p>
      )}
    </div>
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
