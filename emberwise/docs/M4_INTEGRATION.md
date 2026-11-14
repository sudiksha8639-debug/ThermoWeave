# Frontend integration notes (M3 -> M4), schema 1.1

The data files in `emberwise/web/public/data` are now built from M1's real hand-off
(`"mock": false`), except `hourly.json` and `drift.json`, which stay mock until M1's Drop 2.

## The short version

`emberwise/web/src/types.ts` describes row-shaped files. The contract files are columnar and
quantized to stay inside the 8 MB budget, so the shapes differ. Rather than change either side,
use `emberwise/web/src/contractAdapters.ts`: fetch the JSON, pass it through the matching
`adapt*` function, and the result has the shapes `types.ts` already declares. It type-checks
against `types.ts` under `tsc --strict` and was run against the real files.

| types.ts type | file | adapter |
|---|---|---|
| `TileMonthFile` | `tile_month_YYYY.json` | `adaptTileMonth(raw, manifest)` |
| `TileGeometryFile` | `tile_geometry.json` | `adaptTileGeometry(raw)` |
| `RegionsFile` | `regions.json` | `adaptRegions(raw, geometry)` |
| `RegionDailyFile` | `region_daily.json` | `adaptRegionDaily(raw)` |
| `ClimatologyFile` | `climatology.json` | `adaptClimatology(raw)` |
| `PeriodsFile` | `periods.json` | `adaptPeriods(raw, presetId)` |
| `CoverageFile` | `coverage.json` | `adaptCoverage(raw)` |
| `Manifest` | `manifest.json` | `adaptManifest(raw)` |

## Differences the adapter hides

- **tile_month** is an object of arrays plus `blocks` (month and label stored once per month),
  not `columns: string[]` with `data` rows. The adapter returns rows in `TM_COLS` order.
- **ym** in the files is an index into `manifest.months`. The adapter converts it to the
  frontend's `year * 12 + month` number.
- **label** is a code into `label_codes`. The adapter returns the label name.
- **tile_geometry** holds res 6 as flat arrays and res 5 under `fallback`. The adapter returns one
  list: res-6 tiles keep index 0..n-1 (what `tile_month.tile` refers to), res-5 tiles follow.
- **region_daily, climatology, periods** are keyed by preset id; **coverage** is run-length encoded.
- **periods.severity** is a number (0.8 = 80% above the median). The adapter maps it to a word using
  `SEVERITY_CUTS`, which are display choices, not validated thresholds.

## Things the frontend must change itself

- Preset ids are `indian_punjab`, `haryana`, `punjab_haryana` (same as your mocks).
- Era D label: the contract labels by data product, not by era. Era D days are Provisional only
  while they are NRT; `ERAS[3].trust` should not be hard-coded as Provisional. Read the label from
  the data (`blocks.label` in tile_month, `label` in region_daily).
- `narratives.json` has the This-month card numbers and sentence, and the Local Normal badge.
  `types.ts` has no type for it yet; the shape is in `docs/schema.md`.
- `region_daily` also carries `modis_hotspots`, `viirs_hotspots`, `frac_burning` and `label`,
  which the adapter does not copy into `RegionDailyRow` because that type has no fields for them.
  Read them from the raw file for the plain-count view and the saturation flag.
- Show the `"mock": true` flag on any panel fed by a mock file.

## Answers to SCHEMA_REQUESTS.md

1. **regions.tiles_in_scope**: the file holds counts (`r5`, `r6`, `r7`; r5 and r7 are null except
   for the combined preset). Tile membership comes from `tile_geometry.region`. `adaptRegions`
   builds the index lists your type expects.
2. **tile_month column order**: `columns` is an object keyed by name, so order does not matter.
   `ym` and `label` are per month block, not per row.
3. **hotspot CSV naming**: confirmed, `hotspots/hotspots_<preset_id>_<year>.csv` (inside a
   `hotspots` subfolder), header
   `satellite,date,time_utc,local_solar_time,lat,lon,frp,confidence,day_night,product`.
   The contract now uses your `day_night` spelling. Files are header-only until M1's Drop 2.
4. **tile_geometry indexing**: res 6 and res 5 are separate in the file; `fallback.parent` maps each
   res-6 tile to its res-5 tile. `adaptTileGeometry` gives the single indexed list.
5. **manifest.precache**: entries are file paths relative to the data folder
   (for example `regions.json`, `tile_month_2024.json`), not logical keys.
