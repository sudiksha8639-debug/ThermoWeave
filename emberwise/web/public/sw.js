// EMBERWISE service worker.
// - Precaches the app shell (built assets via sw-manifest.json) and the core
//   data files + last five years of tile_month for the default preset.
// - Offline: anything not cached answers "Not cached. Connect to load this."

const VERSION = 'emberwise-v1';
const SHELL = `emberwise-shell-${VERSION}`;
const DATA = `emberwise-data-${VERSION}`;

const STATIC = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
];

// Core data files to precache (relative to scope). The last five years of
// tile_month cover 2022–2026 for the default preset (Punjab + Haryana).
const DATA_FILES = [
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
      await Promise.allSettled(DATA_FILES.map((f) => data.add(`./${f}`)));
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
  return url.pathname.includes('/data/') || url.pathname.endsWith('.json');
}

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

  // Cache-first for assets and data
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
        if (isDataRequest(url)) {
          return new Response('Not cached. Connect to load this.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
        return caches.match('./index.html');
      }
    })()
  );
});
