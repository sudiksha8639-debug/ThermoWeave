"""The data contract (plan s5): one schema per file, plus cross-field checks.

Single source of truth for the schema. docs/schema.md is generated from this
module and check_contract validates against it. Every object is closed: a
missing OR an extra field fails. Owner M3, deputy M6.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import polars as pl
from jsonschema import Draft202012Validator

from . import config as C
from .timeutil import day_index

# ------------------------------------------------------------ schema builders

def _d(schema: dict, desc: str) -> dict:
    return {**schema, "description": desc} if desc else schema


def num(desc: str = "", null: bool = False) -> dict:
    """Number; null=True allows null (missing data)."""
    return _d({"type": ["number", "null"] if null else "number"}, desc)


def integer(desc: str = "", null: bool = False) -> dict:
    """Integer."""
    return _d({"type": ["integer", "null"] if null else "integer"}, desc)


def string(desc: str = "", enum: list | None = None, null: bool = False) -> dict:
    """String, optionally restricted to enum."""
    s: dict = {"type": ["string", "null"] if null else "string"}
    if enum:
        s["enum"] = list(enum) + ([None] if null else [])
    return _d(s, desc)


def boolean(desc: str = "", null: bool = False) -> dict:
    """Boolean."""
    return _d({"type": ["boolean", "null"] if null else "boolean"}, desc)


def arr(items: dict, desc: str = "", n: int | None = None) -> dict:
    """Array; n fixes the length."""
    s: dict = {"type": "array", "items": items}
    if n is not None:
        s["minItems"] = s["maxItems"] = n
    return _d(s, desc)


def obj(props: dict, desc: str = "", null: bool = False) -> dict:
    """Closed object: every property required, nothing extra allowed."""
    return _d({"type": ["object", "null"] if null else "object", "properties": props,
               "required": list(props), "additionalProperties": False}, desc)


def per_preset(value: dict, desc: str = "") -> dict:
    """Object keyed by exactly the three preset ids."""
    return obj({pid: value for pid in C.PRESET_IDS}, desc)


ENVELOPE = {
    "schema_version": _d({"const": C.SCHEMA_VERSION}, "Contract version; bumped on any schema change."),
    "generated_at": string("UTC build time, ISO 8601."),
    "mock": boolean("true = synthetic mock data, never to be shown or quoted as real."),
}


def contract(props: dict, desc: str) -> dict:
    """A top-level contract file: envelope + its own fields."""
    return obj({**ENVELOPE, **props}, desc)


LABEL = string("Value label.", enum=C.LABELS)
LABEL_CODES = arr(string(), "Label names; a label code is an index into this list.", n=len(C.LABELS))
REGION_ID = string("Preset id.", enum=C.PRESET_IDS)
NNUM = arr(num(null=True))
NINT = arr(integer(null=True))


def col(base: dict, desc: str) -> dict:
    """Array column with a description."""
    return {**base, "description": desc}

# ------------------------------------------------------------------ contracts

REGIONS = contract({
    "regions": arr(obj({
        "id": string("Region id used as a key in other files."),
        "label": string("Display label."),
        "kind": string("preset = selectable in the app; control = Lab negative control only.",
                       enum=["preset", "control"]),
        "default": boolean("true for the preset the app opens with."),
        "tiles_in_scope": obj({f"r{r}": integer(f"Tiles whose centroid is inside, H3 res {r}.", null=(r != C.H3_RES))
                               for r in C.SENSITIVITY_RES},
                              "Clipped tile counts; r6 is the saturation cap. r5/r7 are null where M1 has not supplied them."),
        "boundary_source": string("Boundary data source."),
        "bbox": arr(num(), "[west, south, east, north] in degrees.", n=4),
    })),
}, "M6, M1 -> M3, M4. Three presets and the control district.")

COVERAGE = contract({
    "epoch": string("Date of day index 0."),
    "sensor_sets": arr(string(), "Sensor-set names; code = index."),
    "products": arr(string(), "Product names; code = index."),
    "columns": obj({
        "sensor_set": col(arr(integer()), "Sensor-set code."),
        "product": col(arr(integer()), "Product code (SP or NRT)."),
        "start": col(arr(integer()), "First day of the run, days since epoch (local solar date)."),
        "end": col(arr(integer()), "Last day of the run, inclusive."),
        "has_data": col(arr(boolean()), "false = empty or failed files: a gap, never zero."),
    }, "Run-length form of (date, sensor_set, product, has_data). Days in no run = sensor did not exist."),
}, "M1 -> M3, M5. Which sensor had data on which days (Jan 2012 is partial).")

HOURLY = contract({
    "satellites": arr(string(), "Satellite names; code = index."),
    "columns": obj({
        "region": col(arr(integer()), "Preset index (manifest.presets)."),
        "satellite": col(arr(integer()), "Satellite code."),
        "year": col(arr(integer()), "Year."),
        "month": col(arr(integer()), "Month 1-12."),
        "local_hour": col(arr(integer()), "Local solar hour 0-23."),
        "n_hotspots": col(arr(integer()), "Hotspots in that hour bin."),
    }, "Sparse: rows with n_hotspots > 0 only."),
}, "M1 -> M5. When each satellite looked (Fire Clock Dial).")

DRIFT = contract({
    "satellites": arr(string(), "Satellite names; code = index."),
    "columns": obj({
        "satellite": col(arr(integer()), "Satellite code."),
        "year": col(arr(integer()), "Year."),
        "region": col(arr(integer()), "Preset index."),
        "median_local_hour": col(arr(num()), "Median local solar hour of daytime detections."),
        "iqr": col(arr(num()), "Interquartile range of local solar hour."),
    }),
    "modis_viirs_ratio_by_year": obj({
        "months": arr(integer(), "Pilot months the ratio covers."),
        "learning_window": arr(integer(), "[first, last] year of the learning window.", n=2),
        "columns": obj({
            "year": col(arr(integer()), "Year, 2012 onward."),
            "region": col(arr(integer()), "Preset index."),
            "ratio": col(NNUM, "VIIRS tile-days / MODIS tile-days; null if MODIS is 0."),
        }),
    }, "Evidence chart: does the MODIS-to-VIIRS relationship move after about 2020?"),
}, "M1 -> M5. Overpass-time drift per satellite, plus the ratio-by-year series.")

CONVERSION = contract({
    "unit": string("What the ratio converts."),
    "learning_window": arr(integer(), "[first, last] year the ratios were learned on.", n=2),
    "k": num("Shrinkage pseudo tile-days."),
    "zones": arr(string(), "H3 res-3 zone ids; zone code = index."),
    "columns": obj({
        "zone": col(arr(integer()), "Zone code."),
        "month": col(arr(integer()), "Calendar month 1-12."),
        "era": col(arr(string(enum=["A", "B"])), "A = Terra only, B = Terra U Aqua."),
        "ratio": col(NNUM, "VIIRS tile-days per MODIS tile-day (shrunk toward the region ratio)."),
        "lo": col(NNUM, "10th percentile of yearly ratios."),
        "hi": col(NNUM, "90th percentile of yearly ratios."),
        "widened_lo": col(NNUM, "lo widened by tested error; used for eras A and B."),
        "widened_hi": col(NNUM, "hi widened by tested error; used for eras A and B."),
        "n_support": col(arr(integer()), "MODIS tile-days behind the zone-month ratio."),
    }),
    "ratio_by_year": obj({
        "columns": obj({
            "zone": col(arr(integer()), "Zone code."),
            "month": col(arr(integer()), "Calendar month."),
            "year": col(arr(integer()), "Year."),
            "ratio": col(NNUM, "Unshrunk yearly ratio; null if MODIS is 0."),
            "in_learning_window": col(arr(boolean()), "true if the year was used to learn the ratio."),
        }),
    }, "Yearly ratios for the pilot months."),
}, "M2 -> M3, M5. Per zone-month MODIS to VIIRS-scale conversion.")


def check(result: dict, desc: str) -> dict:
    """A validation block: owner, a different reviewer, status and a result."""
    return obj({
        "owner": string("Who wrote the check."),
        "reviewer": string("Who reviews it before merge (never the owner)."),
        "status": string("pending = not yet run on real data.", enum=["pending", "done"]),
        "label": LABEL,
        "result": result,
    }, desc)


def typed(props: dict) -> dict:
    """Result owned by M3: closed and typed; null while pending."""
    return obj(props, "null while pending.", null=True)


OPEN_RESULT = _d({"type": ["object", "null"]},
                 "Free-form object defined by whoever ran the check; null while pending. See docs/STAGE_D_RESULTS.md.")
_COMPARE = {
    "per_zone_month": num("Error of the per zone-month conversion.", null=True),
    "global_ratio": num("Error using one global ratio.", null=True),
    "no_conversion": num("Error using raw MODIS tile-days.", null=True),
    "beats_both": boolean("per_zone_month lower than both baselines.", null=True),
}
_RANK = {
    "method": string("How seasonality was removed."),
    "rho": num("Spearman rho, as found.", null=True),
    "threshold": num("Pass mark."),
    "passed": boolean("rho >= threshold.", null=True),
    "n": integer("Pairs."),
}

VALIDATION = contract({
    "hide_a_year": check(obj({
        "columns": obj({
            "region": col(arr(integer()), "Preset index."),
            "year": col(arr(integer()), "Hidden year (within the learning window)."),
            "predicted": col(NNUM, "VIIRS-scale tile-days predicted from MODIS alone."),
            "actual": col(NNUM, "VIIRS tile-days observed."),
            "in_range": col(arr(boolean(null=True)), "actual inside the predicted range."),
        }),
    }), "M2 / M3. Predict each hidden year from MODIS alone."),
    "error_by_level": check(OPEN_RESULT, "M2 / M3. Hide-a-year error and bias by activity third."),
    "baselines": check(typed({
        "metric": string("Error metric."),
        "n": integer("Preset-years compared."),
        **_COMPARE,
        "zone_month_level": obj({"n": integer("Zone-month-years compared."), **_COMPARE},
                                "The same comparison for each zone, month and hidden year.", null=True),
    }), "M3 / M1. Per zone-month conversion against two simpler baselines, at preset-year level."),
    "rank_test": check(typed({
        **_RANK,
        "other_method": obj(dict(_RANK), "The same test by the other allowed method.", null=True),
    }), "M3 / M1. Does the harmonized record rank periods the way VIIRS does?"),
    "seam_step": check(OPEN_RESULT, "M5 / M2. Size of the 2012 step before and after harmonizing."),
    "era_b_test": check(OPEN_RESULT, "M2 / M3. Terra to Terra U Aqua conversion on 2003-2011."),
    "ratio_trend": check(OPEN_RESULT, "M2 / M3. Ratio stability over the learning window."),
    "res_sensitivity": check(OPEN_RESULT, "M1 data, M3 compare / M5. Top periods at res 5/6/7."),
    "nrt_seam": check(OPEN_RESULT, "M1 pairs, M2 / M3. NRT vs SP shift on the same satellite."),
    "external_check": check(typed({
        "source": string("Outside series used."),
        "source_limits": string("Known limits of that series."),
        "rho": num("Spearman rho, as found (a weak result is reported, not hidden).", null=True),
        "n": integer("Years compared."),
        "years": arr(integer(), "Years compared."),
    }), "M3, M6 sources / M1. Yearly Oct-Nov harmonized activity against one outside series."),
    "negative_control": check(typed({
        "region": string("Control region id."),
        "years": arr(integer(), "[first, last] year.", n=2),
        "days_tested": integer("Oct-Nov days tested."),
        "false_anomalies": integer("Days flagged where none are expected.", null=True),
        "rate": num("false_anomalies / days_tested.", null=True),
    }), "M3 / M1. False anomalies in the low-fire control district (tile-days only)."),
}, "M2, M3, M5 -> M5. Validation evidence, shown in the Lab whatever it reveals.")

RELAY_SIM = contract({
    "region": REGION_ID,
    "season": integer("Year of the Oct-Nov season simulated."),
    "relay_satellite": string("Satellite that takes over from Suomi NPP."),
    "overlap_years": arr(integer(), "Shared years used to align the relay (excluding the season)."),
    "epoch": string("Date of day index 0."),
    "columns": obj({
        "date": col(arr(integer()), "Days since epoch (local solar date)."),
        "suomi_actual": col(NNUM, "Suomi NPP tile-days actually observed."),
        "relay_built": col(NNUM, "Series rebuilt through the relay as if Suomi NPP had stopped."),
        "pct_diff": col(NNUM, "Percent difference, relay_built vs suomi_actual; null if actual is 0."),
    }),
}, "M2 -> M5, M6. Sensor-Loss simulation on the last full season.")

TILE_MONTH = contract({
    "year": integer("Calendar year of this file (one file per year, lazy loaded)."),
    "label_codes": LABEL_CODES,
    "blocks": obj({
        "ym": col(arr(integer()), "Index into manifest.months; one per month block, ascending."),
        "label": col(arr(integer()), "Label code of the month."),
        "start": col(arr(integer()), "Row offsets: block b = rows start[b] .. start[b+1]-1. Length = blocks + 1."),
    }, "Rows are sorted by month; ym and label are stored once per month, not once per row."),
    "columns": obj({
        "tile": col(arr(integer()), "Index into tile_geometry.tiles."),
        "raw_hotspots": col(arr(integer()), "Naive splice: hotspots from the day's source sensor (MODIS before VIIRS, VIIRS after). Never a sum of both."),
        "raw_tile_days": col(arr(integer()), "Naive splice in tile-days."),
        "raw_modis": col(NINT, "MODIS tile-days (Terra U Aqua)."),
        "raw_viirs": col(NINT, "VIIRS tile-days; null in months before VIIRS existed."),
        "harm": col(NNUM, "Harmonized relative burning activity, VIIRS-scale tile-days, capped at days in month."),
        "lo": col(NNUM, "Lower range of harm."),
        "hi": col(NNUM, "Upper range of harm."),
        "trust": col(NINT, "Trust score 0-100; null = n/a (no activity or missing)."),
        "frac_burning": col(NNUM, "harm / days in month, 0-1."),
    }, "Sparse: one row per tile-month with any detection. No row = no detection."),
}, "M3 -> M4. File name tile_month_YYYY.json.")

TILE_GEOMETRY = contract({
    "res": integer("H3 resolution of tiles."),
    "tiles": arr(string(), "H3 cell ids; position = tile index used everywhere."),
    "lng": col(arr(num()), "Centroid longitude."),
    "lat": col(arr(num()), "Centroid latitude."),
    "verts": col(arr(num()), "Hexagon vertices, 12 numbers per tile: lng,lat x 6."),
    "regions": arr(string(), "Base region ids; region code = index."),
    "region": col(arr(integer()), "Base region code per tile."),
    "zones": arr(string(), "H3 res-3 zone ids; zone code = index."),
    "zone": col(arr(integer()), "Zone code per tile."),
    "fallback": obj({
        "res": integer("Coarser H3 resolution."),
        "tiles": arr(string(), "H3 cell ids at the coarser resolution."),
        "verts": col(arr(num()), "12 numbers per coarse tile."),
        "parent": col(arr(integer()), "For each res-6 tile, index of its coarse parent."),
    }, "Res-5 grid: draw the map at res 5 if the data is too heavy, keep res 6 for numbers."),
}, "M3 -> M4. Precomputed hexagons so the browser needs no H3 library.")

REGION_DAILY = contract({
    "epoch": string("Date of day index 0; array position = days since epoch."),
    "n_days": integer("Length of every series."),
    "label_codes": LABEL_CODES,
    "presets": per_preset(obj({
        "tile_count": integer("In-scope res-6 tiles; cap for harm."),
        "modis_td": col(NINT, "Tiles with a MODIS detection; null when MODIS had no data."),
        "viirs_td": col(NINT, "Tiles with a VIIRS detection; null before VIIRS existed or in a gap."),
        "modis_hotspots": col(NINT, "MODIS hotspot count (plain-count view)."),
        "viirs_hotspots": col(NINT, "VIIRS hotspot count (plain-count view)."),
        "harm": col(NNUM, "Harmonized relative burning activity, VIIRS-scale tile-days."),
        "lo": col(NNUM, "Lower range."),
        "hi": col(NNUM, "Upper range."),
        "frac_burning": col(NNUM, "harm / tile_count; above about 0.5 = near saturation."),
        "pct_rank": col(NNUM, "Position 0-100 of harm among all years within +/-7 days of the same day of year."),
        "label": col(arr(integer()), "Label code per day."),
    })),
}, "M3 -> M4. Daily series for the three presets only.")

_PCT = {f"p{p}": arr(num(null=True), f"P{p} per week of year.", n=C.CLIM_WEEKS) for p in C.CLIM_PERCENTILES}
CLIMATOLOGY = contract({
    "weeks": integer("Weeks per year (week = min((day_of_year-1)//7, 51))."),
    "window_weeks": integer("Weeks pooled either side, circular (late December joins January)."),
    "unit": string("Unit of the percentiles."),
    "presets": per_preset(obj({s: obj({**_PCT, "n_years": integer("Complete years behind the percentiles.")})
                               for s in ("modis", "viirs")})),
}, "M3 -> M4. Per-sensor weekly percentiles from each sensor's own history (Local Normal).")

PERIODS = contract({
    "method": obj({k: integer(d) for k, d in (
        ("roll_days", "Rolling window."), ("percentile", "Threshold percentile."),
        ("doy_window", "+/- days around each day of year."), ("max_gap", "Gaps merged."),
        ("min_days", "Shortest period kept."))}),
    "presets": per_preset(arr(obj({
        "start": string("First day."),
        "end": string("Last day."),
        "days": integer("Length."),
        "status": string("firm = whole lower range above P90; otherwise tentative.", enum=["firm", "tentative"]),
        "severity": num("Excess over the median, as a ratio (0.8 = 80% above).", null=True),
        "peak_date": string("Day of the highest 7-day value."),
        "peak_value": num("Highest 7-day mean harmonized value."),
        "label": LABEL,
        "sentence": string("Template-written sentence."),
    }))),
}, "M3 -> M4. Critical periods of unusually high relative burning activity.")

NARRATIVES = contract({
    "as_of": string("Last day of data."),
    "templates": _d({"type": "object", "additionalProperties": {"type": "string"}, "minProperties": 1},
                    "Sentence templates and fixed wording by key. Template-written, never AI-written."),
    "local_normal_explanations": obj({k: string() for k in ("both_elevated", "viirs_only", "modis_only", "neither")},
                                     "One possible explanation per flag (hypothesis, not conclusion)."),
    "presets": per_preset(obj({
        "this_month": obj({
            "month": string("Month described, YYYY-MM."),
            "in_progress": boolean("true = compared with the same days of past years."),
            "days_compared": integer("Days of the month used."),
            "value": num("Harmonized activity over those days.", null=True),
            "typical_median": num("Median of the same days in other years.", null=True),
            "pct_diff": num("Percent difference from the median.", null=True),
            "rank_higher_than": integer("Past years this year exceeds.", null=True),
            "rank_of": integer("Past years compared."),
            "middle_half": arr(num(null=True), "[P25, P75] of past years.", n=2),
            "percentile": num("Position among past years, 0-100.", null=True),
            "band": string("Band label.", enum=C.BAND_NAMES, null=True),
            "basis": string("Evidence the number rests on."),
            "label": LABEL,
            "near_saturation": boolean("true if a day in the window exceeded about 50% of tiles."),
            "variant": string("Template keys used."),
            "sentence": string("Plain sentence shown on the This-month card."),
        }),
        "local_normal": obj({
            "week_start": string("First day of the latest complete week."),
            "flag": string("Flag.", enum=["both_elevated", "viirs_only", "modis_only", "neither"], null=True),
            "label": LABEL,
            "sentence": string("Cautious wording for the badge."),
        }),
    })),
}, "M3 -> M4. This-month numbers, Local Normal badge and plain sentences per preset.")

MANIFEST = contract({
    "as_of": string("Last day of data."),
    "months": arr(string(), "All months YYYY-MM; ym index = position."),
    "provisional_from": string("First Provisional month (first month using NRT); null if none.", null=True),
    "eras": arr(obj({"id": string("Era id."), "start": string("First day."),
                     "end": string("Last day; null = ongoing.", null=True),
                     "label": LABEL, "trust_factor": num("f_era in the trust score.")})),
    "labels": LABEL_CODES,
    "presets": arr(string(), "Preset ids, in preset-index order."),
    "default_preset": string("Preset the app opens with."),
    "control_region": string("Control region id."),
    "tile_count": integer("Tiles in tile_geometry."),
    "relay_satellite": string("Relay sensor set in use."),
    "firms_download_dates": _d({"type": "object", "additionalProperties": {"type": ["string", "null"]}},
                               "Product -> download date (M1)."),
    "product_versions": _d({"type": "object", "additionalProperties": {"type": ["string", "null"]}},
                           "Product -> version (M1)."),
    "model_version": string("Conversion model version.", null=True),
    "boundary": obj({"source": string("Boundary source.", null=True), "licence": string("Licence.", null=True)}),
    "ai_use_note": string("AI-tools disclosure."),
    "safety_disclaimer": string("Shown on every screen."),
    "budget_mb": num("Size budget."),
    "precache": arr(string(), "Files the service worker precaches: paths relative to the data folder."),
    "files": arr(obj({"path": string("Path relative to web/public/data."),
                      "contract": string("Contract name."),
                      "bytes": integer("Uncompressed size."),
                      "sha256": string("File hash.")})),
}, "M1, M2, M3 -> M6. Index of shipped files, hashes, provenance and shared lookups.")

# name -> (schema, glob under web/public/data)
CONTRACTS: dict[str, tuple[dict, str]] = {
    "regions": (REGIONS, "regions.json"), "coverage": (COVERAGE, "coverage.json"),
    "hourly": (HOURLY, "hourly.json"), "drift": (DRIFT, "drift.json"),
    "conversion": (CONVERSION, "conversion.json"), "validation": (VALIDATION, "validation.json"),
    "relay_sim": (RELAY_SIM, "relay_sim.json"), "tile_month": (TILE_MONTH, "tile_month_*.json"),
    "tile_geometry": (TILE_GEOMETRY, "tile_geometry.json"), "region_daily": (REGION_DAILY, "region_daily.json"),
    "climatology": (CLIMATOLOGY, "climatology.json"), "periods": (PERIODS, "periods.json"),
    "narratives": (NARRATIVES, "narratives.json"), "manifest": (MANIFEST, "manifest.json"),
}

# Pipeline hand-offs (Parquet under data/processed). name -> (file, {column: kind}, description)
PARQUET: dict[str, tuple[str, dict[str, str], str]] = {
    "tile_day": ("tile_day.parquet", {
        "region": "str", "h3_r6": "str", "zone_r3": "str", "date": "date", "sensor_set": "str",
        "product": "str", "frp_sum": "float", "n_hotspots": "int", "n_tile_day": "int",
    }, "M1 -> M2, M3. Sparse: one row per region, res-6 tile, local solar date and sensor set with a "
       "clean DAY-pass hotspot (plan s2: day passes only for the headline). n_tile_day is 1 per row; "
       "MODIS_ALL is the union of Terra and Aqua flags, never a sum. region is punjab, haryana or control."),
    "tiles": ("tiles.parquet", {"region": "str", "h3_r6": "str", "zone_r3": "str"},
              "M1 -> M3. Every in-scope res-6 tile, including tiles that never burn; "
              "needed for geometry and tile counts."),
}
_KINDS = {"str": (pl.String, pl.Categorical, pl.Enum), "date": (pl.Date,),
          "float": (pl.Float32, pl.Float64),
          "int": (pl.Int8, pl.Int16, pl.Int32, pl.Int64, pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64)}

# ----------------------------------------------------------------- validation

def find_banned(text: str) -> list[str]:
    """Banned phrases present in text (whole words; the acronym is case-sensitive)."""
    hits = []
    for p in C.BANNED_PHRASES:
        flags = 0 if p.isupper() else re.I
        if re.search(r"(?<![A-Za-z])" + re.escape(p) + r"(?![A-Za-z])", text, flags):
            hits.append(p)
    return hits


def _columns_equal_length(node, where: str, errors: list[str]) -> None:
    """Every object under a key named 'columns' must hold equal-length arrays."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "columns" and isinstance(v, dict):
                lens = {name: len(a) for name, a in v.items() if isinstance(a, list)}
                if len(set(lens.values())) > 1:
                    errors.append(f"{where}.columns: unequal column lengths {lens}")
            _columns_equal_length(v, f"{where}.{k}", errors)


