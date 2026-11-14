import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GAP_COLOR, NO_DATA_COLOR, viridis } from '../theme';
import { tmNum, type TileGeometry, type TileMonthFile, type TmCell, type TmCol } from '../types';
import { useApp } from '../state';
import { ymToLabel } from '../types';

interface Props {
  tiles: TileGeometry[]; // tiles in scope for the region at the chosen res
  tileMonth: TileMonthFile | null; // loaded year file containing selectedYm
  columns: string[];
  valueCol: TmCol;
  selectedYm: number;
  minValue?: number; // tiles below this are drawn as gaps
  /** Optional draw-polygon mode (stretch feature). */
  drawPolygon?: boolean;
  onPolygonComplete?: (lonLat: [number, number][]) => void;
  polygonPoints?: [number, number][] | null;
}

interface ProjTile {
  g: TileGeometry;
  cx: number;
  cy: number;
  pts: Float32Array; // flattened projected vertices
  path: Path2D; // cached geometry — colours change per month, shapes don't
}

// Uniform-grid spatial index over projected tiles for O(1)-ish hit testing.
class TileGrid {
  private cells = new Map<string, ProjTile[]>();
  private cell: number;
  private minX = Infinity;
  private minY = Infinity;

  constructor(tiles: ProjTile[], w: number, h: number) {
    this.cell = Math.max(12, Math.sqrt((w * h) / Math.max(1, tiles.length)));
    for (const t of tiles) {
      if (t.cx < this.minX) this.minX = t.cx;
      if (t.cy < this.minY) this.minY = t.cy;
      const k = this.key(t.cx, t.cy);
      const arr = this.cells.get(k);
      if (arr) arr.push(t);
      else this.cells.set(k, [t]);
    }
  }

  private key(x: number, y: number): string {
    return `${Math.floor((x - this.minX) / this.cell)},${Math.floor((y - this.minY) / this.cell)}`;
  }

  /** Tiles whose centre lies within `radius` px of (x, y). */
  query(x: number, y: number, radius: number): ProjTile[] {
    const out: ProjTile[] = [];
    const r = radius + this.cell; // centres may sit in neighbouring cells
    const x0 = Math.floor((x - r - this.minX) / this.cell);
    const x1 = Math.floor((x + r - this.minX) / this.cell);
    const y0 = Math.floor((y - r - this.minY) / this.cell);
    const y1 = Math.floor((y + r - this.minY) / this.cell);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const arr = this.cells.get(`${ix},${iy}`);
        if (arr) out.push(...arr);
      }
    }
    return out;
  }
}

