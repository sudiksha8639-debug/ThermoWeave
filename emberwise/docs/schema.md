# EMBERWISE data contract (schema_version 1.1)

Generated from `pipeline/tables/contracts.py`. Do not edit by hand.
Owner: M3. Deputy: M6 (additive changes only while M3 sleeps, H16-20). Protocol: `CHANGELOG.md`.
Source: Build Plan v4, Section 5. Anything the plan does not state is marked [verify].

## Rules that apply to every file

- Every JSON file starts with `schema_version`, `generated_at`, `mock`. `mock: true` data is synthetic and must never be quoted as real.
- Every object is closed: a missing field or an extra field fails `check_contract`.
- **Missing data is a gap (`null`), never `0`.** Empty or failed files show up in `coverage`.
- **Never add MODIS and VIIRS.** One source of truth per day: VIIRS where it has data, otherwise MODIS x conversion ratio.
- Every number has a label: Measured, Estimated, Indicative, Provisional. Era A = Indicative, era B = Estimated, eras C and D = Measured; any month using NRT is Provisional.
- The headline value (`harm`) is relative burning activity at VIIRS scale. It is not fire size, burned area or total fires.
- The range is "Range of yearly ratios, widened by tested error; not a confidence interval."
- Banned wording lives in `config.BANNED_PHRASES`; the checker scans every file for it.
- Columnar layout: an object named `columns` holds equal-length arrays; row i is element i of each array.
- Indexes: `tile` -> `tile_geometry.tiles`; `ym` -> `manifest.months`; day or `date` -> days since `2000-11-01` (local solar date); `region` -> `manifest.presets`; label code -> `label_codes`.
- Safety line for every screen: "Not an official fire alert, perimeter map or emergency tool."

## Web files (`web/public/data/`)

### regions: `regions.json`

M6, M1 -> M3, M4. Three presets and the control district.

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `regions` | array[object] |  |
| `regions[].id` | string | Region id used as a key in other files. |
| `regions[].label` | string | Display label. Results are always labelled 'Indian Punjab and Haryana' style. |
| `regions[].kind` | string (preset, control) | preset = selectable in the app; control = Lab negative control only. |
| `regions[].default` | boolean | true for the preset the app opens with. |
| `regions[].tiles_in_scope` | object | Clipped tile counts; r6 is the saturation cap. r5/r7 are null where M1 has not supplied them. |
| `regions[].tiles_in_scope.r5` | integer | null | Tiles whose centroid is inside, H3 res 5. |
| `regions[].tiles_in_scope.r6` | integer | Tiles whose centroid is inside, H3 res 6. |
| `regions[].tiles_in_scope.r7` | integer | null | Tiles whose centroid is inside, H3 res 7. |
| `regions[].boundary_source` | string | Boundary data source and licence. |
| `regions[].bbox` | array[number] x4 | [west, south, east, north] in degrees. |

### coverage: `coverage.json`

M1 -> M3, M5. Which sensor had data on which days (Jan 2012 is partial).

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `epoch` | string | Date of day index 0. |
| `sensor_sets` | array[string] | Sensor-set names; code = index. |
| `products` | array[string] | Product names; code = index. |
| `columns` | object | Run-length form of (date, sensor_set, product, has_data). Days in no run = sensor did not exist. |
| `columns.sensor_set` | array[integer] | Sensor-set code. |
| `columns.product` | array[integer] | Product code (SP or NRT). |
| `columns.start` | array[integer] | First day of the run, days since epoch (local solar date). |
| `columns.end` | array[integer] | Last day of the run, inclusive. |
| `columns.has_data` | array[boolean] | false = empty or failed files: a gap, never zero. |

### hourly: `hourly.json`

M1 -> M5. When each satellite looked (Fire Clock Dial).

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `satellites` | array[string] | Satellite names; code = index. |
| `columns` | object | Sparse: rows with n_hotspots > 0 only. |
| `columns.region` | array[integer] | Index into regions presets order (punjab, haryana, punjab_haryana). |
| `columns.satellite` | array[integer] | Satellite code. |
| `columns.year` | array[integer] | Year. |
| `columns.month` | array[integer] | Month 1-12. |
| `columns.local_hour` | array[integer] | Local solar hour 0-23. |
| `columns.n_hotspots` | array[integer] | Hotspots in that hour bin. |

