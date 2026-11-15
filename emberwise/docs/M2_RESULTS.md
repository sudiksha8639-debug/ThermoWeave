# Model checks: results on real data

Build of 15 Nov 2026 from M1's `tile_day.parquet`, `tiles.parquet` and the real Clock Ledger (`drift.json`).
Run with `python -m pipeline.model.run_m2`; the numbers below are copied from `docs/M2_RESULTS.json`.
Results are reported as found, including the ones that did not pass.

## Summary

| Check | Result | Verdict |
|---|---|---|
| Relay satellite | NOAA-20, 0.35 h from 13:30 over 8 shared seasons; NOAA-21 is 0.373 h over 3 | Chosen, **provisional** (margin 0.023 h) |
| Sensor-Loss, 2025 season | Rebuilt from NOAA-20: +3.1% against Suomi NPP; daily match 0.986 | Passed (mark 0.85) |
| Sensor-Loss, 2021 held out | -2.9% against Suomi NPP; daily match 0.81 | Season total fine; **daily match below 0.85** |
| Peak days, Indian Punjab | Proportional fit: 61% daily error, +12% bias on 85 high days. Saturating fit: 40%, -17% | **Proportional overshoots at the peak** |
| Peak days, other presets | No day above half the tiles in 2012-2019 | Nothing to test |
| NRT seam | No month has both products in `tile_day.parquet` | **Untested**, needs M1's pairs file |

## Relay satellite

Rule from the plan: the relay must share at least two full Oct-Nov seasons with Suomi NPP, and among those that
do, the one whose median local solar time is closest to 13:30 is used.

| Candidate | Shared seasons | Median local hour | Distance from 13:30 |
|---|---|---|---|
| NOAA-20 | 2018 to 2025 (8) | 13.15 | 0.350 h |
| NOAA-21 | 2023 to 2025 (3) | 13.13 | 0.373 h |

Both qualify. NOAA-20 is closer by 0.023 h, about a minute and a half, so the choice is marked provisional. NOAA-20
also has far more shared seasons to calibrate on. For reference, rebuilding 2025 from NOAA-21 instead gives -1.9%
with a daily match of 0.915.

## Sensor-Loss simulation

Pretend Suomi NPP stopped before a season, scale the relay to Suomi NPP using other shared seasons, rebuild the
season from the relay alone and compare with what Suomi NPP saw. NOAA-20 is calibrated on seasons up to 2023 only,
as the plan requires.

| Season | Calibrated on | Factor | Suomi NPP saw | Rebuilt | Difference | Daily match |
|---|---|---|---|---|---|---|
| 2025 | 2018-2023 | 0.9588 | 3,500 | 3,607.9 | +3.1% | 0.986 |
| 2021 (held out) | 2018-2020, 2022-2023 | 0.9529 | 25,694 | 24,945.6 | -2.9% | 0.81 |

"Daily match" is the rank correlation of the two daily series after removing the typical value of each calendar
day. 2021 scores 0.81, under the 0.85 mark: the season total is right to within 3% but day-to-day ordering is
looser in a busy season.

Note on the number already in the app: `relay_sim.json` calibrates NOAA-20 on 2018-2024 (factor 0.9523) and shows
+2.4% for 2025. With the plan's pre-2024 rule it is +3.1%. Both are small and point the same way. Say "about 2 to 3%"
in the pitch, or regenerate `relay_sim.json` with the stricter rule after the event.

## Peak days

On days when more than half the tiles burn, tile-days cannot grow much further, so a straight ratio should
overshoot. Tested per day in Oct-Nov 2012-2019, hiding one year at a time, with one ratio per preset.

- Indian Punjab: the highest measured share of tiles burning is 0.761; the proportional prediction reaches 1.467
  (above the physical limit of 1, which is why the headline value is capped). On the 85 days above one half, the
  proportional fit is off by 61% with +12% bias; a saturating curve is off by 40% with -17% bias.
- Haryana (max share 0.197) and the combined preset (0.493) never pass one half in these years.

Reading: on peak days in Indian Punjab the proportional method predicts too much, the saturating curve too little,
and neither is accurate for a single day. The headline index keeps the proportional method and the cap; peak-day
values before 2012 are upper-end estimates. Daily errors of 50-60% are far larger than the 6% error for a whole
season, so single days before 2012 should be read as indicative.

## NRT seam

`tile_day.parquet` switches from standard to near-real-time data once per satellite (Suomi NPP, NOAA-20 and NOAA-21
on 2 Aug 2026; MODIS on 9 Sep 2026) and no month holds both, so the seam cannot be measured from it. The check runs
as soon as `data/processed/nrt_sp_pairs.parquet` exists (columns `family`, `month`, `daynight`, `SP`, `NRT`, as
written by M1's script); it reports the percent shift per satellite and flags anything above 10%. Until then the
app should say the NRT seam is untested, and months from August 2026 stay Provisional.

## What the Clock Ledger shows

Median local solar time of detections, combined preset:

| Year | Terra | Aqua | Suomi NPP |
|---|---|---|---|
| 2012 | 10.85 | 13.28 | 13.11 |
| 2019 | 10.82 | 13.23 | 13.21 |
| 2021 | 10.85 | 13.29 | 13.19 |
| 2023 | 10.43 | 13.62 | 13.19 |
| 2025 | 9.65 | 14.62 | 13.17 |
| 2026 | 9.24 | 15.30 | 12.99 |

Terra and Aqua kept their hours through 2021, then Terra moved earlier and Aqua later, by about 1.6 and 2 hours
by 2026. Suomi NPP stayed near 13:10 throughout. The MODIS-to-VIIRS ratio for Oct-Nov is 2.4 to 2.9 in 2012-2023
and falls to 2.2 in 2024 and 1.4 in 2025. The conversion is learned on 2012-2019, before any of this, and after
2012 the index uses VIIRS directly, so these shifts do not enter the headline values. They do mean MODIS after
2022 is not comparable with earlier MODIS.
