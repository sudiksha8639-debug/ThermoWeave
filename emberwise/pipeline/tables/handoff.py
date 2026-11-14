"""Turn M1's real hand-off into the contract's upstream JSON files (Stage C).

M1 writes into the repo-root data/processed folder:
  tile_day.parquet, tiles.parquet   contract shape, validated by check_contract
  regions.json                      M1's own shape (tile lists, counts, boundary source)
  coverage.parquet                  date, sensor_set, product, has_data (+ extra columns, ignored)

This module writes into web/public/data: regions.json, coverage.json, and, while
config.USE_FALLBACK_CONVERSION is True, conversion.json, the hide-a-year block of
validation.json and relay_sim.json. hourly.json and drift.json wait for M1's Drop 2.
"""
from __future__ import annotations

import json
from pathlib import Path

import h3
import numpy as np
import polars as pl

from . import config as C
from . import conversion as CV
from .jsonio import envelope, read_json, write_json
from .timeutil import day_index, parse

FALLBACK_MODEL = "M3 fallback fit of the plan s6 method from tile_day; not yet reviewed or replaced by M2"

# ------------------------------------------------------------------- regions

def _bbox(cells: list[str]) -> list[float]:
    ll = np.array([h3.cell_to_latlng(c) for c in cells])
    return [round(float(v), 2) for v in (ll[:, 1].min(), ll[:, 0].min(), ll[:, 1].max(), ll[:, 0].max())]


def regions_from_m1(m1: dict, tiles: pl.DataFrame) -> dict:
    """regions.json body from M1's regions file and tiles.parquet.

    r6 counts come from tiles.parquet. r5 and r7 are known only for the combined preset
    (M1's in_scope_tile_count); they are null elsewhere rather than guessed.
    """
    counts = m1.get("in_scope_tile_count", {})
    source = m1.get("boundary_source", "[verify] boundary source not supplied")
    out = []
    for p in C.PRESETS:
        cells = tiles.filter(pl.col("region").is_in(p["parts"]))["h3_r6"].to_list()
        listed = m1.get("presets", {}).get(p["id"])
        if listed is not None and set(listed) != set(cells):
            raise ValueError(f"regions.json and tiles.parquet disagree on the tiles of preset {p['id']}")
        whole = p["id"] == C.DEFAULT_PRESET
        scope = {f"r{r}": (len(cells) if r == C.H3_RES else (counts.get(f"r{r}") if whole else None))
                 for r in C.SENSITIVITY_RES}
        out.append({"id": p["id"], "label": p["label"], "kind": "preset", "default": whole,
                    "tiles_in_scope": scope, "boundary_source": source, "bbox": _bbox(cells)})
    control = tiles.filter(pl.col("region") == C.CONTROL_REGION["id"])["h3_r6"].to_list()
    if control:
        out.append({"id": C.CONTROL_REGION["id"], "label": C.CONTROL_REGION["label"], "kind": "control",
                    "default": False,
                    "tiles_in_scope": {f"r{r}": (len(control) if r == C.H3_RES else None) for r in C.SENSITIVITY_RES},
                    "boundary_source": source, "bbox": _bbox(control)})
    return {"regions": out}

# ------------------------------------------------------------------ coverage

def _runs(sset: str, has: np.ndarray, prod: np.ndarray, exists: np.ndarray) -> list[tuple]:
    """Run-length encode one sensor set's days into (sensor_set, product, start, end, has_data)."""
    out, start = [], None
    for i in range(len(exists) + 1):
        same = (i < len(exists) and start is not None and exists[i]
                and has[i] == has[start] and prod[i] == prod[start])
        if start is not None and not same:
            out.append((sset, C.PRODUCTS[prod[start]], start, i - 1, bool(has[start])))
            start = None
        if start is None and i < len(exists) and exists[i]:
            start = i
    return out


def last_sp_day(td: pl.DataFrame) -> dict:
    """{sensor_set: day index of its last SP row}; used when coverage has no product column."""
    g = td.filter(pl.col("product") == "SP").group_by("sensor_set").agg(pl.col("date").max().alias("d"))
    return {s: day_index(d) for s, d in g.iter_rows()}