### drift: `drift.json`

M1 -> M5. Overpass-time drift per satellite, plus the ratio-by-year series.

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `satellites` | array[string] | Satellite names; code = index. |
| `columns` | object |  |
| `columns.satellite` | array[integer] | Satellite code. |
| `columns.year` | array[integer] | Year. |
| `columns.region` | array[integer] | Preset index. |
| `columns.median_local_hour` | array[number] | Median local solar hour of daytime detections. |
| `columns.iqr` | array[number] | Interquartile range of local solar hour. |
| `modis_viirs_ratio_by_year` | object | Evidence chart: does the MODIS-to-VIIRS relationship move after about 2020? |
| `modis_viirs_ratio_by_year.months` | array[integer] | Pilot months the ratio covers. |
| `modis_viirs_ratio_by_year.learning_window` | array[integer] x2 | [first, last] year of the learning window. |
| `modis_viirs_ratio_by_year.columns` | object |  |
| `modis_viirs_ratio_by_year.columns.year` | array[integer] | Year, 2012 onward. |
| `modis_viirs_ratio_by_year.columns.region` | array[integer] | Preset index. |
| `modis_viirs_ratio_by_year.columns.ratio` | array[number | null] | VIIRS tile-days / MODIS tile-days; null if MODIS is 0. |

### conversion: `conversion.json`

M2 -> M3, M5. Per zone-month MODIS to VIIRS-scale conversion.

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `unit` | string | What the ratio converts. |
| `learning_window` | array[integer] x2 | [first, last] year the ratios were learned on. |
| `k` | number | Shrinkage pseudo tile-days. |
| `zones` | array[string] | H3 res-3 zone ids; zone code = index. |
| `columns` | object |  |
| `columns.zone` | array[integer] | Zone code. |
| `columns.month` | array[integer] | Calendar month 1-12. |
| `columns.era` | array[string (A, B)] | A = Terra only, B = Terra U Aqua. |
| `columns.ratio` | array[number | null] | VIIRS tile-days per MODIS tile-day (shrunk toward the region ratio). |
| `columns.lo` | array[number | null] | 10th percentile of yearly ratios. |
| `columns.hi` | array[number | null] | 90th percentile of yearly ratios. |
| `columns.widened_lo` | array[number | null] | lo widened by tested error; used for eras A and B. |
| `columns.widened_hi` | array[number | null] | hi widened by tested error; used for eras A and B. |
| `columns.n_support` | array[integer] | MODIS tile-days behind the zone-month ratio. |
| `ratio_by_year` | object | Yearly ratios for the pilot months. |
| `ratio_by_year.columns` | object |  |
| `ratio_by_year.columns.zone` | array[integer] | Zone code. |
| `ratio_by_year.columns.month` | array[integer] | Calendar month. |
| `ratio_by_year.columns.year` | array[integer] | Year. |
| `ratio_by_year.columns.ratio` | array[number | null] | Unshrunk yearly ratio; null if MODIS is 0. |
| `ratio_by_year.columns.in_learning_window` | array[boolean] | true if the year was used to learn the ratio. |

### validation: `validation.json`