def _extra_checks(name: str, d: dict) -> list[str]:
    """Cross-field rules JSON Schema cannot express."""
    e: list[str] = []
    if name == "region_daily":
        cut = day_index(C.VIIRS_START)
        for pid, p in d["presets"].items():
            for k, v in p.items():
                if isinstance(v, list) and len(v) != d["n_days"]:
                    e.append(f"presets.{pid}.{k}: length {len(v)} != n_days {d['n_days']}")
            for k in ("viirs_td", "viirs_hotspots"):
                if any(v is not None for v in p[k][:cut]):
                    e.append(f"presets.{pid}.{k}: must be null before {C.VIIRS_START} (a gap, never zero)")
    if name == "tile_geometry":
        n = len(d["tiles"])
        for k in ("lng", "lat", "region", "zone"):
            if len(d[k]) != n:
                e.append(f"{k}: length {len(d[k])} != tiles {n}")
        if len(d["verts"]) != 12 * n:
            e.append(f"verts: expected {12 * n} numbers, got {len(d['verts'])}")
        fb = d["fallback"]
        if len(fb["parent"]) != n or len(fb["verts"]) != 12 * len(fb["tiles"]):
            e.append("fallback: parent/verts lengths do not match")
    if name == "tile_month":
        c, b = d["columns"], d["blocks"]
        if (len(b["start"]) != len(b["ym"]) + 1 or len(b["label"]) != len(b["ym"]) or b["start"][0] != 0
                or b["start"][-1] != len(c["tile"]) or b["start"] != sorted(b["start"])):
            e.append("blocks: ym/label/start do not describe the rows")
        if any(t is not None and not 0 <= t <= 100 for t in c["trust"]):
            e.append("columns.trust: outside 0-100")
        if any(h == 0 and t is not None for h, t in zip(c["harm"], c["trust"])):
            e.append("columns.trust: must be null (n/a) where harm is 0")
    if name == "regions":
        ids = sorted(r["id"] for r in d["regions"])
        if ids != sorted(C.PRESET_IDS + [C.CONTROL_REGION["id"]]):
            e.append(f"regions: ids {ids} are not the three presets plus the control")
        if [r["id"] for r in d["regions"] if r["default"]] != [C.DEFAULT_PRESET]:
            e.append(f"regions: exactly {C.DEFAULT_PRESET} must be the default")
    if name == "validation":
        for k, v in d.items():
            if isinstance(v, dict) and v.get("owner") == v.get("reviewer"):
                e.append(f"{k}: reviewer must differ from owner")
    return e


