# EMBERWISE web

Static frontend for the harmonized MODIS–VIIRS fire record (Indian Punjab &
Haryana). Vite + React + TypeScript + Tailwind. No backend — the site only
reads small pre-built JSON files.

## Run

```bash
npm install
npm run dev      # syncs mock-data → public/data, then vite on :5173
npm run lint     # tsc -b typecheck
```

`scripts/sync-data.mjs` runs automatically before `dev` and `build` (or
`npm run sync` manually). It mirrors `<repo>/mock-data/` into
`public/data/` (git-ignored — regenerated every run).

## Build & deploy

```bash
npm run build    # sync + type-checks (tsc -b) then emits dist/
npm run preview  # serve dist/ locally
```

`vite.config.ts` uses a relative `base: './'`, so `dist/` deploys as-is on
GitHub Pages or Netlify. A hand-written service worker (`public/sw.js`)
precaches the app shell plus the core data files and the last five years of
`tile_month` for the default preset. A small Vite plugin emits
`dist/sw-manifest.json` listing hashed assets for the precache.

## Data sources: repo files vs synthetic mocks

Every file is resolved **independently** in `src/data.ts`:

1. The repo file is fetched from `public/data/<name>.json|.csv` (synced
   from `<repo>/mock-data/`).
2. If it is missing, empty, or only carries `schema_version`, the app falls
   back to the synthetic mock in `src/mocks/` **for that file only** and
   logs one `console.info` line naming the source used.
3. Repo files are validated through a per-file adapter. A shape mismatch
   raises an error naming the file and the missing/unexpected field — the
   app never draws a wrong map. All shape variants are normalised in one
   place per file (e.g. `tiles_in_scope` as list or object,
   `tile_geometry` as one array or res-keyed object).

The footer **"Data sources"** drawer lists every file as `repo data` or
`synthetic mock` with its `schema_version` (probes lazily on open).

Force all mocks with either:

```bash
VITE_USE_MOCKS=1 npm run dev
# or
VITE_DATA_SOURCE=mock npm run build
```

`VITE_DATA_SOURCE=real` (or `auto`, the default) still falls back per file
when the repo file is a stub — mocks fill gaps until teammates ship data.

Mock `tile_month` files are columnar (`columns` + `data` rows) per
schema_version 1.0; repo files must match the same contract (columns are
resolved by name, so order may vary). A schema_version other than `"1.0"`
is accepted but logged.

## Layout

- `src/App.tsx` — shell, hash router (`#/story`, `#/workspace`, `#/proof`), footer disclaimer
- `src/state.tsx` — app state; region/date-range/sensor-mode are permalinked in the URL hash
- `src/data.ts` — typed loaders with in-memory caching
- `src/types.ts` — contract types, eras, sensor modes, trust labels
- `src/theme.ts` — colour-safe palette (viridis amounts, blue–orange anomaly)
- `src/components/` — `AreaPicker` (drawer on small screens), `HexMap`
  (canvas, Path2D + rAF + spatial index), `SeriesChartSlot`,
  `FireClockDialSlot`, `ClimatologySlot`, `CsvPanel`, `InspectPanel`,
  `LabelChip`, `SaturationFlag`, `ThisMonthCard`, `DataSourcesPanel`,
  `CacheControls` (online badge + clear cache)
- `src/hooks.ts` — `useData` (with `retry`), `useThisMonth(region)`
- `src/screens/` — Story, Workspace, Proof/Lab (drop-in slots for teammate charts)

## Conventions

- The counting unit is a **burning tile-day**; values are relative burning
  activity at VIIRS scale — never add MODIS + VIIRS counts.
- Missing data renders as a gap, never zero.
- Every number carries a `LabelChip`: Measured / Estimated / Indicative / Provisional.
- Permanent footer: "Not an official fire alert, perimeter map or emergency tool."
- Fire Clock Dial caption is fixed (see `FireClockDial.tsx`).
- No API keys in the repo — never add FIRMS `MAP_KEY`.