M2, M3, M5 -> M5. Validation evidence, shown in the Lab whatever it reveals.

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `hide_a_year` | object | M2 / M3. Predict each hidden year from MODIS alone. |
| `hide_a_year.owner` | string | Who wrote the check. |
| `hide_a_year.reviewer` | string | Who reviews it before merge (never the owner). |
| `hide_a_year.status` | string (pending, done) | pending = not yet run on real data. |
| `hide_a_year.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `hide_a_year.result` | object |  |
| `hide_a_year.result.columns` | object |  |
| `hide_a_year.result.columns.region` | array[integer] | Preset index. |
| `hide_a_year.result.columns.year` | array[integer] | Hidden year (within the learning window). |
| `hide_a_year.result.columns.predicted` | array[number | null] | VIIRS-scale tile-days predicted from MODIS alone. |
| `hide_a_year.result.columns.actual` | array[number | null] | VIIRS tile-days observed. |
| `hide_a_year.result.columns.in_range` | array[boolean | null] | actual inside the predicted range. |
| `error_by_level` | object | M2 / M3. Hide-a-year error and bias by activity third. |
| `error_by_level.owner` | string | Who wrote the check. |
| `error_by_level.reviewer` | string | Who reviews it before merge (never the owner). |
| `error_by_level.status` | string (pending, done) | pending = not yet run on real data. |
| `error_by_level.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `error_by_level.result` | object | null | Shape defined by the owner (M2 or M5); to be closed by M3 once delivered. |
| `baselines` | object | M3 / M1. Per zone-month conversion against two simpler baselines, at preset-year level. |
| `baselines.owner` | string | Who wrote the check. |
| `baselines.reviewer` | string | Who reviews it before merge (never the owner). |
| `baselines.status` | string (pending, done) | pending = not yet run on real data. |
| `baselines.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `baselines.result` | object | null | null while pending. |
| `baselines.result.metric` | string | Error metric. |
| `baselines.result.n` | integer | Region-years compared. |
| `baselines.result.per_zone_month` | number | null | Error of the per zone-month conversion. |
| `baselines.result.global_ratio` | number | null | Error using one global ratio. |
| `baselines.result.no_conversion` | number | null | Error using raw MODIS tile-days. |
| `baselines.result.beats_both` | boolean | null | per_zone_month lower than both baselines. |
| `baselines.result.zone_month_level` | object | null | The same comparison for each zone, month and hidden year (finer than a preset-year). |
| `baselines.result.zone_month_level.n` | integer | Zone-month-years compared. |
| `baselines.result.zone_month_level.per_zone_month` | number | null | Error of the per zone-month conversion. |
| `baselines.result.zone_month_level.global_ratio` | number | null | Error using one global ratio. |
| `baselines.result.zone_month_level.no_conversion` | number | null | Error using raw MODIS tile-days. |
| `baselines.result.zone_month_level.beats_both` | boolean | null | per_zone_month lower than both baselines. |
| `rank_test` | object | M3 / M1. Does the harmonized record rank periods the way VIIRS does? |
| `rank_test.owner` | string | Who wrote the check. |
| `rank_test.reviewer` | string | Who reviews it before merge (never the owner). |
| `rank_test.status` | string (pending, done) | pending = not yet run on real data. |
| `rank_test.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `rank_test.result` | object | null | null while pending. |
| `rank_test.result.method` | string | How seasonality was removed. |
| `rank_test.result.rho` | number | null | Spearman rho, as found. |
| `rank_test.result.threshold` | number | Pass mark. |
| `rank_test.result.passed` | boolean | null | rho >= threshold. |
| `rank_test.result.n` | integer | Pairs. |
| `rank_test.result.other_method` | object | null | The same test by the other allowed method, reported for transparency. |
| `rank_test.result.other_method.method` | string | The alternative way of removing seasonality. |
| `rank_test.result.other_method.rho` | number | null | Spearman rho, as found. |
| `rank_test.result.other_method.threshold` | number | Pass mark. |
| `rank_test.result.other_method.passed` | boolean | null | rho >= threshold. |
| `rank_test.result.other_method.n` | integer | Pairs. |
| `seam_step` | object | M5 / M2. Size of the 2012 step before and after harmonizing. |
| `seam_step.owner` | string | Who wrote the check. |
| `seam_step.reviewer` | string | Who reviews it before merge (never the owner). |
| `seam_step.status` | string (pending, done) | pending = not yet run on real data. |
| `seam_step.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `seam_step.result` | object | null | Shape defined by the owner (M2 or M5); to be closed by M3 once delivered. |
| `era_b_test` | object | M2 / M3. Terra to Terra U Aqua conversion on 2003-2011. |
| `era_b_test.owner` | string | Who wrote the check. |
| `era_b_test.reviewer` | string | Who reviews it before merge (never the owner). |
| `era_b_test.status` | string (pending, done) | pending = not yet run on real data. |
| `era_b_test.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `era_b_test.result` | object | null | Shape defined by the owner (M2 or M5); to be closed by M3 once delivered. |
| `ratio_trend` | object | M2 / M3. Ratio stability over the learning window. |
| `ratio_trend.owner` | string | Who wrote the check. |
| `ratio_trend.reviewer` | string | Who reviews it before merge (never the owner). |
| `ratio_trend.status` | string (pending, done) | pending = not yet run on real data. |
| `ratio_trend.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `ratio_trend.result` | object | null | Shape defined by the owner (M2 or M5); to be closed by M3 once delivered. |
| `res_sensitivity` | object | M1 data, M3 compare / M5. Top periods at res 5/6/7. |
| `res_sensitivity.owner` | string | Who wrote the check. |
| `res_sensitivity.reviewer` | string | Who reviews it before merge (never the owner). |
| `res_sensitivity.status` | string (pending, done) | pending = not yet run on real data. |
| `res_sensitivity.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `res_sensitivity.result` | object | null | Shape defined by the owner (M2 or M5); to be closed by M3 once delivered. |
| `nrt_seam` | object | M1 pairs, M2 / M3. NRT vs SP shift on the same satellite. |
| `nrt_seam.owner` | string | Who wrote the check. |
| `nrt_seam.reviewer` | string | Who reviews it before merge (never the owner). |
| `nrt_seam.status` | string (pending, done) | pending = not yet run on real data. |
| `nrt_seam.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `nrt_seam.result` | object | null | Shape defined by the owner (M2 or M5); to be closed by M3 once delivered. |
| `external_check` | object | M3, M6 sources / M1. Yearly Oct-Nov harmonized activity against one outside series. |
| `external_check.owner` | string | Who wrote the check. |
| `external_check.reviewer` | string | Who reviews it before merge (never the owner). |
| `external_check.status` | string (pending, done) | pending = not yet run on real data. |
| `external_check.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `external_check.result` | object | null | null while pending. |
| `external_check.result.source` | string | Outside series used. |
| `external_check.result.source_limits` | string | Known limits of that series. |
| `external_check.result.rho` | number | null | Spearman rho, as found (a weak result is reported, not hidden). |
| `external_check.result.n` | integer | Years compared. |
| `external_check.result.years` | array[integer] | Years compared. |
| `negative_control` | object | M3 / M1. False anomalies in the low-fire control district (tile-days only). |
| `negative_control.owner` | string | Who wrote the check. |
| `negative_control.reviewer` | string | Who reviews it before merge (never the owner). |
| `negative_control.status` | string (pending, done) | pending = not yet run on real data. |
| `negative_control.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `negative_control.result` | object | null | null while pending. |
| `negative_control.result.region` | string | Control region id. |
| `negative_control.result.years` | array[integer] x2 | [first, last] year. |
| `negative_control.result.days_tested` | integer | Oct-Nov days tested. |
| `negative_control.result.false_anomalies` | integer | null | Days flagged where none are expected. |
| `negative_control.result.rate` | number | null | false_anomalies / days_tested. |

### relay_sim: `relay_sim.json`

M2 -> M5, M6. Sensor-Loss simulation on the last full season.

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `region` | string (indian_punjab, haryana, punjab_haryana) | Preset id. |
| `season` | integer | Year of the Oct-Nov season simulated. |
| `relay_satellite` | string | Satellite that takes over from Suomi NPP. |
| `overlap_years` | array[integer] | Shared years used to align the relay (excluding the season). |
| `epoch` | string | Date of day index 0. |
| `columns` | object |  |
| `columns.date` | array[integer] | Days since epoch (local solar date). |
| `columns.suomi_actual` | array[number | null] | Suomi NPP tile-days actually observed. |
| `columns.relay_built` | array[number | null] | Series rebuilt through the relay as if Suomi NPP had stopped. |
| `columns.pct_diff` | array[number | null] | Percent difference, relay_built vs suomi_actual; null if actual is 0. |

### tile_month: `tile_month_*.json`

M3 -> M4. File name tile_month_YYYY.json.

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `year` | integer | Calendar year of this file (one file per year, lazy loaded). |
| `label_codes` | array[string] x4 | Label names; a label code is an index into this list. |
| `blocks` | object | Rows are sorted by month; ym and label are stored once per month, not once per row. |
| `blocks.ym` | array[integer] | Index into manifest.months; one per month block, ascending. |
| `blocks.label` | array[integer] | Label code of the month. |
| `blocks.start` | array[integer] | Row offsets: block b = rows start[b] .. start[b+1]-1. Length = blocks + 1. |
| `columns` | object | Sparse: one row per tile-month with any detection. No row = no detection. |
| `columns.tile` | array[integer] | Index into tile_geometry.tiles. |
| `columns.raw_hotspots` | array[integer] | Naive splice: hotspots from the day's source sensor (MODIS before VIIRS, VIIRS after). Never a sum of both. |
| `columns.raw_tile_days` | array[integer] | Naive splice in tile-days. |
| `columns.raw_modis` | array[integer | null] | MODIS tile-days (Terra U Aqua). |
| `columns.raw_viirs` | array[integer | null] | VIIRS tile-days; null in months before VIIRS existed. |
| `columns.harm` | array[number | null] | Harmonized relative burning activity, VIIRS-scale tile-days, capped at days in month. |
| `columns.lo` | array[number | null] | Lower range of harm. |
| `columns.hi` | array[number | null] | Upper range of harm. |
| `columns.trust` | array[integer | null] | Trust score 0-100; null = n/a (no activity or missing). |
| `columns.frac_burning` | array[number | null] | harm / days in month, 0-1. |

### tile_geometry: `tile_geometry.json`

M3 -> M4. Precomputed hexagons so the browser needs no H3 library.

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `res` | integer | H3 resolution of tiles. |
| `tiles` | array[string] | H3 cell ids; position = tile index used everywhere. |
| `lng` | array[number] | Centroid longitude. |
| `lat` | array[number] | Centroid latitude. |
| `verts` | array[number] | Hexagon vertices, 12 numbers per tile: lng,lat x 6. |
| `regions` | array[string] | Base region ids; region code = index. |
| `region` | array[integer] | Base region code per tile. |
| `zones` | array[string] | H3 res-3 zone ids; zone code = index. |
| `zone` | array[integer] | Zone code per tile. |
| `fallback` | object | Res-5 grid: draw the map at res 5 if the data is too heavy, keep res 6 for numbers. |
| `fallback.res` | integer | Coarser H3 resolution. |
| `fallback.tiles` | array[string] | H3 cell ids at the coarser resolution. |
| `fallback.verts` | array[number] | 12 numbers per coarse tile. |
| `fallback.parent` | array[integer] | For each res-6 tile, index of its coarse parent. |

### region_daily: `region_daily.json`

M3 -> M4. Daily series for the three presets only.

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `epoch` | string | Date of day index 0; array position = days since epoch. |
| `n_days` | integer | Length of every series. |
| `label_codes` | array[string] x4 | Label names; a label code is an index into this list. |
| `presets` | object |  |
| `presets.<preset>` | object |  |
| `presets.<preset>.tile_count` | integer | In-scope res-6 tiles; cap for harm. |
| `presets.<preset>.modis_td` | array[integer | null] | Tiles with a MODIS detection; null when MODIS had no data. |
| `presets.<preset>.viirs_td` | array[integer | null] | Tiles with a VIIRS detection; null before VIIRS existed or in a gap. |
| `presets.<preset>.modis_hotspots` | array[integer | null] | MODIS hotspot count (plain-count view). |
| `presets.<preset>.viirs_hotspots` | array[integer | null] | VIIRS hotspot count (plain-count view). |
| `presets.<preset>.harm` | array[number | null] | Harmonized relative burning activity, VIIRS-scale tile-days. |
| `presets.<preset>.lo` | array[number | null] | Lower range. |
| `presets.<preset>.hi` | array[number | null] | Upper range. |
| `presets.<preset>.frac_burning` | array[number | null] | harm / tile_count; above about 0.5 = near saturation. |
| `presets.<preset>.pct_rank` | array[number | null] | Position 0-100 of harm among all years within +/-7 days of the same day of year. [verify definition] |
| `presets.<preset>.label` | array[integer] | Label code per day. |

### climatology: `climatology.json`

M3 -> M4. Per-sensor weekly percentiles from each sensor's own history (Local Normal).

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `weeks` | integer | Weeks per year (week = min((day_of_year-1)//7, 51)). |
| `window_weeks` | integer | Weeks pooled either side, circular (late December joins January). |
| `unit` | string | Unit of the percentiles. |
| `presets` | object |  |
| `presets.<preset>` | object |  |
| `presets.<preset>.modis` | object |  |
| `presets.<preset>.modis.p10` | array[number | null] x52 | P10 per week of year. |
| `presets.<preset>.modis.p25` | array[number | null] x52 | P25 per week of year. |
| `presets.<preset>.modis.p50` | array[number | null] x52 | P50 per week of year. |
| `presets.<preset>.modis.p75` | array[number | null] x52 | P75 per week of year. |
| `presets.<preset>.modis.p90` | array[number | null] x52 | P90 per week of year. |
| `presets.<preset>.modis.n_years` | integer | Complete years behind the percentiles. |
| `presets.<preset>.viirs` | object |  |
| `presets.<preset>.viirs.p10` | array[number | null] x52 | P10 per week of year. |
| `presets.<preset>.viirs.p25` | array[number | null] x52 | P25 per week of year. |
| `presets.<preset>.viirs.p50` | array[number | null] x52 | P50 per week of year. |
| `presets.<preset>.viirs.p75` | array[number | null] x52 | P75 per week of year. |
| `presets.<preset>.viirs.p90` | array[number | null] x52 | P90 per week of year. |
| `presets.<preset>.viirs.n_years` | integer | Complete years behind the percentiles. |

### periods: `periods.json`

M3 -> M4. Critical periods of unusually high relative burning activity.

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `method` | object |  |
| `method.roll_days` | integer | Rolling window. |
| `method.percentile` | integer | Threshold percentile. |
| `method.doy_window` | integer | +/- days around each day of year. |
| `method.max_gap` | integer | Gaps merged. |
| `method.min_days` | integer | Shortest period kept. |
| `presets` | object |  |
| `presets.<preset>` | array[object] |  |
| `presets.<preset>[].start` | string | First day. |
| `presets.<preset>[].end` | string | Last day. |
| `presets.<preset>[].days` | integer | Length. |
| `presets.<preset>[].status` | string (firm, tentative) | firm = whole lower range above P90; otherwise tentative. |
| `presets.<preset>[].severity` | number | null | Excess over the median, as a ratio (0.8 = 80% above). |
| `presets.<preset>[].peak_date` | string | Day of the highest 7-day value. |
| `presets.<preset>[].peak_value` | number | Highest 7-day mean harmonized value. |
| `presets.<preset>[].label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `presets.<preset>[].sentence` | string | Template-written sentence. |

