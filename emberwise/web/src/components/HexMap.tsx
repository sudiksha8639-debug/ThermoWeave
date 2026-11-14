import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GAP_COLOR, NO_DATA_COLOR, viridis } from '../theme';
import { tmNum, type TileGeometry, type TileMonthFile, type TmCell, type TmCol } from '../types';
import { useApp } from '../state';
import { ymToLabel } from '../types';

interface Props {
  tiles: TileGeometry[]; // res-6 tiles in scope for the region
  tileMonth: TileMonthFile | null; // loaded year file containing selectedYm
  columns: string[];
  valueCol: TmCol;
  selectedYm: number;
  minValue?: number; // tiles below this are drawn as gaps
}

interface ProjTile {
  g: TileGeometry;
  cx: number;
  cy: number;
  pts: Float32Array; // flattened projected vertices
}

export function HexMap({ tiles, tileMonth, columns, valueCol, selectedYm, minValue = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x0: number; y0: number; x1: number; y1: number; moved: boolean } | null>(null);
  const [dragBox, setDragBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const { selectedTiles, setSelectedTiles, setInspected, sensor } = useApp();

  // month rows keyed by tile index for the selected month
  const monthRows = useMemo(() => {
    const m = new Map<number, TmCell[]>();
    if (!tileMonth) return m;
    for (const row of tileMonth.data) {
      const ym = row[columns.indexOf('ym')];
      if (ym === selectedYm) m.set(row[columns.indexOf('tile')] as number, row);
    }
    return m;
  }, [tileMonth, columns, selectedYm]);

  // value lookup + max for normalization
  const { valueOf, maxV } = useMemo(() => {
    const vo = new Map<number, number | null>();
    let max = 0;
    for (const [tile, row] of monthRows) {
      const v = tmNum(row, columns, valueCol);
      vo.set(tile, v);
      if (v !== null && v > max) max = v;
    }
    return { valueOf: vo, maxV: max };
  }, [monthRows, columns, valueCol]);

  // projection: equirectangular fit to tile bbox
  const proj = useMemo(() => {
    if (tiles.length === 0) return null;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const t of tiles) {
      for (const [lon, lat] of t.vertices) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    const lat0 = (minLat + maxLat) / 2;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    return {
      minX: minLon * kx, minY: minLat, maxX: maxLon * kx, maxY: maxLat,
      kx, lat0,
      toXY: (lon: number, lat: number): [number, number] => [lon * kx, lat],
      toLL: (x: number, y: number): [number, number] => [x / kx, y],
    };
  }, [tiles]);

  const projected = useMemo<ProjTile[]>(() => {
    if (!proj || size.w === 0) return [];
    const pad = 14;
    const bw = proj.maxX - proj.minX || 1e-6;
    const bh = proj.maxY - proj.minY || 1e-6;
    const scale = Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh);
    const ox = (size.w - bw * scale) / 2 - proj.minX * scale;
    const oy = (size.h - bh * scale) / 2 - proj.minY * scale;
    return tiles.map((g) => {
      const pts = new Float32Array(g.vertices.length * 2);
      let sx = 0, sy = 0;
      for (let i = 0; i < g.vertices.length; i++) {
        const [x, y] = proj.toXY(g.vertices[i][0], g.vertices[i][1]);
        pts[i * 2] = x * scale + ox;
        pts[i * 2 + 1] = y * scale + oy;
        sx += pts[i * 2]; sy += pts[i * 2 + 1];
      }
      const n = g.vertices.length;
      return { g, cx: sx / n, cy: sy / n, pts };
    });
  }, [tiles, proj, size]);

  // resize observer
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(50, r.width), h: Math.max(50, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || projected.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const sqrtScale = Math.sqrt(maxV) || 1;
    const isSelected = (idx: number) => selectedTiles?.has(idx) ?? false;

    for (const t of projected) {
      const v = valueOf.get(t.g.index);
      let fill: string;
      if (v === null || v === undefined || v < minValue) fill = GAP_COLOR;
      else if (v === 0) fill = NO_DATA_COLOR;
      else fill = viridis(Math.min(1, Math.sqrt(v) / sqrtScale));

      ctx.beginPath();
      ctx.moveTo(t.pts[0], t.pts[1]);
      for (let i = 1; i < t.pts.length / 2; i++) ctx.lineTo(t.pts[i * 2], t.pts[i * 2 + 1]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (isSelected(t.g.index)) {
        ctx.strokeStyle = '#5ec8c0';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // drag rectangle overlay
    if (dragBox) {
      ctx.strokeStyle = '#f0a03c';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(
        Math.min(dragBox.x0, dragBox.x1),
        Math.min(dragBox.y0, dragBox.y1),
        Math.abs(dragBox.x1 - dragBox.x0),
        Math.abs(dragBox.y1 - dragBox.y0)
      );
      ctx.setLineDash([]);
    }
  }, [projected, valueOf, maxV, selectedTiles, dragBox, size, minValue]);

  useEffect(() => {
    draw();
  }, [draw]);

  const toLocal = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = toLocal(e);
    drag.current = { x0: x, y0: y, x1: x, y1: y, moved: false };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = toLocal(e);
    d.x1 = x; d.y1 = y;
    if (Math.hypot(x - d.x0, y - d.y0) > 4) d.moved = true;
    setDragBox(d.moved ? { x0: d.x0, y0: d.y0, x1: x, y1: y } : null);
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDragBox(null);
    if (!d) return;
    const { x, y } = toLocal(e);
    if (!d.moved) {
      // click → inspect nearest tile
      let best: ProjTile | null = null;
      let bd = Infinity;
      for (const t of projected) {
        const dd = (t.cx - x) ** 2 + (t.cy - y) ** 2;
        if (dd < bd) { bd = dd; best = t; }
      }
      if (best && bd < 40 * 40) setInspected({ tile: best.g.index, ym: selectedYm });
      else setInspected(null);
      return;
    }
    // drag → rectangle selection in lon/lat space
    if (!proj) return;
    const pad = 14;
    const bw = proj.maxX - proj.minX || 1e-6;
    const bh = proj.maxY - proj.minY || 1e-6;
    const scale = Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh);
    const ox = (size.w - bw * scale) / 2 - proj.minX * scale;
    const oy = (size.h - bh * scale) / 2 - proj.minY * scale;
    const xToLon = (px: number) => (px - ox) / scale / proj.kx;
    const yToLat = (py: number) => (py - oy) / scale;
    const x0 = xToLon(Math.min(d.x0, x)), x1 = xToLon(Math.max(d.x0, x));
    const y0 = yToLat(Math.min(d.y0, y)), y1 = yToLat(Math.max(d.y0, y));
    const sel = new Set<number>();
    for (const t of projected) {
      const lon = t.g.cx, lat = t.g.cy;
      if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) sel.add(t.g.index);
    }
    setSelectedTiles(sel.size ? sel : null);
    setInspected(null);
  };

  const monthLabel = ymToLabel(selectedYm);
  const shown = valueOf.size;

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        className="cursor-crosshair"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        role="img"
        aria-label={`Hex map of burning tile-days for ${monthLabel}, sensor mode ${sensor}`}
      />
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-surface/80 px-2 py-1 text-[11px] text-ink-dim">
        {monthLabel} · {shown.toLocaleString()} tiles with data
        {selectedTiles && ` · ${selectedTiles.size.toLocaleString()} selected`}
      </div>
      {tiles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-dim">
          No data loaded here. Choose a preset or a loaded region.
        </div>
      )}
    </div>
  );
}