export function HexMap({
  tiles,
  tileMonth,
  columns,
  valueCol,
  selectedYm,
  minValue = 0,
  drawPolygon = false,
  onPolygonComplete,
  polygonPoints = null,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x0: number; y0: number; x1: number; y1: number; moved: boolean } | null>(null);
  const [dragBox, setDragBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const polyDraft = useRef<[number, number][] | null>(null); // screen-space draft points
  const [polyScreen, setPolyScreen] = useState<[number, number][] | null>(null);
  const rafRef = useRef<number | null>(null);
  const frameEma = useRef<number | null>(null);
  const lastLog = useRef(-Infinity);
  const { selectedTiles, setSelectedTiles, setInspected, sensor, inspected } = useApp();

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

  const fit = useMemo(() => {
    if (!proj || size.w === 0) return null;
    const pad = 14;
    const bw = proj.maxX - proj.minX || 1e-6;
    const bh = proj.maxY - proj.minY || 1e-6;
    const scale = Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh);
    const ox = (size.w - bw * scale) / 2 - proj.minX * scale;
    const oy = (size.h - bh * scale) / 2 - proj.minY * scale;
    return { scale, ox, oy, pad };
  }, [proj, size]);

  const projected = useMemo<ProjTile[]>(() => {
    if (!proj || !fit) return [];
    const { scale, ox, oy } = fit;
    return tiles.map((g) => {
      const pts = new Float32Array(g.vertices.length * 2);
      const path = new Path2D();
      let sx = 0, sy = 0;
      for (let i = 0; i < g.vertices.length; i++) {
        const [x, y] = proj.toXY(g.vertices[i][0], g.vertices[i][1]);
        const px = x * scale + ox;
        const py = y * scale + oy;
        pts[i * 2] = px;
        pts[i * 2 + 1] = py;
        if (i === 0) path.moveTo(px, py);
        else path.lineTo(px, py);
        sx += px; sy += py;
      }
      path.closePath();
      const n = g.vertices.length;
      return { g, cx: sx / n, cy: sy / n, pts, path };
    });
  }, [tiles, proj, fit]);

  const grid = useMemo(
    () => (size.w > 0 ? new TileGrid(projected, size.w, size.h) : null),
    [projected, size]
  );

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
    const t0 = performance.now();
    const canvas = canvasRef.current;
    if (!canvas || projected.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
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

      ctx.fillStyle = fill;
      ctx.fill(t.path);
      if (isSelected(t.g.index)) {
        ctx.strokeStyle = '#5ec8c0';
        ctx.lineWidth = 1.5;
        ctx.stroke(t.path);
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

    // committed polygon (lon/lat → screen)
    const drawPoly = (ptsLL: [number, number][], close: boolean, draft?: [number, number][]) => {
      const all = [...ptsLL, ...(draft ?? [])];
      if (all.length < 2) return;
      ctx.strokeStyle = '#5ec8c0';
      ctx.fillStyle = 'rgba(94,200,192,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      all.forEach(([lon, lat], i) => {
        const [x, y] = proj!.toXY(lon, lat);
        const px = x * fit!.scale + fit!.ox;
        const py = y * fit!.scale + fit!.oy;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      if (close) {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();
      for (const [lon, lat] of ptsLL) {
        const [X, Y] = proj!.toXY(lon, lat);
        ctx.beginPath();
        ctx.arc(X * fit!.scale + fit!.ox, Y * fit!.scale + fit!.oy, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#5ec8c0';
        ctx.fill();
      }
    };
    if (polygonPoints && polygonPoints.length >= 3) drawPoly(polygonPoints, true);
    if (polyScreen && polyScreen.length >= 2) {
      // draft stored in screen coords — draw directly
      ctx.strokeStyle = '#5ec8c0';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      polyScreen.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const ms = performance.now() - t0;
    frameEma.current = frameEma.current === null ? ms : frameEma.current * 0.9 + ms * 0.1;
    const now = performance.now();
    if (now - lastLog.current > 2000) {
      lastLog.current = now;
      console.info(
        `[EMBERWISE] HexMap draw: ${projected.length.toLocaleString()} tiles, ~${frameEma.current.toFixed(1)} ms/frame (ema)`
      );
    }
  }, [projected, valueOf, maxV, selectedTiles, dragBox, size, minValue, polygonPoints, polyScreen, proj, fit]);

  // draw on change, coalesced through requestAnimationFrame
  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  const toLocal = (e: React.PointerEvent | React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const screenToLonLat = (px: number, py: number): [number, number] | null => {
    if (!proj || !fit) return null;
    const xProj = (px - fit.ox) / fit.scale;
    const yProj = (py - fit.oy) / fit.scale;
    return [xProj / proj.kx, yProj];
  };

  const hitTile = (x: number, y: number): ProjTile | null => {
    if (!grid) {
      // fallback linear scan
      let best: ProjTile | null = null;
      let bd = Infinity;
      for (const t of projected) {
        const dd = (t.cx - x) ** 2 + (t.cy - y) ** 2;
        if (dd < bd) { bd = dd; best = t; }
      }
      return best && bd < 40 * 40 ? best : null;
    }
    let best: ProjTile | null = null;
    let bd = Infinity;
    for (const t of grid.query(x, y, 40)) {
      const dd = (t.cx - x) ** 2 + (t.cy - y) ** 2;
      if (dd < bd) { bd = dd; best = t; }
    }
    return best && bd < 40 * 40 ? best : null;
  };

  const onDown = (e: React.PointerEvent) => {
    if (drawPolygon) {
      const { x, y } = toLocal(e);
      const ll = screenToLonLat(x, y);
      if (ll) {
        polyDraft.current = [...(polyDraft.current ?? []), ll];
        setPolyScreen([...(polyScreen ?? []), [x, y]]);
      }
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = toLocal(e);
    drag.current = { x0: x, y0: y, x1: x, y1: y, moved: false };
  };

  const onMove = (e: React.PointerEvent) => {
    if (drawPolygon) return;
    const d = drag.current;
    if (!d) return;
    const { x, y } = toLocal(e);
    d.x1 = x; d.y1 = y;
    if (Math.hypot(x - d.x0, y - d.y0) > 4) d.moved = true;
    setDragBox(d.moved ? { x0: d.x0, y0: d.y0, x1: x, y1: y } : null);
  };

  const finishPolygon = useCallback(() => {
    const pts = polyDraft.current;
    polyDraft.current = null;
    setPolyScreen(null);
    if (pts && pts.length >= 3 && onPolygonComplete) onPolygonComplete(pts);
  }, [onPolygonComplete]);

  const onUp = (e: React.PointerEvent) => {
    if (drawPolygon) {
      // double-click finishes (handled by onDoubleClick); single click adds a point
      return;
    }
    const d = drag.current;
    drag.current = null;
    setDragBox(null);
    if (!d) return;
    const { x, y } = toLocal(e);
    if (!d.moved) {
      const best = hitTile(x, y);
      if (best) setInspected({ tile: best.g.index, ym: selectedYm });
      else setInspected(null);
      return;
    }
    // drag → rectangle selection in lon/lat space
    if (!proj || !fit) return;
    const xToLon = (px: number) => (px - fit.ox) / fit.scale / proj.kx;
    const yToLat = (py: number) => (py - fit.oy) / fit.scale;
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

  const onDoubleClick = () => {
    if (drawPolygon) finishPolygon();
  };

  // keyboard navigation: arrow keys cycle tiles with data (sorted by index),
  // Enter inspects, Escape clears. Canvas is focusable (tabIndex=0).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (drawPolygon) {
      if (e.key === 'Escape') {
        polyDraft.current = null;
        setPolyScreen(null);
      }
      return;
    }
    const ordered = orderedTiles(projected, valueOf);
    if (ordered.length === 0) return;
    const cur = inspectedTileIndex(ordered, inspected?.tile);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % ordered.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (cur - 1 + ordered.length) % ordered.length;
    else if (e.key === 'Enter' && cur >= 0) {
      setInspected({ tile: ordered[cur].g.index, ym: selectedYm });
      return;
    } else if (e.key === 'Escape') {
      setInspected(null);
      return;
    } else return;
    e.preventDefault();
    setInspected({ tile: ordered[next].g.index, ym: selectedYm });
  };

  const monthLabel = ymToLabel(selectedYm);
  const shown = valueOf.size;

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        className={`cursor-crosshair ${drawPolygon ? 'cursor-cell' : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="application"
        aria-label={
          drawPolygon
            ? 'Polygon drawing mode: click to add vertices, double-click or press Enter to finish, Escape to cancel'
            : `Hex map of burning tile-days for ${monthLabel}, sensor mode ${sensor}. Arrow keys move between tiles, Enter inspects.`
        }
      />
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-surface/80 px-2 py-1 text-[11px] text-ink-dim">
        {monthLabel} · {shown.toLocaleString()} tiles with data
        {selectedTiles && ` · ${selectedTiles.size.toLocaleString()} selected`}
        {drawPolygon && ' · click points, double-click to close'}
      </div>
      {tiles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-dim">
          No data loaded here. Choose a preset or a loaded region.
        </div>
      )}
    </div>
  );
}

// Tiles ordered for keyboard navigation: tiles with data, sorted by index.
function orderedTiles(projected: ProjTile[], valueOf: Map<number, number | null>): ProjTile[] {
  return projected
    .filter((t) => valueOf.has(t.g.index))
    .sort((a, b) => a.g.index - b.g.index);
}

function inspectedTileIndex(ordered: ProjTile[], tile: number | undefined): number {
  if (tile === undefined) return -1;
  return ordered.findIndex((t) => t.g.index === tile);
}