### narratives: `narratives.json`

M3 -> M4. This-month numbers, Local Normal badge and plain sentences per preset.

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `as_of` | string | Last day of data. |
| `templates` | object | Sentence templates and fixed wording by key. Template-written, never AI-written. |
| `local_normal_explanations` | object | One possible explanation per flag (hypothesis, not conclusion). |
| `local_normal_explanations.both_elevated` | string |  |
| `local_normal_explanations.viirs_only` | string |  |
| `local_normal_explanations.modis_only` | string |  |
| `local_normal_explanations.neither` | string |  |
| `presets` | object |  |
| `presets.<preset>` | object |  |
| `presets.<preset>.this_month` | object |  |
| `presets.<preset>.this_month.month` | string | Month described, YYYY-MM. |
| `presets.<preset>.this_month.in_progress` | boolean | true = compared with the same days of past years. |
| `presets.<preset>.this_month.days_compared` | integer | Days of the month used. |
| `presets.<preset>.this_month.value` | number | null | Harmonized activity over those days. |
| `presets.<preset>.this_month.typical_median` | number | null | Median of the same days in other years. |
| `presets.<preset>.this_month.pct_diff` | number | null | Percent difference from the median. |
| `presets.<preset>.this_month.rank_higher_than` | integer | null | Past years this year exceeds. |
| `presets.<preset>.this_month.rank_of` | integer | Past years compared. |
| `presets.<preset>.this_month.middle_half` | array[number | null] x2 | [P25, P75] of past years. |
| `presets.<preset>.this_month.percentile` | number | null | Position among past years, 0-100. |
| `presets.<preset>.this_month.band` | string | null (much below, below, near, above, much above) | Band label. |
| `presets.<preset>.this_month.basis` | string | Evidence the number rests on. |
| `presets.<preset>.this_month.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `presets.<preset>.this_month.near_saturation` | boolean | true if a day in the window exceeded about 50% of tiles. |
| `presets.<preset>.this_month.variant` | string | Template keys used. |
| `presets.<preset>.this_month.sentence` | string | Plain sentence shown on the This-month card. |
| `presets.<preset>.local_normal` | object |  |
| `presets.<preset>.local_normal.week_start` | string | First day of the latest complete week. |
| `presets.<preset>.local_normal.flag` | string | null (both_elevated, viirs_only, modis_only, neither) | Flag. |
| `presets.<preset>.local_normal.label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `presets.<preset>.local_normal.sentence` | string | Cautious wording for the badge. |

