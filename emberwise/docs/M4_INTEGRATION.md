# For M4: reading the M3 tables

The files in `web/public/data/` are columnar to stay inside the 8 MB budget. Your components use
row shapes (`web/src/types.ts`). `web/src/contractAdapters.ts` converts one to the other; it is
type-checked with `tsc --strict` against your `types.ts` and was run on the real files.

| Your type | Call | Notes |
|---|---|---|
| `TileMonthFile` | `adaptTileMonth(file, manifest.months)` | `ym` is `year*12 + month-1`, as in your `ymToLabel`. No row = no detection that month. |
| `TileGeometryFile` | `adaptTileGeometry(file)` | Res-6 tiles first (index = `tile` in tile_month), then res-5 fallback tiles. `res5IndexOf(file, tile)` gives the parent. |
| `RegionsFile` | `adaptRegions(regions, geometry)` | `tiles_in_scope` becomes geometry indices per resolution. |
| `RegionDailyFile` | `adaptRegionDaily(file, presetId)` | `raw_modis`, `raw_viirs` are each sensor's own tile-days. Never add them. |
| `ClimatologyFile` | `adaptClimatology(file)` | `period_kind` is always `week` (1-52); `sensor` is `modis` or `viirs`. |
| `PeriodsFile` | `adaptPeriods(file, presetId)` | Severity number to word with `SEVERITY_CUTS` (0.25, 0.5, 1.0); change them there if you prefer. |
| `CoverageFile` | `adaptCoverage(file, sensorSet)` | Expands runs to one row per day. Pass a sensor set to keep it small. |
| `Manifest` | `adaptManifest(file)` | `files` list becomes a map keyed by path. |

Things to know:

- Preset ids: `indian_punjab`, `haryana`, `punjab_haryana` (default). Control region id: `control`.
- `null` means no data. Show it as a gap, not as zero.
- Sentences come ready-made from `narratives.json` and `periods.json`. Do not build sentences in the UI.
- Show the label (Measured / Estimated / Indicative / Provisional) wherever a value is shown.
- `trust` is null when the value is 0; show "n/a".
- `hourly.json` and `drift.json` are still placeholders (`"mock": true`) until M2 delivers them. Hide those panels or mark them "sample" until then.
- `hotspots/*.csv` are header-only until M1 Drop 3.
