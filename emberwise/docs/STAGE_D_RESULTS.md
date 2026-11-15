# Stage D: check results on real data

Build of 15 Nov 2026 on M1's hand-off. Data as of **2026-11-05**. Months from 2026-08 are Provisional.
2,455 res-6 tiles (1,294 Indian Punjab, 1,161 Haryana), 17 zones, 354 control tiles.
Every number below is copied from `web/public/data/validation.json` or the built tables. Nothing is rounded up,
and checks that failed are reported as failed.

"Activity" always means relative burning activity in tile-days. It is not fire size, burned area or a count of fires.

## Summary

| Check | Result | Verdict |
|---|---|---|
| Hide-a-year (2012-2019) | 24 of 24 preset-years inside the range; error median 6.1%, 80th percentile 9.9%, worst 15.0% | Passed |
| Step at the 2012 sensor change (Oct-Nov) | naive hotspots 5.0x, naive tile-days 2.72x, harmonized 1.02x | Step removed |
| Baselines, whole preset and year | per zone-month 6.6% error, one global ratio 6.3%, no conversion 65.4% | **Does not beat the global ratio** |
| Baselines, single zone and month (n=605) | per zone-month 30.9%, global ratio 39.4%, no conversion 72.9% | Beats both |
| Rank test (threshold 0.85) | rho 0.781 (n=164 months); other method 0.801 | **Failed** |
| Error by activity level | low 46.8%, middle 30.5%, high 15.4% (bias -0.0%, -4.0%, +1.6%) | No large bias; small cells are noisy |
| Terra-only test (learn 2012-19, test 2003-11) | error 50.2%, bias +50.0% (n=27) | **Failed: era A is overstated** |
| Ratio stability (Oct-Nov VIIRS per MODIS) | 2.68 in 2012-19, 2.32 after (-13.5%); 2025 alone 1.50 | **Not stable after 2019** |
| Resolution sensitivity (top 10 res-6 periods) | 7 confirmed at res 5, 7 at res 7, 5 at both | Partly robust |
| External check (Indian Punjab, 2018-2024) | rho 0.893, n=7 | Agrees; small sample, partly independent |
| Negative control (Lahul and Spiti) | 0 false anomalies in 854 Oct-Nov days | Passed |
| NRT seam | not run | Pending M1 Drop 3 |

## What each result means

**Hide-a-year.** Each year 2012-2019 was hidden in turn, the ratios were learned from the other seven, and the
hidden year's VIIRS activity was predicted from MODIS alone. All 24 preset-years landed inside the widened range.
This is the main evidence that MODIS x ratio reproduces VIIRS at the level of a whole preset and year.
The 80th-percentile error (era B 9.9%, era A 33.2%) is what widens every range.

**Step at 2012.** Mean Oct-Nov total for 2009-2011 against 2012-2014. Splicing raw hotspot counts gives a 5.0x jump
that is caused by the sensor, not by burning. The harmonized index shows 1.02x. Note this is expected by
construction (the ratios are learned on 2012-2019); it shows the artificial step is gone, and hide-a-year is the
evidence that the level is right.

**Baselines.** At whole-preset, whole-year level a single global ratio does as well as our zone-month ratios
(6.3% against 6.6%). The zone-month ratios only pay off when you look at a single zone and month (30.9% against
39.4%), which is the level the map uses. We must not claim the detailed conversion is better for the headline series.

**Rank test.** After removing each calendar month's average, converted MODIS and VIIRS rank the 164 overlap months
with rho 0.781. The plan's pass mark is 0.85, so this check fails. The within-month method gives 0.801, also below.
Reading: the conversion gets the size of a season right (hide-a-year) but month-to-month ordering in quiet months
is weaker. Do not describe month rankings in the MODIS era as reliable; season totals are.

**Error by level.** Cells with 20-51 tile-days are off by 47% on average; cells above 257 by 15%. Bias is small at
every level. Small numbers are noisy, which is why the trust score has a support factor.

**Terra-only test.** Era A (Nov 2000 to 3 Jul 2002) has Terra alone. We tested the Terra step on years it was not
learned on: it over-predicts 2003-2011 by 50%. Reason visible in the data: in Oct-Nov, Terra and Aqua together saw
about 4 to 5 times what Terra saw in 2002-2009, but 6.5 to 11 times in 2012-2019 (16.7 in 2017), so a ratio learned on 2012-2019 is
too large for early years. Consequence: era A values (for example the 2001 season at 21,225, range 12,622 to
28,899) are probably overstated by a similar amount. They are already labelled Indicative with trust capped
at 60. Recommended change for M2 to decide: learn the Terra step on 2003-2011 instead. Not applied here because the
plan fixes the learning window at 2012-2019.

