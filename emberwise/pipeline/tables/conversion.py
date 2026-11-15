"""MODIS -> VIIRS-scale conversion and its tests, fitted from tile_day (plan s6, s7).

M3's fallback for M2's deliverables. Method, exactly as the plan states it:
  * zones are H3 res-3 cells; one ratio per zone and calendar month;
  * learned on 2012-2019 only, twice: Terra-only -> VIIRS (era A) and Terra U Aqua -> VIIRS (era B);
  * small-sample shrinkage: r = (sum V + k * r_region,m) / (sum M + k), k about 20 tile-days;
  * base range = 10th to 90th percentile of the yearly ratios;
  * widened range = base range widened by the 80th percentile of the absolute relative error
    found when each year is hidden and predicted from the others (hide-a-year).

Used only while config.USE_FALLBACK_CONVERSION is True. M2's conversion.json and validation
blocks replace the output of this module when they arrive.
Not built here: the fraction-burning alternative fit and the NRT factor (needs M1's NRT/SP pairs).
"""
from __future__ import annotations

from datetime import date

import numpy as np
import polars as pl
from scipy.stats import spearmanr

from . import config as C
from .timeutil import day_index, index_day, parse

ERA_SOURCE = {"A": "TERRA", "B": C.MODIS_SET}


def _div(a, b):
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(b > 0, a / b, np.nan)


def monthly_cube(td: pl.DataFrame, zones: list[str], first_year: int, last_year: int) -> dict:
    """{sensor_set: array[base region, zone, year, month]} of day-pass tile-days.

    Only days up to the end of the Suomi NPP record are used, and January 2012 is left out
    because VIIRS starts on the 20th.
    """
    g = (td.filter(pl.col("region").is_in(C.BASE_REGIONS) & (pl.col("date") <= parse(C.SNPP_END))
                   & pl.col("date").dt.year().is_between(first_year, last_year))
         .group_by("region", "zone_r3", pl.col("date").dt.year().alias("y"),
                   pl.col("date").dt.month().alias("m"), "sensor_set").agg(pl.col("n_tile_day").sum().alias("n")))
    zi = {z: i for i, z in enumerate(zones)}
    cube = {s: np.zeros((len(C.BASE_REGIONS), len(zones), last_year - first_year + 1, 12)) for s in C.SENSOR_SETS}
    for r, z, y, m, s, n in g.iter_rows():
        if (y, m) != (C.LEARNING_WINDOW[0], 1) and s in cube and z in zi:
            cube[s][C.BASE_REGIONS.index(r), zi[z], y - first_year, m - 1] = n
    return cube


def fit_ratio(V: np.ndarray, M: np.ndarray, k: float = C.K_SUPPORT) -> dict:
    """Fit zone-month ratios from V and M of shape [zone, year, month].

    Returns ratio, lo, hi (each [zone, 12]) and n_support. If a calendar month has no MODIS
    tile-days anywhere in the region, the all-month regional ratio is the shrinkage target.
    """
    r_month = _div(V.sum(axis=(0, 1)), M.sum(axis=(0, 1)))
    r_all = _div(V.sum(), M.sum())
    target = np.where(np.isnan(r_month), r_all, r_month)
    ratio = (V.sum(axis=1) + k * target) / (M.sum(axis=1) + k)
    yearly = (V + k * target) / (M + k)
    lo = np.minimum(np.nanpercentile(yearly, 10, axis=1), ratio)
    hi = np.maximum(np.nanpercentile(yearly, 90, axis=1), ratio)
    return {"ratio": ratio, "lo": lo, "hi": hi, "n_support": M.sum(axis=1)}


def preset_parts(pid: str) -> list[int]:
    """Indexes of the base regions that make up a preset."""
    return [C.BASE_REGIONS.index(r) for r in next(p for p in C.PRESETS if p["id"] == pid)["parts"]]


def learning_slice() -> slice:
    """Index range of the learning window inside a cube that starts in its first year."""
    y0, y1 = C.LEARNING_WINDOW
    return slice(0, y1 - y0 + 1)

# --------------------------------------------------------------- hide-a-year

