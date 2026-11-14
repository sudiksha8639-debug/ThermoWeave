// EMBERWISE service worker.
// - Precaches the app shell (built assets via sw-manifest.json) plus the data
//   files listed in data/manifest.json `precache` (entries may be logical
//   keys like "regions"/"tile_month_2024" or paths like "data/regions.json").
// - Offline: anything not cached answers "Not cached. Connect to load this."

const VERSION = 'emberwise-v2';
const SHELL = `emberwise-shell-${VERSION}`;
const DATA = `emberwise-data-${VERSION}`;

const STATIC = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
];

// Fallback precache if manifest.json cannot be fetched at install time.
const FALLBACK_DATA_FILES = [
  'data/regions.json',
  'data/coverage.json',
  'data/validation.json',
  'data/relay_sim.json',
  'data/conversion.json',
  'data/drift.json',
  'data/hourly.json',
  'data/climatology.json',
  'data/periods.json',
  'data/region_daily.json',
  'data/tile_geometry.json',
  'data/manifest.json',
  'data/tile_month_2022.json',
  'data/tile_month_2023.json',
  'data/tile_month_2024.json',
  'data/tile_month_2025.json',
  'data/tile_month_2026.json',
];

// Normalise a manifest.precache entry to a scope-relative URL.
// Accepts keys ("regions", "tile_month_2024") and paths
// ("data/regions.json", "/data/regions.json", "./data/regions.json").
function precacheEntryToUrl(entry) {
  if (typeof entry !== 'string' || !entry) return null;
  let e = entry.trim();
  if (e.startsWith('./')) e = e.slice(2);
  if (e.startsWith('/')) e = e.slice(1);
  if (/^https?:\/\//.test(e)) return null; // external — skip
  if (!e.includes('/')) {
    // logical key: "regions" or "tile_month_2024" (or bare "x.json")
    e = /\.(json|csv|geojson)$/i.test(e) ? `data/${e}` : `data/${e}.json`;
  } else if (!e.startsWith('data/')) {
    return null; // only data/ paths are precached
  }
  return `./${e}`;
}

async function resolvePrecache() {
  const urls = new Set(FALLBACK_DATA_FILES.map((f) => `./${f}`));
  try {
    const res = await fetch('./data/manifest.json');
    if (res.ok) {
      const manifest = await res.json();
      const list = Array.isArray(manifest.precache) ? manifest.precache : [];
      // `files` keys are an acceptable alternative spelling.
      const keys = manifest.files && typeof manifest.files === 'object'
        ? Object.keys(manifest.files)
        : [];
      for (const entry of [...list, ...keys]) {
        const u = precacheEntryToUrl(entry);
        if (u) urls.add(u);
      }
    }
  } catch {}
  return [...urls];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.addAll(STATIC);
      // hashed build assets
      try {
        const res = await fetch('./sw-manifest.json');
        if (res.ok) {
          const { assets } = await res.json();
          await shell.addAll(assets.map((a) => `./${a}`));
        }
      } catch {}

      const data = await caches.open(DATA);
      const urls = await resolvePrecache();
      await Promise.allSettled(urls.map((u) => data.add(u)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('emberwise-') && n !== SHELL && n !== DATA)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

function isDataRequest(url) {
  return url.pathname.includes('/data/') || /\.(json|csv|geojson)$/i.test(url.pathname);
}

const NOT_CACHED = () =>
  new Response('Not cached. Connect to load this.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' },
  });

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for navigations (hash router means index.html always)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for assets and data; anything outside the precache that also
  // fails on the network gets the explicit not-cached message.
  event.respondWith(
    (async () => {
      const cacheName = isDataRequest(url) ? DATA : SHELL;
      const cache = await caches.open(cacheName);
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const res = await fetch(request);
        if (res.ok && (url.pathname.includes('/assets/') || isDataRequest(url))) {
          cache.put(request, res.clone());
        }
        return res;
      } catch {
        if (isDataRequest(url)) return NOT_CACHED();
        // last resort for non-data assets: try any cache, then not-cached
        const any = await caches.match(request);
        return any ?? NOT_CACHED();
      }
    })()
  );
});
