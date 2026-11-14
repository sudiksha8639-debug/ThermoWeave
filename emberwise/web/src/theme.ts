// Shared theme + colour-safe palette.
// Amounts: viridis (perceptually uniform, colourblind-safe).
// Above/below normal: blue-orange diverging (never red-green).

export const VIRIDIS_STOPS: [number, string][] = [
  [0.0, '#440154'],
  [0.13, '#482878'],
  [0.25, '#3e4989'],
  [0.38, '#31688e'],
  [0.5, '#26828e'],
  [0.63, '#1f9e89'],
  [0.75, '#35b779'],
  [0.88, '#6ece58'],
  [1.0, '#fde725'],
];

// Cividis (alternative amount scale, even more colourblind-safe)
export const CIVIDIS_STOPS: [number, string][] = [
  [0.0, '#00204c'],
  [0.2, '#39486b'],
  [0.4, '#66798c'],
  [0.6, '#88a19e'],
  [0.8, '#b9cba4'],
  [1.0, '#fee838'],
];

// Diverging anomaly scale: below normal = blue, near normal = neutral, above = orange
export const ANOMALY_STOPS: [number, string][] = [
  [0.0, '#2166ac'], // strong blue (below)
  [0.35, '#92c5de'],
  [0.5, '#f7f7f7'], // neutral
  [0.65, '#f4a582'],
  [1.0, '#b35806'], // strong orange (above)
];

export const NO_DATA_COLOR = '#3a4152';
export const GAP_COLOR = '#20263a'; // missing data shown as a gap, never zero

export function ramp(stops: [number, string][], t: number): string {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = t1 === t0 ? 0 : (x - t0) / (t1 - t0);
      return mix(c0, c1, f);
    }
  }
  return stops[stops.length - 1][1];
}

function mix(a: string, b: string, f: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - f) + ((pb >> 16) & 255) * f);
  const g = Math.round(((pa >> 8) & 255) * (1 - f) + ((pb >> 8) & 255) * f);
  const bl = Math.round((pa & 255) * (1 - f) + (pb & 255) * f);
  return `rgb(${r},${g},${bl})`;
}

export function viridis(t: number): string {
  return ramp(VIRIDIS_STOPS, t);
}

export function cividis(t: number): string {
  return ramp(CIVIDIS_STOPS, t);
}

export function anomaly(t: number): string {
  return ramp(ANOMALY_STOPS, t);
}

export const INK = '#e8ecf4';
export const INK_DIM = '#9aa4b8';
export const SURFACE = '#0b1020';
export const SURFACE_2 = '#121829';
export const LINE = '#26314a';
export const ACCENT = '#f0a03c';
export const ACCENT_2 = '#5ec8c0';

export const FONT =
  "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";
export const MONO = "'JetBrains Mono', 'SF Mono', Menlo, monospace";