def coverage_from_parquet(path: Path, n_days: int, td: pl.DataFrame | None = None) -> list[tuple]:
    """Coverage runs from M1's coverage.parquet.

    Needs date, sensor_set, has_data. Optional: product (else SP up to the sensor set's last SP
    fire row in tile_day, NRT after) and suspect_gap (treated as no data when SUSPECT_GAP_IS_GAP).
    Older sensor-set names are mapped through SENSOR_SET_ALIASES; unknown sets (AQUA) are skipped.
    """
    cov = pl.read_parquet(path).with_columns(pl.col("sensor_set").replace(C.SENSOR_SET_ALIASES))
    sp_end = last_sp_day(td) if ("product" not in cov.columns and td is not None) else {}
    suspect = cov["suspect_gap"].to_list() if ("suspect_gap" in cov.columns and C.SUSPECT_GAP_IS_GAP) else None
    product = cov["product"].to_list() if "product" in cov.columns else None
    rows = zip(cov["sensor_set"].to_list(), cov["date"].to_list(), cov["has_data"].to_list(), range(cov.height))
    state = {s: (np.zeros(n_days, bool), np.zeros(n_days, bool), np.zeros(n_days, int)) for s in C.SENSOR_SETS}
    for sset, d, ok, k in rows:
        i = day_index(d)
        if sset not in state or not 0 <= i < n_days:
            continue
        exists, has, prod = state[sset]
        exists[i] = True
        has[i] = bool(ok) and not (suspect is not None and suspect[k])
        if product is not None:
            prod[i] = C.PRODUCTS.index(product[k])
        else:
            prod[i] = C.PRODUCTS.index("SP" if i <= sp_end.get(sset, -1) else "NRT")
    runs = []
    for sset in C.SENSOR_SETS:
        exists, has, prod = state[sset]
        if exists.any():
            runs += _runs(sset, has, prod, exists)
    return runs


def coverage_from_tile_day(td: pl.DataFrame, n_days: int) -> list[tuple]:
    """STAND-IN coverage when coverage.parquet is absent: inferred from the fire rows.

    Each sensor set is taken to have data on every day from its first to its last row, SP up to
    its last SP row and NRT after. Real gaps cannot be seen this way, so a gap shows as zero
    activity. Replace with M1's coverage.parquet as soon as it arrives.
    """
    g = td.group_by("sensor_set").agg(
        pl.col("date").min().alias("first"), pl.col("date").max().alias("last"),
        pl.col("date").filter(pl.col("product") == "SP").max().alias("last_sp"))
    runs = []
    for sset, first, last, last_sp in g.iter_rows():
        a, b = day_index(first), min(day_index(last), n_days - 1)
        exists = np.zeros(n_days, bool)
        exists[a:b + 1] = True
        prod = np.ones(n_days, int) * C.PRODUCTS.index("NRT")
        if last_sp is not None:
            prod[:day_index(last_sp) + 1] = C.PRODUCTS.index("SP")
        runs += _runs(sset, np.ones(n_days, bool), prod, exists)
    return sorted(runs, key=lambda r: (C.SENSOR_SETS.index(r[0]), r[2]))


def last_covered_day(runs: list[tuple]) -> str:
    """Last date on which MODIS or the VIIRS source of truth has data: the 'as of' date of the build."""
    from .timeutil import index_day
    snpp_end = day_index(C.SNPP_END)
    last = -1
    for sset, _, a, b, ok in runs:
        if not ok:
            continue
        if sset == C.MODIS_SET or sset == C.RELAY_SET:
            last = max(last, b)
        elif sset == C.SNPP_SET:
            last = max(last, min(b, snpp_end))
    return index_day(last).isoformat()


def coverage_json(runs: list[tuple]) -> dict:
    """coverage.json body from runs."""
    return {"epoch": C.EPOCH, "sensor_sets": C.SENSOR_SETS, "products": C.PRODUCTS,
            "columns": {"sensor_set": [C.SENSOR_SETS.index(r[0]) for r in runs],
                        "product": [C.PRODUCTS.index(r[1]) for r in runs],
                        "start": [int(r[2]) for r in runs], "end": [int(r[3]) for r in runs],
                        "has_data": [r[4] for r in runs]}}

# ---------------------------------------------------------------- validation

def pending(name: str, result) -> dict:
    """A check block that has not been run yet."""
    return {"owner": C.OWNERS[name], "reviewer": C.REVIEWERS[name], "status": "pending",
            "label": "Measured", "result": result}


