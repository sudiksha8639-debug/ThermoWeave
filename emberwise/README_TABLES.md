# EMBERWISE: analytics tables, schema and checks (M3)

    pip install -r requirements-tables.txt
    make tables        # build tables from the hand-offs -> docs/schema.md -> contract check -> size report
    make test-tables   # the above, then pytest
    make mocks         # rewrite the mock hand-offs (only needed while real files are missing)

`make tables` creates mock hand-offs automatically if `data/processed/tile_day.parquet` is missing.
When M1 and M2 drop real files in place, the same command builds the real tables.

| path | what |
|---|---|
| `pipeline/tables/config.py` | every tunable setting |
| `pipeline/tables/contracts.py` | the schema, single source of truth |
| `pipeline/tables/mocks.py` | mock stand-ins for M1, M2, M5 and M6 hand-offs |
| `pipeline/tables/build.py` | tile_month, region_daily, climatology, periods, narratives, tile_geometry, manifest |
| `pipeline/tables/harmonize.py` | conversion, cap, trust score |
| `pipeline/tables/analytics.py` | climatology, critical periods, this-month, Local Normal, sentences |
| `pipeline/tables/handoff.py` | turns M1's hand-off into regions.json and coverage.json |
| `pipeline/tables/conversion.py` | M3's fallback fit of the plan's conversion, hide-a-year and Sensor-Loss simulation |
| `web/src/contractAdapters.ts` | converts the contract files into the frontend's `types.ts` shapes |
| `docs/M4_INTEGRATION.md` | integration notes and answers to SCHEMA_REQUESTS.md |
| `pipeline/tables/checks.py` | rank test, baselines, external check, negative control; results go into `validation.json` |
| `pipeline/tables/check_contract.py` | fails loudly on missing or extra fields and files |
| `pipeline/tables/size_report.py` | MB per file against the 8 MB budget |
| `docs/schema.md` | generated field reference |
| `CHANGELOG.md` | schema-change protocol and history |

Real data: when the repo-root `data/processed/` folder holds M1's `tile_day.parquet`, `tiles.parquet`
and `regions.json` (plus `coverage.parquet` when available), `build_tables` uses them and writes real
files (`"mock": false`). Without them it builds from the mocks. Tests always use their own mock tree.

No `make` (Windows)? Run the same steps directly from this folder:

    python -m pipeline.tables.make_mocks
    python -m pipeline.tables.build_tables
    python -m pipeline.tables.gen_schema_md
    python -m pipeline.tables.check_contract
    python -m pipeline.tables.size_report
    python -m pytest -q tests

External check: put the outside series in `data/external/external_series.csv` (columns `year,value`)
and set `EXTERNAL_SOURCE`, `EXTERNAL_LIMITS` and `EXTERNAL_PRESET` in `config.py`. Without the file the check stays pending.

All data currently in `web/public/data` is mock (`"mock": true`). Do not quote any number from it.
