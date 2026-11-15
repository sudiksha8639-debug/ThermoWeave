"""Every tunable for the model checks, in one place."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]                  # the emberwise folder
REAL_PROCESSED = ROOT.parent / "data" / "processed"         # M1's hand-off at the repo root
PROCESSED_DIR = REAL_PROCESSED if (REAL_PROCESSED / "tile_day.parquet").exists() else ROOT / "data" / "processed"
WEB_DATA_DIR = ROOT / "web" / "public" / "data"
DOCS_DIR = ROOT / "docs"

BASE_REGIONS = ["punjab", "haryana"]                        # region names in tile_day.parquet
PRESETS = {"indian_punjab": ["punjab"], "haryana": ["haryana"], "punjab_haryana": ["punjab", "haryana"]}
DEFAULT_PRESET = "punjab_haryana"
DRIFT_REGION_ORDER = ["indian_punjab", "haryana", "punjab_haryana"]   # meaning of drift.json region codes 0, 1, 2

SNPP, MODIS = "VIIRS_SNPP", "MODIS_ALL"
RELAY_CANDIDATES = {"VIIRS_NOAA20": "NOAA-20", "VIIRS_NOAA21": "NOAA-21"}   # sensor_set -> name in drift.json
SNPP_NAME = "Suomi NPP"
SNPP_END = "2026-11-02"                                      # last Suomi NPP delivery
PILOT_MONTHS = [10, 11]
TARGET_LOCAL_HOUR = 13.5                                     # plan s2: relay closest to 13:30 local solar time
MIN_OVERLAP_SEASONS = 2                                      # plan s2: at least two shared seasons
NOAA20_LAST_CALIBRATION_YEAR = 2023                          # plan s2: NOAA-20 calibrated on pre-2024 years only
RANK_PASS = 0.85                                             # plan s7
HELD_OUT_SEASON = 2021                                       # the earlier held-out season for the second relay test

LEARNING_WINDOW = (2012, 2019)
SATURATION_FRAC = 0.5                                        # plan s6: "near saturation" above about half the tiles
NRT_SHIFT_LIMIT_PCT = 10.0                                   # plan s6: apply an NRT factor above about 10%
