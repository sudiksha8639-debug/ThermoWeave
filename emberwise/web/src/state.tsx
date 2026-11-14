import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { buildHash, navigate, parseHash, type Route, type Screen } from './router';
import {
  SENSOR_MODES,
  ymToLabel,
  type SensorMode,
} from './types';

export interface InspectTarget {
  tile?: number; // tile_geometry index
  ym?: number; // year*12+month-1
}

interface AppState {
  route: Route;
  screen: Screen;
  go: (screen: Screen) => void;
  regionId: string;
  setRegionId: (id: string) => void;
  startYm: number;
  endYm: number;
  setRange: (startYm: number, endYm: number) => void;
  sensor: SensorMode;
  setSensor: (s: SensorMode) => void;
  selectedYm: number; // month shown on the map
  setSelectedYm: (ym: number) => void;
  selectedTiles: Set<number> | null; // drag-rect filter (tile indices)
  setSelectedTiles: (t: Set<number> | null) => void;
  inspected: InspectTarget | null;
  setInspected: (t: InspectTarget | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export function ymOf(ymStr: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ymStr);
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

export function ymStr(ym: number): string {
  return ymToLabel(ym);
}

const DEFAULT_REGION = 'punjab_haryana';
const DEFAULT_FROM = '2023-01';
const DEFAULT_TO = '2025-12';

export function AppProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const p = route.params;
  const regionId = p.get('region') ?? DEFAULT_REGION;
  const startYm = ymOf(p.get('from') ?? '') ?? ymOf(DEFAULT_FROM)!;
  const endYm = ymOf(p.get('to') ?? '') ?? ymOf(DEFAULT_TO)!;
  const sensorParam = p.get('sensor') ?? 'harm';
  const sensor: SensorMode = SENSOR_MODES.some((s) => s.id === sensorParam)
    ? (sensorParam as SensorMode)
    : 'harm';
  const selectedYmParam = p.get('month');
  const [selectedYmState, setSelectedYmState] = useState<number | null>(
    selectedYmParam ? ymOf(selectedYmParam) : null
  );
  const selectedYm =
    selectedYmState ?? Math.min(endYm, ymOf('2025-10')!);

  const [selectedTiles, setSelectedTiles] = useState<Set<number> | null>(null);
  const [inspected, setInspected] = useState<InspectTarget | null>(null);

  const writeParams = useCallback(
    (mut: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(route.params);
      mut(params);
      navigate(route.screen, params);
    },
    [route]
  );

  const go = useCallback(
    (screen: Screen) => navigate(screen, route.params),
    [route.params]
  );

  const setRegionId = useCallback(
    (id: string) => writeParams((q) => q.set('region', id)),
    [writeParams]
  );
  const setRange = useCallback(
    (s: number, e: number) =>
      writeParams((q) => {
        q.set('from', ymStr(s));
        q.set('to', ymStr(e));
      }),
    [writeParams]
  );
  const setSensor = useCallback(
    (s: SensorMode) => writeParams((q) => q.set('sensor', s)),
    [writeParams]
  );
  const setSelectedYm = useCallback((ym: number) => {
    setSelectedYmState(ym);
    writeParams((q) => q.set('month', ymStr(ym)));
  }, [writeParams]);

  const value = useMemo<AppState>(
    () => ({
      route,
      screen: route.screen,
      go,
      regionId,
      setRegionId,
      startYm,
      endYm,
      setRange,
      sensor,
      setSensor,
      selectedYm,
      setSelectedYm,
      selectedTiles,
      setSelectedTiles,
      inspected,
      setInspected,
    }),
    [
      route,
      go,
      regionId,
      setRegionId,
      startYm,
      endYm,
      setRange,
      sensor,
      setSensor,
      selectedYm,
      setSelectedYm,
      selectedTiles,
      inspected,
    ]
  );

  // clear tile selection when region changes
  useEffect(() => {
    setSelectedTiles(null);
    setInspected(null);
  }, [regionId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export { buildHash };