def validate_file(name: str, path: Path) -> list[str]:
    """Validate one JSON file against contract `name`. Returns error strings."""
    text = Path(path).read_text(encoding="utf-8")
    errors = [f"banned phrase present: {b}" for b in find_banned(text)]
    try:
        data = json.loads(text)
    except json.JSONDecodeError as ex:
        return errors + [f"not valid JSON: {ex}"]
    found = sorted(Draft202012Validator(CONTRACTS[name][0]).iter_errors(data), key=lambda x: str(list(x.path)))
    for err in found[:20]:
        errors.append(f"{'.'.join(str(p) for p in err.path) or '<root>'}: {err.message[:200]}")
    if not errors:
        _columns_equal_length(data, "", errors)
        errors += _extra_checks(name, data)
    return errors


def validate_parquet(name: str, path: Path) -> list[str]:
    """Validate a pipeline Parquet file: exact column set and column kinds."""
    _, cols, _ = PARQUET[name]
    schema = pl.read_parquet_schema(path)
    errors = [f"missing column: {c}" for c in cols if c not in schema]
    errors += [f"extra column: {c}" for c in schema if c not in cols]
    for c, kind in cols.items():
        if c in schema and not isinstance(schema[c], _KINDS[kind]):
            errors.append(f"{c}: expected {kind}, got {schema[c]}")
    if name == "tile_day" and not errors:
        df = pl.read_parquet(path, columns=["sensor_set", "product", "region"])
        for c, allowed in (("sensor_set", C.SENSOR_SETS), ("product", C.PRODUCTS),
                           ("region", C.BASE_REGIONS + [C.CONTROL_REGION["id"]])):
            bad = set(df[c].cast(pl.String).unique().to_list()) - set(allowed)
            if bad:
                errors.append(f"{c}: unexpected values {sorted(bad)}")
    return errors