def hide_a_year_rows(V: np.ndarray, M: np.ndarray) -> list[dict]:
    """Hide each year, predict it per preset from MODIS alone. V, M: [region, zone, year, month]."""
    rows, n_years = [], V.shape[2]
    for yi in range(n_years):
        keep = np.arange(n_years) != yi
        fit = fit_ratio(V.sum(axis=0)[:, keep], M.sum(axis=0)[:, keep])
        for ri, pid in enumerate(C.PRESET_IDS):
            parts = preset_parts(pid)
            m_y = M[parts].sum(axis=0)[:, yi]
            rows.append({"region": ri, "year_index": yi, "actual": float(V[parts].sum(axis=0)[:, yi].sum()),
                         **{k: float(np.nansum(m_y * fit[k])) for k in ("ratio", "lo", "hi")}})
    return rows


def widening(rows: list[dict]) -> float:
    """80th percentile of the hide-a-year absolute relative error (preset-years), plan s6.

    This is the error of a whole preset over a whole year. A single tile or a single week is
    less certain than this; the trust score's support factor is what reflects that.
    """
    e = [abs(r["ratio"] - r["actual"]) / r["actual"] for r in rows if r["actual"] > 0]
    return float(np.percentile(e, 80)) if e else 0.0


def hide_a_year(cube: dict, widen_b: float) -> dict:
    """The `columns` object of validation.hide_a_year.result (era B source: Terra U Aqua)."""
    L = learning_slice()
    cols = {k: [] for k in ("region", "year", "predicted", "actual", "in_range")}
    for r in hide_a_year_rows(cube[C.SNPP_SET][:, :, L], cube[C.MODIS_SET][:, :, L]):
        cols["region"].append(r["region"]); cols["year"].append(C.LEARNING_WINDOW[0] + r["year_index"])
        cols["predicted"].append(round(r["ratio"], C.Q_VALUE)); cols["actual"].append(r["actual"])
        cols["in_range"].append(bool(r["lo"] * (1 - widen_b) <= r["actual"] <= r["hi"] * (1 + widen_b)))
    return cols

# ---------------------------------------------------------------- conversion

def build_conversion(cube: dict, zones: list[str]) -> tuple[dict, dict]:
    """conversion.json body (no envelope) and the widening used per era."""
    y0, y1 = C.LEARNING_WINDOW
    L = learning_slice()
    V = cube[C.SNPP_SET].sum(axis=0)
    cols = {k: [] for k in ("zone", "month", "era", "ratio", "lo", "hi", "widened_lo", "widened_hi", "n_support")}
    widen = {}
    for era, source in ERA_SOURCE.items():
        M = cube[source].sum(axis=0)
        fit = fit_ratio(V[:, L], M[:, L])
        w = widen[era] = widening(hide_a_year_rows(cube[C.SNPP_SET][:, :, L], cube[source][:, :, L]))
        for z in range(len(zones)):
            for m in range(12):
                r, lo, hi = fit["ratio"][z, m], fit["lo"][z, m], fit["hi"][z, m]
                cols["zone"].append(z); cols["month"].append(m + 1); cols["era"].append(era)
                for key, v in (("ratio", r), ("lo", lo), ("hi", hi),
                               ("widened_lo", lo * (1 - w)), ("widened_hi", hi * (1 + w))):
                    cols[key].append(None if np.isnan(v) else round(float(max(v, 0.0)), C.Q_RATIO))
                cols["n_support"].append(int(fit["n_support"][z, m]))
    M = cube[C.MODIS_SET].sum(axis=0)
    rby = {k: [] for k in ("zone", "month", "year", "ratio", "in_learning_window")}
    for z in range(len(zones)):
        for m in C.PILOT_MONTHS:
            for yi in range(M.shape[1]):
                r = _div(V[z, yi, m - 1], M[z, yi, m - 1])
                rby["zone"].append(z); rby["month"].append(m); rby["year"].append(y0 + yi)
                rby["ratio"].append(None if np.isnan(r) else round(float(r), C.Q_RATIO))
                rby["in_learning_window"].append(bool(y0 + yi <= y1))
    body = {"unit": "VIIRS tile-days per MODIS tile-day (day passes)", "learning_window": [y0, y1],
            "k": C.K_SUPPORT, "zones": zones, "columns": cols, "ratio_by_year": {"columns": rby}}
    return body, widen

