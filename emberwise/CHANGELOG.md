# Schema changelog

Owner: M3 (sole schema owner). Deputy: M6. Current `schema_version`: **1.1**.

## Schema-change protocol (Build Plan v4, Section 5)

1. Ask M3 in the team channel: which file, which field, why, who reads it.
   While M3 sleeps (H16-20) M6 may approve **additive** changes only (a new optional file or a new field).
2. M3 (or M6) edits `pipeline/tables/contracts.py`, the only place the schema lives.
3. Bump `SCHEMA_VERSION` in `pipeline/tables/config.py` (1.0 -> 1.1 for additive, 2.0 for a rename, removal or change of meaning).
4. `make tables` regenerates the tables and `docs/schema.md`, then runs `check_contract` and the size report.
   `make mocks` first if the mock hand-offs must change too.
5. `make test-tables` must pass.
6. Add an entry below and announce the change in the team channel with the diff of `docs/schema.md`.

`check_contract` needs no hand edits: it reads the schema from `contracts.py`, so step 2 updates it.
The web app should refuse a file whose `schema_version` it does not know.

## 1.1 (H15, Stage C: first build from M1's real hand-off)

Renames (agreed with M1's regions file and M4's frontend):
- Preset id `punjab` -> `indian_punjab` everywhere it is a key (region_daily, climatology, periods,
  narratives, regions, manifest.presets, hotspot CSV file names). `tile_day.region` is unchanged
  (punjab, haryana, control).
- hotspot CSV header: `daynight` -> `day_night`.

Additive:
- `regions[].tiles_in_scope.r5` and `.r7` may be null (M1 supplies them for the combined preset only).
- `validation.baselines.result.zone_month_level`: the same three-way comparison per zone, month and hidden year.
- `validation.rank_test.result.other_method`: the test repeated with the other allowed method.

Unchanged from 1.0: sensor-set names (TERRA, MODIS_ALL, VIIRS_SNPP, VIIRS_NOAA20, VIIRS_NOAA21),
all tile_month, tile_geometry, coverage, conversion and manifest fields.

Not a schema change, but new behaviour:
- `tile_day.parquet` is day passes only, one row per region, tile, date and sensor set (n_tile_day = 1).
- The builder reads M1's hand-off from the repo-root `data/processed/` when it is there, otherwise the mocks.
- While `USE_FALLBACK_CONVERSION` is True, M3 fits conversion.json, the hide-a-year block and relay_sim.json
  from tile_day using the plan's method. `manifest.model_version` says so. M2's files replace them.

## 1.0 (H2 freeze)

First contract, reconciled against Build Plan v4 Section 5.

Differences from the unreconciled draft M3 shared at about H1 (re-pull if you used it):

- regions: `name` -> `label`; added `default`, `tiles_in_scope` (r5/r6/r7), `boundary_source`. Control district is a separate region, no longer a flag on tiles.
- tile_day: now Parquet in `data/processed/` with the plan's columns (region, h3_r6, zone_r3, date, sensor_set, product, frp_sum, n_hotspots, n_tile_day). New `tiles.parquet` hand-off requested from M1.
- coverage: run-length rows of (sensor_set, product, start, end, has_data) instead of monthly shares.
- hourly, drift: the plan's row fields; drift carries `modis_viirs_ratio_by_year`.
- conversion: zones are H3 res-3 ids; added `learning_window`, `k`, `ratio_by_year` with `in_learning_window`.
- validation: one key per check in the plan, each with owner and a different reviewer; hide-a-year is per region and year.
- relay_sim: now the Sensor-Loss simulation (region, season, date, suomi_actual, relay_built, pct_diff, relay satellite, overlap years).
- region_daily: added hotspot counts and `pct_rank`.
- periods: each period has a `sentence`. narratives: `this_month` and `local_normal` per preset.
- tile_geometry: `state`/`control` replaced by `regions`/`region` and `zones`/`zone`.
- manifest: added hashes, provenance fields, AI-use note, safety disclaimer, precache list.
- hotspot CSV: one file per preset and year under `hotspots/`, with the plan's columns.
- Eras are now date ranges (era D starts 3 Nov 2026).

Layout decisions by M3 that the plan leaves open:

- tile_month stores `ym` and `label` once per month block (`blocks`) rather than once per row (about 15% smaller; the map shows one month at a time).
- coverage is run-length encoded; day or `date` fields are integers (days since 2000-11-01).