def validate_hotspots_csv(path: Path) -> list[str]:
    """A hotspot CSV must start with exactly the contract header."""
    first = Path(path).read_text(encoding="utf-8").splitlines()[:1]
    want = ",".join(C.HOTSPOT_COLUMNS)
    return [] if first == [want] else [f"header {first} != expected [{want}]"]


def validate_tree(data_dir: Path | None = None, processed_dir: Path | None = None) -> dict[str, list[str]]:
    """Validate everything on disk. Missing files and files outside the contract are errors."""
    data_dir, processed_dir = Path(data_dir or C.DATA_DIR), Path(processed_dir or C.PROCESSED_DIR)
    report: dict[str, list[str]] = {}
    known: set[Path] = set()
    for name, (_, pattern) in CONTRACTS.items():
        paths = sorted(data_dir.glob(pattern))
        if not paths:
            report[f"{name} ({pattern})"] = ["file missing"]
        for p in paths:
            known.add(p)
            report[p.name] = validate_file(name, p)
    csvs = sorted((data_dir / "hotspots").glob("*.csv"))
    if not csvs:
        report["hotspots_csv (hotspots/*.csv)"] = ["file missing"]
    for p in csvs:
        report[f"hotspots/{p.name}"] = validate_hotspots_csv(p)
    for p in sorted(data_dir.glob("*")):
        if p.is_file() and p not in known:
            report[p.name] = ["file is not part of the contract (extra file)"]
    for name, (fname, _, _) in PARQUET.items():
        p = processed_dir / fname
        report[f"processed/{fname}"] = validate_parquet(name, p) if p.exists() else ["file missing"]
    man = data_dir / "manifest.json"
    if man.exists() and not report.get("manifest.json"):
        listed = {f["path"]: f["bytes"] for f in json.loads(man.read_text(encoding="utf-8"))["files"]}
        on_disk = {p.relative_to(data_dir).as_posix(): p.stat().st_size for p in data_dir.rglob("*")
                   if p.is_file() and p.name != "manifest.json"}
        if listed != on_disk:
            diff = sorted(set(listed.items()) ^ set(on_disk.items()))[:6]
            report["manifest.json"] = [f"file list does not match files on disk: {diff}"]
    return report