**Ratio stability.** The Oct-Nov ratio by year is 2.53, 2.65, 2.55, 2.92, 2.62, 2.94, 2.65, 2.59 (2012-2019), then
2.43, 2.41, 2.68, 2.60, 2.30, 1.50 (2020-2025). It drifted down after the learning window and 2025 is far off.
This matters only where MODIS is converted, which after 2012 is on VIIRS gap days only, so the effect on the
series is small. It does mean MODIS cannot be assumed to be a stable yardstick, and we cannot test the ratio before 2012.

**Resolution sensitivity.** On measured VIIRS only, 7 of the 10 strongest res-6 critical periods are also found
at res 5 and 7 at res 7; 5 at both. Res 7 finds far fewer periods overall (10 against 31) because the 1%-of-tiles
floor is harder to reach with small tiles. Short 3-day periods are the ones that do not carry over.

**External check.** Our Oct-Nov index for Indian Punjab against yearly farm-fire counts from the Punjab Remote
Sensing Centre / Punjab Pollution Control Board as reported by PTI (ThePrint, 22 Oct 2025,
https://theprint.in/india/punjab-saw-415-farm-fires-from-sep-15-oct-21-down-from-1510-during-same-period-last-year-data/2768418).
Values used: 2018 50,590; 2019 55,210; 2020 76,590; 2021 71,304; 2022 49,922; 2023 36,663; 2024 10,909.
rho 0.893 on 7 years. Limits: those counts are themselves made from satellite detections (only partly
independent), the window is 15 Sep to 30 Nov while ours is Oct-Nov, and 7 points is a small sample.
ICAR CREAMS bulletins give a different 2020 figure (83,002); we used one source throughout. [verify with M6]

**Negative control.** In Lahul and Spiti, Himachal Pradesh, the critical-period rule flagged 0 of 854 Oct-Nov days
(2012-2025). The rule does not invent surges where there is almost no burning.

## Numbers on screen (as of 2026-11-05)

- Indian Punjab and Haryana: 78% below the typical November, higher than only 4 of 26 past years (first 5 days: 788.0; typical 3,544.7; middle half 1,729.0 to 4,370.8). Provisional.
- Indian Punjab: 77% below, higher than 4 of 26. Haryana: 81% below, higher than 3 of 26.
- Local Normal flag this week: neither sensor above its own normal.
- Critical periods found: Indian Punjab 65 (27 firm), Haryana 46 (10 firm), combined 50 (16 firm).
- Local Normal weeks, combined preset: both elevated 21, VIIRS only 26, MODIS only 36, neither 670.
- Sensor-loss simulation: NOAA-20 scaled by 0.9523 rebuilds the 2025 season at 3,583.6 against 3,500 seen by Suomi NPP (+2.4%).
- Trust score, tile-months: 2001 median 0; 2005 and 2010 median 39; 2015 all 100.
- Size: precache set 2.32 MB of the 8 MB budget; all years 5.78 MB.

## Known limits and assumptions

1. The conversion is M3's fallback fit of the plan's method, not M2's. M1 is the listed reviewer. If M2 delivers her own, it replaces this.
2. `suspect_gap` days in coverage are treated as gaps and filled with MODIS x ratio. This is why 2023-2026 harmonized totals differ slightly from raw VIIRS.
3. A proportional ratio overshoots on peak days: era-B peak days reach 74-79% of tiles burning (Indian Punjab alone hits the 100% cap in 2008-2011) against at most 53% in the VIIRS era. Peak-day values before 2012 are upper-end estimates.
4. Month label is Measured when at least 80% of its data days are VIIRS days (my threshold). Critical periods need at least 1% of tiles (my floor).
5. `hourly.json` and `drift.json` are still placeholders. Hotspot CSVs are header-only.
6. Boundary: Survey of India data supplied by M6. The portal's download terms ask for attribution to the Survey of India; the exact product and licence text are not confirmed, so `manifest.boundary.licence` stays null. [verify with M6]
7. The relay satellite choice (NOAA-20) is provisional.
8. r5 and r7 tile counts are known only for the combined preset, so the resolution check runs on that preset only.
