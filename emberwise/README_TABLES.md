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
| `pipeline/tables/check_contract.py` | fails loudly on missing or extra fields and files |
| `pipeline/tables/size_report.py` | MB per file against the 8 MB budget |
| `docs/schema.md` | generated field reference |
| `CHANGELOG.md` | schema-change protocol and history |

Inputs M3 needs: `data/processed/tile_day.parquet`, `data/processed/tiles.parquet` (M1),
`web/public/data/regions.json` (M6/M1), `coverage.json` (M1), `conversion.json` (M2).

All data currently in `web/public/data` is mock (`"mock": true`). Do not quote any number from it.