def validation_skeleton(hide_cols: dict | None) -> dict:
    """validation.json body: every key present; hide-a-year filled when the fallback fit ran."""
    lo, hi = C.NEG_CONTROL_YEARS
    v = {"hide_a_year": pending("hide_a_year", {"columns": hide_cols or
                                                {k: [] for k in ("region", "year", "predicted", "actual", "in_range")}})}
    if hide_cols:
        v["hide_a_year"].update(status="done", owner="M3", reviewer="M2")     # fallback: M3 wrote it, M2 reviews
    v["error_by_level"] = pending("error_by_level", None)
    v["baselines"] = pending("baselines", {"metric": "mean absolute percent error", "n": 0, "per_zone_month": None,
                                           "global_ratio": None, "no_conversion": None, "beats_both": None,
                                           "zone_month_level": None})
    v["rank_test"] = pending("rank_test", {"method": "not run", "rho": None, "threshold": C.RANK_PASS,
                                           "passed": None, "n": 0, "other_method": None})
    for name in ("seam_step", "era_b_test", "ratio_trend", "res_sensitivity", "nrt_seam"):
        v[name] = pending(name, None)
    v["external_check"] = pending("external_check", {"source": C.EXTERNAL_SOURCE, "source_limits": C.EXTERNAL_LIMITS,
                                                     "rho": None, "n": 0, "years": []})
    v["negative_control"] = pending("negative_control", {"region": C.CONTROL_REGION["id"], "years": [lo, hi],
                                                         "days_tested": 0, "false_anomalies": None, "rate": None})
    return v

# -------------------------------------------------------------------- driver

def is_real(processed_dir: Path) -> bool:
    """True when the folder holds M1's hand-off (her regions.json sits next to the Parquet files)."""
    return (processed_dir / "regions.json").exists() and (processed_dir / "tile_day.parquet").exists()


def refresh_placeholders(data_dir: Path) -> list[str]:
    """Mock files still waiting for a real hand-off keep "mock": true; align their schema_version."""
    kept = []
    for name in ("hourly.json", "drift.json", "relay_sim.json", "conversion.json", "validation.json"):
        p = data_dir / name
        if p.exists():
            d = read_json(p)
            if d.get("mock"):
                d["schema_version"] = C.SCHEMA_VERSION
                write_json(p, d)
                kept.append(name)
    return kept


def prepare(data_dir: Path, processed_dir: Path) -> dict:
    """Write the upstream JSON files from M1's hand-off. Returns notes for the build summary."""
    env = envelope(mock=False)
    td = pl.read_parquet(processed_dir / "tile_day.parquet")
    tiles = pl.read_parquet(processed_dir / "tiles.parquet")
    n_days = day_index(td["date"].max()) + 1
    notes = {"model_version": None}

    m1 = json.loads((processed_dir / "regions.json").read_text(encoding="utf-8"))
    write_json(data_dir / "regions.json", {**env, **regions_from_m1(m1, tiles)})

    cov_path = processed_dir / "coverage.parquet"
    if cov_path.exists():
        runs, notes["coverage"] = coverage_from_parquet(cov_path, n_days, td), "coverage.parquet"
    else:
        runs, notes["coverage"] = coverage_from_tile_day(td, n_days), "STAND-IN inferred from tile_day"
    write_json(data_dir / "coverage.json", {**env, **coverage_json(runs)})
    as_of = last_covered_day(runs)
    notes["as_of"] = as_of
    td = td.filter(pl.col("date") <= parse(as_of))

    if C.USE_FALLBACK_CONVERSION:
        zones = sorted(tiles.filter(pl.col("region").is_in(C.BASE_REGIONS))["zone_r3"].unique().to_list())
        cube = CV.monthly_cube(td, zones, parse(as_of).year)
        body, widen = CV.build_conversion(cube, zones)
        write_json(data_dir / "conversion.json", {**env, **body})
        write_json(data_dir / "validation.json", {**env, **validation_skeleton(CV.hide_a_year(cube, widen["B"]))})
        relay = CV.relay_simulation(td)
        if relay:
            write_json(data_dir / "relay_sim.json", {**env, **relay})
        notes.update(model_version=FALLBACK_MODEL, widen=widen)

    (data_dir / "hotspots").mkdir(parents=True, exist_ok=True)
    for old in (data_dir / "hotspots").glob("*.csv"):
        if old.stat().st_size < 200:                         # header-only placeholders from the mocks
            old.unlink()
    for pid in C.PRESET_IDS:
        f = data_dir / "hotspots" / f"hotspots_{pid}_{as_of[:4]}.csv"
        if not f.exists():
            f.write_text(",".join(C.HOTSPOT_COLUMNS) + "\n", encoding="utf-8", newline="\n")
    notes["placeholders"] = refresh_placeholders(data_dir)
    return notes
