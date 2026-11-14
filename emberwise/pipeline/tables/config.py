"""EMBERWISE M3: every tunable setting lives here. Nothing else hard-codes a threshold.

Section numbers refer to "EMBERWISE Final Build Plan v4". Items marked [verify]
are unconfirmed in the plan itself or are M3 assumptions the plan does not state.
"""
from pathlib import Path

# --- Schema (plan s5: frozen at H2 as 1.0) ---------------------------------
SCHEMA_VERSION = "1.0"

# --- Paths (plan s5 repo layout) -------------------------------------------
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "web" / "public" / "data"        # shipped JSON
CSV_DIR = DATA_DIR / "hotspots"                     # lazy hotspot CSVs, budgeted separately
PROCESSED_DIR = ROOT / "data" / "processed"         # M1 hand-off (git-ignored)
DOCS_DIR = ROOT / "docs"

# --- Grid (plan s2) ---------------------------------------------------------
H3_RES = 6
H3_FALLBACK_RES = 5
ZONE_RES = 3
SENSITIVITY_RES = [5, 6, 7]

# --- Time (plan s2 eras) ----------------------------------------------------
EPOCH = "2000-11-01"           # day index 0
VIIRS_START = "2012-01-20"     # [verify] Suomi NPP archive start "about 20 Jan"
SNPP_END = "2026-11-02"        # [verify] last Suomi NPP delivery
MOCK_AS_OF = "2026-11-13"
ERAS = [                        # (id, first day, last day or None)
    ("A", "2000-11-01", "2002-06-30"),   # Terra only
    ("B", "2002-07-01", "2011-12-31"),   # Terra U Aqua
    ("C", "2012-01-01", "2026-11-02"),   # Suomi NPP VIIRS
    ("D", "2026-11-03", None),           # relay satellite
]
LABELS = ["Measured", "Estimated", "Indicative", "Provisional"]      # index = label code
ERA_LABEL = {"A": "Indicative", "B": "Estimated", "C": "Measured", "D": "Measured"}
ERA_TRUST_FACTOR = {"A": 0.6, "B": 0.8, "C": 1.0, "D": 1.0}          # plan s6 trust score
MODIS_ONLY_INDICATIVE_AFTER = 2019                                   # plan s6 Local Normal
PROVISIONAL_DAYS = 7           # [verify] "newest days Provisional" for a month in progress

# --- Sensors and products (plan s2, s5) --------------------------------------
SENSOR_SETS = ["TERRA", "MODIS_ALL", "VIIRS_SNPP", "VIIRS_NOAA20", "VIIRS_NOAA21"]   # [verify names with M1]
MODIS_SET = "MODIS_ALL"        # union of Terra and Aqua flags, never a sum
SNPP_SET = "VIIRS_SNPP"
RELAY_SET = "VIIRS_NOAA20"     # [verify] provisional relay guess; final choice at H8
SATELLITES = ["Terra", "Aqua", "Suomi NPP", "NOAA-20", "NOAA-21"]
PRODUCTS = ["SP", "NRT"]       # NRT is always Provisional

# --- Regions (plan s2) -------------------------------------------------------
PRESETS = [
    {"id": "punjab", "label": "Indian Punjab", "sentence": "Indian Punjab", "parts": ["punjab"]},
    {"id": "haryana", "label": "Haryana", "sentence": "Haryana", "parts": ["haryana"]},
    {"id": "punjab_haryana", "label": "Punjab + Haryana", "sentence": "Indian Punjab and Haryana",
     "parts": ["punjab", "haryana"]},
]
PRESET_IDS = [p["id"] for p in PRESETS]
DEFAULT_PRESET = "punjab_haryana"
BASE_REGIONS = ["punjab", "haryana"]            # values of tile_day.region for preset tiles
CONTROL_REGION = {"id": "control", "label": "Control district (candidate: Lahaul and Spiti) [verify]"}

# --- Conversion and trust (plan s2, s6) --------------------------------------
K_SUPPORT = 20                 # shrinkage pseudo tile-days; also f_support = n / (n + k) [verify f_support form]
LEARNING_WINDOW = (2012, 2019)
PILOT_MONTHS = [10, 11]
SATURATION_FRAC = 0.5          # "near saturation" when a day or week exceeds about 50%

# --- This-month bands (plan s6) ----------------------------------------------
BAND_CUTS = [10, 30, 70, 90]
BAND_NAMES = ["much below", "below", "near", "above", "much above"]

# --- Climatology / Local Normal ----------------------------------------------
CLIM_WEEKS = 52                # week = min((day_of_year - 1) // 7, 51)
CLIM_WINDOW_WEEKS = 1          # pool +/- weeks, circular
CLIM_PERCENTILES = [10, 25, 50, 75, 90]

# --- Critical periods (plan s6) ------------------------------------------------
PERIOD_ROLL_DAYS = 7
PERIOD_DOY_WINDOW = 7
PERIOD_PERCENTILE = 90
PERIOD_MAX_GAP = 1
PERIOD_MIN_DAYS = 3
PERIOD_MIN_FRAC = 0.01         # [verify] ignore days whose 7-day mean is under 1% of tiles

# --- Checks (plan s7) ----------------------------------------------------------
RANK_PASS = 0.85
NEG_CONTROL_YEARS = (2012, 2025)
NEG_CONTROL_MONTHS = (10, 11)
REVIEWERS = {"rank_test": "M1", "baselines": "M1", "external_check": "M1", "negative_control": "M1",
             "hide_a_year": "M3", "seam_step": "M2", "nrt_seam": "M3", "ratio_trend": "M3",
             "res_sensitivity": "M5", "era_b_test": "M3", "error_by_level": "M3"}
OWNERS = {"rank_test": "M3", "baselines": "M3", "external_check": "M3", "negative_control": "M3",
          "hide_a_year": "M2", "seam_step": "M5", "nrt_seam": "M2", "ratio_trend": "M2",
          "res_sensitivity": "M3", "era_b_test": "M2", "error_by_level": "M2"}

# --- Size / quantization (plan s5) --------------------------------------------
SIZE_BUDGET_MB = 8.0
PRECACHE_TILE_MONTH_YEARS = 5
PRECACHE = ["regions", "coverage", "validation", "relay_sim", "conversion", "drift", "hourly",
            "climatology", "periods", "narratives", "region_daily", "tile_geometry", "manifest"]
Q_VALUE = 1                    # decimals: harmonized values and ranges
Q_FRAC = 3                     # decimals: region fractions
Q_FRAC_TILE = 2                # decimals: tile-month frac_burning
Q_RATIO = 3
Q_COORD = 4                    # about 11 m

# --- Wording (plan s3, s6, s12) ------------------------------------------------
# Phrases that must never appear in any output. Assembled so this file does not contain them.
BANNED_PHRASES = ["clock-" + "corrected", "drift-" + "corrected", "F" + "CA", "Fire Clock " + "Activity"]
SAFETY_DISCLAIMER = "Not an official fire alert, perimeter map or emergency tool."
RANGE_NOTE = "Range of yearly ratios, widened by tested error; not a confidence interval."
INDEX_NOTE = "Relative burning activity at VIIRS scale. It is not fire size, burned area or total fires."

# --- hotspots CSV (plan s5; owner M1) --------------------------------------------
HOTSPOT_COLUMNS = ["satellite", "date", "time_utc", "local_solar_time", "lat", "lon", "frp",
                   "confidence", "daynight", "product"]
