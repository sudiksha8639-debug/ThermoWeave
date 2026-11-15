// Minimal hash router: #/story | #/workspace | #/proof with query params.
// Permalink params live in the hash so static hosting needs no rewrites.

export type Screen = 'story' | 'workspace' | 'proof' | 'methods';

export interface Route {
  screen: Screen;
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const screen: Screen =
    path === 'workspace' || path === 'proof' || path === 'methods' ? path : 'story';
  return { screen, params: new URLSearchParams(qs ?? '') };
}

export function buildHash(screen: Screen, params: URLSearchParams): string {
  const qs = params.toString();
  return `#/${screen}${qs ? `?${qs}` : ''}`;
}

export function navigate(screen: Screen, params: URLSearchParams): void {
  const hash = buildHash(screen, params);
  if (location.hash !== hash) location.hash = hash;
}
