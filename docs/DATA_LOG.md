# FIRMS download log

Raw files are not committed (`data/raw/` is git-ignored). Zips are kept untouched; CSVs are unzipped next to them.
Hashes are SHA-256 of the zip files. Row counts exclude the header line.
Logged by M1. Fill every cell marked TODO.

## Requests

| Request ID | Source | Box (W,S,E,N) | Requested range | Request time | Zip file | SHA-256 | Folder |
|---|---|---|---|---|---|---|---|
| 845493 | Suomi NPP VIIRS C2 (SV-C2) | 73.5, 27.4, 78.0, 32.8 | 2012-01-20 to 2026-11-02 | 2026-11-13 18:20:59 | DL_FIRE_SV-C2_845493.zip | 8526B9C29822150122A0D79CD716ACE1FDCBDCAF64B82105B428B7811E43DC42 | data/raw/ |
| 845498 | MODIS C6.1 (M-C61) | 73.5, 27.4, 78.0, 32.8 | 2000-11-01 to 2026-11-05 | 2026-11-13 18:22:18 | DL_FIRE_M-C61_845498.zip | 5E6D25EB7D6CA375E2A17A7B767ABC90C90090B24FB47685574C7904A783058C | data/raw/ |
| 845475 | NOAA-20 VIIRS C2 (J1V-C2) | 73.5, 27.4, 78.0, 32.8 | 2018-04-01 to 2026-11-05 | 2026-11-13 18:10:37 | DL_FIRE_J1V-C2_845475.zip | 1AA7D4C90D46618CDAB5DD196AA55458474F04CC0B4EA8F5C311C5C732AA7A69 | data/raw/ |
| 845518 | NOAA-21 VIIRS C2 (J2V-C2) | 73.5, 27.4, 78.0, 32.8 | 2023-03-01 to 2026-11-05 | 2026-11-13 18:31:51 | DL_FIRE_J2V-C2_845518.zip | AED31EC6459796A4022B9F60DA8CC43EE08244FE4EC23CD11F674509A253DAC4 | data/raw/ |
| 846801 | Suomi NPP VIIRS C2 (control district) | TODO: box used | TODO: expected 2012-01-20 to 2025-12-31 | TODO | DL_FIRE_SV-C2_846801.zip | F8D23AB295AF126FE94C3B298707D2E19E90111697D585776067C91C8B2A69BE | data/raw/control/ |

## Files and row counts

Each Punjab and Haryana zip holds a standard-processing (SP) archive CSV and a near-real-time (NRT) CSV. The control zip holds an SP archive only.

Confirmed with `pipeline/check_dates.py` (min and max of `acq_date`, distinct days with at least one row, `type` counts).

| CSV | Product | Rows | First date | Last date | Distinct days | type counts |
|---|---|---|---|---|---|---|
| fire_archive_SV-C2_845493.csv | SP | 1,642,993 | 2012-01-20 | 2026-07-31 | 5,064 | 0: 1,626,926; 2: 15,960; 3: 107 |
| fire_nrt_SV-C2_845493.csv | NRT | 5,991 | 2026-08-01 | 2026-11-02 | 89 | none |
| fire_archive_M-C61_845498.csv | SP | 539,793 | 2000-11-01 | 2026-08-30 | 7,355 | 0: 530,762; 2: 9,031 |
| fire_nrt_M-C61_845498.csv | NRT | 3,091 | 2026-09-03 | 2026-11-05 | 47 | none |
| fire_archive_J1V-C2_845475.csv | SP | 885,060 | 2018-04-01 | 2026-07-31 | 2,923 | 0: 875,552; 2: 9,398; 3: 110 |
| fire_nrt_J1V-C2_845475.csv | NRT | 7,743 | 2026-08-01 | 2026-11-05 | 93 | none |
| fire_archive_J2V-C2_845518.csv | SP | 251,403 | 2023-03-01 | 2026-07-31 | 1,205 | 0: 246,893; 2: 4,458; 3: 52 |
| fire_nrt_J2V-C2_845518.csv | NRT | 6,748 | 2026-08-01 | 2026-11-05 | 93 | none |
| fire_archive_SV-C2_846801.csv (control) | SP | 69,639 | 2012-01-23 | 2025-12-30 | 3,457 | 0: 66,834; 2: 2,795; 3: 10 |

