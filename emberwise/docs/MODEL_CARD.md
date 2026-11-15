# EMBERWISE model card

## What the model does

It puts 26 years of satellite fire detections for Indian Punjab and Haryana on one scale, so that a change of
satellite is not read as a change in burning. The output is a **relative burning activity index** in tile-days on
the VIIRS (Suomi NPP) scale. It is not fire size, burned area, emissions or a count of fires, and it does not
explain causes.

## Inputs

- NASA FIRMS active fire detections: MODIS on Terra and Aqua, VIIRS 375 m on Suomi NPP, NOAA-20 and NOAA-21.
- Standard-processing files for history; near-real-time files only for months the standard files do not cover.
- State boundaries from the Survey of India (licence text to be confirmed).

## Method

1. **Unit.** A burning tile-day is one H3 resolution-6 hexagon (about 36 km²) with at least one clean daytime
   detection on one local solar date. Terra and Aqua are combined as a union, never a sum.
2. **One source per day.** From 20 Jan 2012 the index is VIIRS tile-days as measured. Before that, and on VIIRS gap
   days, it is MODIS tile-days times a ratio. MODIS and VIIRS are never added.
3. **Ratio.** One ratio per zone (H3 resolution 3) and calendar month, learned on 2012-2019, twice: from Terra alone
   (for Nov 2000 to 3 Jul 2002) and from Terra and Aqua together (4 Jul 2002 to 2011). Thin zones are pulled toward
   the regional ratio with 20 pseudo tile-days.
4. **Range.** 10th to 90th percentile of the yearly ratios, widened by the 80th percentile of the hide-a-year error
   (9.9% for Terra and Aqua, 33.2% for Terra alone). It is a range of yearly ratios widened by tested error, not a
   confidence interval.
5. **Cap.** A value cannot exceed the number of tiles in scope (or the days in the month for one tile).
6. **Labels.** Measured (VIIRS), Estimated (Terra and Aqua converted), Indicative (Terra alone), Provisional
   (any near-real-time data, from August 2026).
7. **Trust score.** 100 x (1 - range width / value) x support x era factor; support = n / (n + 20); era factor 0.8
   for Estimated and 0.6 for Indicative. Not shown when the value is zero.
8. **Relay.** After Suomi NPP's last delivery on 2 Nov 2026 the index continues on NOAA-20, scaled to Suomi NPP on
   shared seasons.

## Settings

| Setting | Value |
|---|---|
| Tile size | H3 resolution 6; zones at resolution 3; resolutions 5 and 7 for the sensitivity check |
| Learning window | 2012-2019 |
| Shrinkage | 20 pseudo tile-days |
| Passes used | Day passes for the index; night passes kept for the dial and CSV |
| Saturation flag | more than half the tiles in scope burning |
| Relay | NOAA-20 (provisional), calibrated on shared seasons up to 2023 |
| NRT factor threshold | 10% (not applied; seam untested) |

## How well it works

| Check | Result |
|---|---|
| Hide-a-year, 2012-2019 | 24 of 24 preset-years inside the range; median error 6.1%, worst 15.0% |
| Step at the 2012 sensor change | 5.0x in spliced raw counts, 1.02x after harmonizing |
| Negative control (Lahul and Spiti) | 0 false anomalies in 854 Oct-Nov days |
| External check, Indian Punjab 2018-2024 | rank agreement 0.893 with published farm-fire counts (7 years, only partly independent) |
| Sensor-Loss simulation | 2025 rebuilt from NOAA-20: +3.1%; 2021 held out: -2.9% |
| Resolution sensitivity | 7 of the top 10 critical periods confirmed at resolution 5, 7 at resolution 7 |

## Where it falls short

| Check | Result | Consequence |
|---|---|---|
| Month ranking test | 0.781 against a 0.85 pass mark | Before 2012, trust season totals, not the order of single months |
| Detailed ratio against one global ratio | 6.6% against 6.3% at preset-year level | The zone-month ratios help only at map level (30.9% against 39.4%) |
| Terra-only test | Over-predicts 2003-2011 by 50% | Nov 2000 to Jul 2002 is Indicative and probably too high |
| Ratio after the learning window | Down 13.5% after 2019; 1.4 to 1.5 in 2025 | MODIS is not a fixed yardstick; it matters only on VIIRS gap days |
| Peak days | Proportional fit overshoots when most tiles burn (Indian Punjab) | Peak-day values before 2012 are upper-end estimates |
| Daily relay match, 2021 | 0.81 against 0.85 | Relay totals are sound; single days are looser |
| NRT seam | Untested | Months from August 2026 stay Provisional |

## Limits

- Validated for Indian Punjab and Haryana only. Other regions need the same checks before any claim.
- The ratio cannot be tested before 2012, because VIIRS did not exist. Backward use rests on the 2012-2019 fit.
- The ratio may partly reflect changes in burning habits (time of day, field size), not only the sensors.
- A hotspot is a thermal detection, not a fire. Cloud and smoke hide detections for every sensor.
- The index flattens near the peak, when most tiles already burn.
- Terra and Aqua observation times moved after 2021 (see `docs/M2_RESULTS.md`); the design avoids using MODIS there.

## Intended use, and not

For comparing seasons and spotting unusual periods in a consistent record, with ranges and labels. Not an official
fire alert, perimeter map or emergency tool, and not evidence about any individual farm or fire.

## Provenance

Code: `pipeline/tables` (tables, conversion, checks) and `pipeline/model` (relay, peak-day fit, NRT seam). Results:
`web/public/data/validation.json`, `docs/STAGE_D_RESULTS.md`, `docs/M2_RESULTS.md`. AI tools assisted with the
code and this document.
