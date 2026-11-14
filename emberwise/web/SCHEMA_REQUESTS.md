# Schema requests

Fields the frontend would like but that are not in contract schema_version 1.0.
(To be relayed to the schema owner — do not edit the schema unilaterally.)

1. **`regions.tiles_in_scope` shape** — the contract says "tiles in scope
   (res 5/6/7)". The mock uses `tiles_in_scope: { "5": number[], "6": number[] }`
   of `tile_geometry.index` values. Please confirm the real file uses the same
   shape, or document the canonical one.

2. **`tile_month` column order** — mock assumes the contract column order:
   `tile, ym, raw_hotspots, raw_tile_days, raw_modis, raw_viirs, harm, lo, hi,
   label, trust, frac_burning`. Please confirm `columns` always lists them in
   this order (frontend resolves by name regardless, but a canonical order
   helps streaming parsers).

3. **`hotspots_csv` file naming** — frontend expects
   `hotspots_<preset_id>_<year>.csv` with header
   `satellite,date,time_utc,local_solar_time,lat,lon,frp,confidence,day_night,product`.
   Please confirm.

4. **`tile_geometry` indexing** — mock mixes res-5 and res-6 entries in one
   array with a unique `index`; `tile_month.tile` references that index. If the
   real file splits geometries per resolution, the frontend needs a `res`-keyed
   lookup or separate files.

5. **`manifest.precache`** — mock lists logical file keys
   (`regions`, `tile_month_2024`, …). Please confirm whether real entries are
   keys or paths, so the service worker can precache exactly what it lists.
   (The service worker now accepts both, plus `manifest.files` keys.)

6. **`manifest.eras` (new, optional)** — the era banner prefers era
   boundaries shipped in the manifest, falling back to the four config eras
   in `types.ts`. Proposed shape:
   `eras: [{ id?, name?, start: "YYYY-MM"|"YYYY-MM-DD", end: ""|"YYYY-MM"|"YYYY-MM-DD", trust: "Measured"|"Estimated"|"Indicative"|"Provisional", note? }]`,
   chronological. Confirm or adjust.

7. **`narratives.json` / `tile_day.json`** — listed in the data contract but
   with no frontend type or mock yet. Please share shapes so the adapters in
   `data.ts` can validate them (currently passed through as free-form JSON).

8. **Res-5 `tile_month` rows** — the res-5 map fallback needs `tile_month`
   rows whose `tile` values are res-5 `tile_geometry.index` entries (the mock
   aggregates res-6 children by mean). Please confirm the real pipeline emits
   both resolutions in the same columnar file.

9. **`frac_burning` cap** — the saturation flag assumes `frac_burning` is a
   fraction capped at 1.0 and flags ≥0.9. Confirm the real range/cap.
