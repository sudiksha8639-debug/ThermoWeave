# M3 tables: how to run

Everything M3 owns lives in `pipeline/tables/`. Settings are in one file: `pipeline/tables/config.py`.

## Commands (run from the `emberwise` folder)

With make (Mac, Linux): `make tables`

Windows PowerShell (no make), in this order:

    python -m pip install -r requirements-tables.txt
    python -m pipeline.tables.build_tables
    python -m pipeline.tables.check_contract
    python -m pipeline.tables.size_report
    python -m pytest -q

Optional:

    python -m pipeline.tables.make_mocks      (mock hand-offs and mock tables; never overwrites a real file)
    python -m pipeline.tables.gen_schema_md   (regenerates docs/schema.md)

## Where the inputs come from

`build_tables` reads M1's hand-off from the repo-root `data/processed/` (tile_day.parquet,
tiles.parquet, regions.json, coverage.parquet, and tile_day_r5/r7.parquet for the resolution check)
and `data/boundary/control_district.geojson`. If `data/processed/tile_day.parquet` is not there it
falls back to the mocks in `emberwise/data/processed/` and every output says `"mock": true`.
The external yearly series is `emberwise/data/external/external_series.csv` (`year,value`).

## What comes out

`web/public/data/*.json` (schema 1.1) and `web/public/data/hotspots/*.csv`. See `docs/schema.md`.
Check results are in `validation.json`, each under its own key with an owner and a reviewer.

## Rules the code enforces

- MODIS and VIIRS are never added. Each day has one source: VIIRS where it has data, else MODIS x ratio.
- Missing data is null, never zero.
- Every value is labelled Measured, Estimated, Indicative or Provisional.
- The headline number is relative burning activity (tile-days). It is not fire size, burned area or a count of fires.
- Banned phrases fail the contract check and a test.