# ------------------------------------------------- M2's other checks (fallback)

def error_by_level(cube: dict) -> dict:
    """Hide-a-year error and bias for low, middle and high activity (plan s7).

    Each zone, month and hidden year is one case; cases are split into thirds by the VIIRS
    tile-days actually seen. bias > 0 means the conversion predicts too much.
    """
    L = learning_slice()
    V, M = cube[C.SNPP_SET].sum(axis=0)[:, L], cube[C.MODIS_SET].sum(axis=0)[:, L]
    actual, pred = [], []
    for yi in range(V.shape[1]):
        keep = np.arange(V.shape[1]) != yi
        fit = fit_ratio(V[:, keep], M[:, keep])
        ok = V[:, yi] >= C.CONVERSION_MIN_ACTUAL
        actual += V[:, yi][ok].tolist()
        pred += (M[:, yi] * fit["ratio"])[ok].tolist()
    actual, pred = np.array(actual), np.array(pred)
    if not len(actual):
        return {"levels": [], "note": "no zone-month reached the minimum activity"}
    cuts = np.percentile(actual, [100 / 3, 200 / 3])
    levels = []
    for name, sel in (("low", actual <= cuts[0]), ("middle", (actual > cuts[0]) & (actual <= cuts[1])),
                      ("high", actual > cuts[1])):
        if not sel.any():
            continue
        rel = (pred[sel] - actual[sel]) / actual[sel]
        levels.append({"level": name, "n": int(sel.sum()),
                       "tile_days_from": round(float(actual[sel].min()), 0), "tile_days_to": round(float(actual[sel].max()), 0),
                       "abs_error_pct": round(100 * float(np.mean(np.abs(rel))), 1),
                       "bias_pct": round(100 * float(np.mean(rel)), 1)})
    return {"unit": "one zone, month and hidden year", "levels": levels}


def era_b_test(td: pl.DataFrame, zones: list[str]) -> dict:
    """Terra -> Terra U Aqua, learned on 2012-2019 and tested on 2003-2011 (plan s2).

    Era A rests on Terra alone. This checks the Terra-to-both-MODIS step on years where both
    exist but which were not used for learning: predict Terra U Aqua tile-days from Terra.
    """
    y0, y1 = C.LEARNING_WINDOW
    t0, t1 = C.ERA_B_TEST_YEARS
    learn, test = monthly_cube(td, zones, y0, y1), monthly_cube(td, zones, t0, t1)
    fit = fit_ratio(learn[C.MODIS_SET].sum(axis=0), learn["TERRA"].sum(axis=0))
    rel, default = [], []
    for pid in C.PRESET_IDS:
        parts = preset_parts(pid)
        for yi in range(t1 - t0 + 1):
            pred = float(np.nansum(test["TERRA"][parts].sum(axis=0)[:, yi] * fit["ratio"]))
            actual = float(test[C.MODIS_SET][parts].sum(axis=0)[:, yi].sum())
            if actual > 0:
                rel.append((pred - actual) / actual)
                if pid == C.DEFAULT_PRESET:
                    default.append((pred - actual) / actual)
    if not rel:
        return {"learned_on": [y0, y1], "tested_on": [t0, t1], "n": 0, "abs_error_pct": None, "bias_pct": None}
    return {"learned_on": [y0, y1], "tested_on": [t0, t1], "n": len(rel),
            "abs_error_pct": round(100 * float(np.mean(np.abs(rel))), 1),
            "bias_pct": round(100 * float(np.mean(rel)), 1),
            "default_preset_abs_error_pct": round(100 * float(np.mean(np.abs(default))), 1) if default else None,
            "default_preset_bias_pct": round(100 * float(np.mean(default)), 1) if default else None}