### manifest: `manifest.json`

M1, M2, M3 -> M6. Index of shipped files, hashes, provenance and shared lookups.

| field | type | meaning |
|---|---|---|
| `schema_version` | const "1.1" | Contract version; bumped on any schema change. |
| `generated_at` | string | UTC build time, ISO 8601. |
| `mock` | boolean | true = synthetic mock data, never to be shown or quoted as real. |
| `as_of` | string | Last day of data. |
| `months` | array[string] | All months YYYY-MM; ym index = position. |
| `provisional_from` | string | null | First Provisional month (first month using NRT); null if none. |
| `eras` | array[object] |  |
| `eras[].id` | string | Era id. |
| `eras[].start` | string | First day. |
| `eras[].end` | string | null | Last day; null = ongoing. |
| `eras[].label` | string (Measured, Estimated, Indicative, Provisional) | Value label. |
| `eras[].trust_factor` | number | f_era in the trust score. |
| `labels` | array[string] x4 | Label names; a label code is an index into this list. |
| `presets` | array[string] | Preset ids, in preset-index order. |
| `default_preset` | string | Preset the app opens with. |
| `control_region` | string | Control region id. |
| `tile_count` | integer | Tiles in tile_geometry. |
| `relay_satellite` | string | Relay sensor set in use. |
| `firms_download_dates` | object | Product -> download date (M1). |
| `product_versions` | object | Product -> version (M1). |
| `model_version` | string | null | Conversion model version (M2). |
| `boundary` | object |  |
| `boundary.source` | string | null | Boundary source. |
| `boundary.licence` | string | null | Licence. |
| `ai_use_note` | string | AI-tools disclosure. |
| `safety_disclaimer` | string | Shown on every screen. |
| `budget_mb` | number | Size budget. |
| `precache` | array[string] | Files the service worker precaches (plan s5). |
| `files` | array[object] |  |
| `files[].path` | string | Path relative to web/public/data. |
| `files[].contract` | string | Contract name. |
| `files[].bytes` | integer | Uncompressed size. |
| `files[].sha256` | string | File hash. |