A day with no rows can mean no detections or no data; the CSVs cannot tell them apart. See `pipeline/check_gaps.py` and the coverage rule in the findings.

## Header checks

| File family | Columns |
|---|---|
| VIIRS SP archive (Suomi NPP seen) | latitude, longitude, brightness, scan, track, acq_date, acq_time, satellite, instrument, confidence, version, bright_t31, frp, daynight, **type** |
| VIIRS NRT (Suomi NPP seen) | same as above **without `type`**; version shows `2.0NRT` |
| MODIS SP archive | same columns as VIIRS SP, but `confidence` is numeric (e.g. 48), `version` e.g. 6.03 |
| NOAA-20, NOAA-21, MODIS NRT | TODO: confirm headers |

## Findings

1. **NRT files have no `type` column.** A static-source mask built from SP history must be applied to all eras (plan Section 6).
2. **SP and NRT do not overlap** for any VIIRS satellite (SP ends 2026-07-31, NRT starts 2026-08-01), so the NRT-vs-SP seam check has no shared months. Plan fallback: report the NRT seam as untested. MODIS SP ends 2026-08-30 and MODIS NRT starts 2026-09-03, leaving 31 Aug to 2 Sep with no file coverage.
2a. **NOAA-20, NOAA-21 and MODIS NRT end on 2026-11-05** (the end of the request). Days 6 to 14 Nov need an area-API refresh.
2b. **Static sources:** SP `type` is 0 (vegetation), 2 (static land source) or 3 (offshore). Types 2 and 3 are dropped. Share of type 2: Suomi NPP 1.0%, NOAA-20 1.1%, NOAA-21 1.8%, MODIS 1.7%, control 4.0%. NRT has no `type`, so the mask is built from SP type 2 locations and applied to every row.
2c. **No-row days:** CSVs list detections only, so a day with no rows may be a real zero or missing data. Coverage rule: inside a product's window a no-row day counts as zero detections but is flagged; days outside the window are gaps. In the Sep 15 to Nov 30 season, list every no-row day (`pipeline/check_gaps.py`) and review them as possible outages.
3. **Suomi NPP's last NRT row is dated 2026-11-02** (08:34 UTC). Plan date 2 Nov 2026 holds; the 13:00 UTC final-delivery time is still [verify].
4. `acq_time` is a zero-padded text field (e.g. `0729`); read as text.
5. MODIS `confidence` is numeric, VIIRS is a letter code; clean per sensor.
6. Control file is large (69,639 rows); clip to the district polygon before use.

## No-row days in the stubble season (Sep 15 to Nov 30), from `pipeline/check_gaps.py`

| File | No-row days, whole span | No-row days, Sep 15 to Nov 30 | Dates |
|---|---|---|---|
| Suomi NPP SP | 243 | 5 | 2024-09-26, 2024-11-03, 2024-11-04, 2024-11-05, 2025-10-06 |
| NOAA-20 SP | 121 | 3 | 2019-11-26, 2021-09-23, 2023-09-30 |
| NOAA-21 SP | 44 | 1 | 2025-10-06 |
| MODIS SP | 2,079 | 156 | not listed (over 40) |
| Control SP | 1,634 | 205 | not listed (over 40) |
| Suomi NPP, NOAA-20, NOAA-21 NRT | 5, 4, 4 | 0 | none |
| MODIS NRT | 17 | 13 | 2026-09-15, 09-16, 09-18, 09-26, 09-28, 09-29, 10-04, 10-09, 10-15, 10-17, 10-22, 10-30, 11-04 |

Observations (not yet explained):
- 2025-10-06 has no rows for both Suomi NPP and NOAA-21 but NOAA-20 has rows. 2024-11-03 to 05 has no Suomi NPP rows while NOAA-20 has rows. These look like possible Suomi NPP outages, not zero fire.
- VIIRS NRT has no no-row days in the 2026 season; MODIS NRT has 13 of about 52 days. VIIRS sees fire on those days, so MODIS zeros may be real (lower sensitivity, orbit drift) rather than missing data.

Rule to test at H2 to H8: a no-row day for a satellite is a gap if another satellite of the same era has many rows that day; otherwise it is a flagged zero. M2 decides how gap days enter the series.

## Notes

- No data have been edited. Cleaning and clipping happen in `data/processed/`.
- MAP_KEY is not stored in this repository.