def ratio_trend(cube: dict) -> dict:
    """Is the Oct-Nov VIIRS/MODIS ratio stable? (plan s3, s7.) Default preset, full seasons only."""
    y0, y1 = C.LEARNING_WINDOW
    pm = [m - 1 for m in C.PILOT_MONTHS]
    last_full = parse(C.SNPP_END).year - (0 if parse(C.SNPP_END) >= date(parse(C.SNPP_END).year, 11, 30) else 1)
    years, ratios = [], []
    for yi in range(cube[C.SNPP_SET].shape[2]):
        year = y0 + yi
        if year > last_full:
            break
        r = _div(cube[C.SNPP_SET][:, :, yi][:, :, pm].sum(), cube[C.MODIS_SET][:, :, yi][:, :, pm].sum())
        if not np.isnan(r):
            years.append(year); ratios.append(float(r))
    yrs, rat = np.array(years), np.array(ratios)
    inside, after = yrs <= y1, yrs > y1
    varies = inside.sum() >= 3 and np.ptp(rat[inside]) > 0
    rho = float(spearmanr(yrs[inside], rat[inside]).statistic) if varies else float("nan")
    m_in = float(rat[inside].mean()) if inside.any() else float("nan")
    m_after = float(rat[after].mean()) if after.any() else float("nan")
    num = lambda x, d=3: None if np.isnan(x) else round(x, d)   # noqa: E731
    return {"months": C.PILOT_MONTHS, "years": years, "ratio": [round(r, 3) for r in ratios],
            "rho_within_learning_window": num(rho), "mean_ratio_learning_window": num(m_in),
            "mean_ratio_after": num(m_after),
            "pct_change_after": num(100 * (m_after - m_in) / m_in, 1) if m_in == m_in and m_after == m_after else None}

# ------------------------------------------------------------- Sensor-Loss sim

def relay_simulation(td: pl.DataFrame) -> tuple[dict, float] | None:
    """Sensor-Loss simulation on the last full Oct-Nov season: (relay_sim.json body, alignment factor).

    The relay satellite is scaled to Suomi NPP using the other seasons they share, then the
    last full season is rebuilt from the relay alone and compared with what Suomi NPP saw.
    """
    d = (td.filter(pl.col("region").is_in(C.BASE_REGIONS) & pl.col("date").dt.month().is_in(C.PILOT_MONTHS)
                   & pl.col("sensor_set").is_in([C.SNPP_SET, C.RELAY_SET]) & (pl.col("date") <= parse(C.SNPP_END)))
         .group_by("date", "sensor_set").agg(pl.col("n_tile_day").sum().alias("n")))
    full = [y for y in range(C.LEARNING_WINDOW[0], parse(C.SNPP_END).year + 1)
            if date(y, 11, 30) <= parse(C.SNPP_END)]
    shared = [y for y in full if all(d.filter((pl.col("sensor_set") == s) & (pl.col("date").dt.year() == y)).height
                                     for s in (C.SNPP_SET, C.RELAY_SET))]
    if len(shared) < 2:
        return None
    season, overlap = shared[-1], shared[:-1]
    tot = {s: d.filter((pl.col("sensor_set") == s) & pl.col("date").dt.year().is_in(overlap))["n"].sum()
           for s in (C.SNPP_SET, C.RELAY_SET)}
    align = tot[C.SNPP_SET] / tot[C.RELAY_SET]
    by = {(dt, s): n for dt, s, n in d.filter(pl.col("date").dt.year() == season).iter_rows()}
    cols = {"date": [], "suomi_actual": [], "relay_built": [], "pct_diff": []}
    for i in range(day_index(date(season, 10, 1)), day_index(date(season, 11, 30)) + 1):
        actual, built = by.get((index_day(i), C.SNPP_SET), 0), by.get((index_day(i), C.RELAY_SET), 0) * align
        cols["date"].append(i); cols["suomi_actual"].append(actual)
        cols["relay_built"].append(round(built, C.Q_VALUE))
        cols["pct_diff"].append(round(100 * (built - actual) / actual, 1) if actual else None)
    body = {"region": C.DEFAULT_PRESET, "season": season, "relay_satellite": C.RELAY_SATELLITE_NAME,
            "overlap_years": overlap, "epoch": C.EPOCH, "columns": cols}
    return body, float(align)
