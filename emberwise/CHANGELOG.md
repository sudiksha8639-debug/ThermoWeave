# Data contract changelog

## Protocol (one page, everyone follows it)

1. The contract is `pipeline/tables/contracts.py`. `docs/schema.md` is generated from it
   (`python -m pipeline.tables.gen_schema_md`); never edit schema.md by hand.
2. Any change to a file name, field name, type, unit or meaning is a schema change.
3. To ask for a change: add a line to `docs/SCHEMA_REQUESTS.md` (who, what, why). M3 answers within the day.
4. M3 makes the change in `contracts.py`, bumps `SCHEMA_VERSION` in `pipeline/tables/config.py`,
   regenerates mocks and schema.md, and adds an entry below. Minor bump (1.0 to 1.1) for additions or
   renames; major bump for anything that breaks a consumer without an adapter.
5. Every JSON file carries `"schema_version"`. `python -m pipeline.tables.check_contract` fails on a
   missing field, an extra field, a wrong version, a banned phrase, a zero where null is required,
   or a check whose reviewer is its owner.
6. Nothing merges to main unless the contract check and the tests pass.

## 1.1 - Stage D (15 Nov 2026): results only, no schema change

- `validation.json` now carries real results for: hide_a_year, baselines, rank_test, seam_step,
  error_by_level, era_b_test, ratio_trend, res_sensitivity, external_check, negative_control.
  `nrt_seam` stays pending (needs M1 Drop 3). Full numbers: `docs/STAGE_D_RESULTS.md`.
- Era A now ends 2002-07-03 and era B starts 2002-07-04 (M1's Aqua check).
- The control region label is read from `data/boundary/control_district.geojson`.
- `coverage.parquet` may carry `product` and `suspect_gap`; old sensor-set names are still accepted.
- Fix: `error_by_level` no longer fails when one activity level is empty.

## 1.1 - Stage C (14 Nov 2026)

- Preset id `punjab` renamed `indian_punjab` (matches M1 and M4).
- Hotspot CSV header `daynight` renamed `day_night` (M4 request).
- `regions[].tiles_in_scope.r5` and `.r7` may be null (known only for the combined preset).
- `validation.baselines.result.zone_month_level` and `validation.rank_test.result.other_method` added.
- Sensor-set names are unchanged from 1.0: TERRA, MODIS_ALL, VIIRS_SNPP, VIIRS_NOAA20, VIIRS_NOAA21.

## 1.0 - Stage A (12 Nov 2026)

- First contract: 14 web files, 2 parquet hand-offs, hotspot CSV per preset.