### hotspots_csv: `hotspots/hotspots_<preset>_<year>.csv`

M1 -> M4. Fetched only on download click; budgeted separately. Header:

`satellite,date,time_utc,local_solar_time,lat,lon,frp,confidence,day_night,product`

## Pipeline hand-offs (`data/processed/`, git-ignored)

### tile_day: `tile_day.parquet`

M1 -> M2, M3. Sparse: one row per region, res-6 tile, local solar date and sensor set with a clean DAY-pass hotspot (plan s2: day passes only for the headline). n_tile_day is 1 per row; MODIS_ALL is the union of Terra and Aqua flags, never a sum. region is punjab, haryana or control.

| column | kind |
|---|---|
| `region` | str |
| `h3_r6` | str |
| `zone_r3` | str |
| `date` | date |
| `sensor_set` | str |
| `product` | str |
| `frp_sum` | float |
| `n_hotspots` | int |
| `n_tile_day` | int |

### tiles: `tiles.parquet`

M1 -> M3. [verify: M3 request, not in the plan] Every in-scope res-6 tile, including tiles that never burn; needed for geometry and tile counts.

| column | kind |
|---|---|
| `region` | str |
| `h3_r6` | str |
| `zone_r3` | str |

`sensor_set` values: TERRA, MODIS_ALL, VIIRS_SNPP, VIIRS_NOAA20, VIIRS_NOAA21. `product` values: SP, NRT.
