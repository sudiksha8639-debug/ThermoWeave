"""Peak-day diagnostic: does a proportional MODIS-to-VIIRS ratio overshoot when most tiles burn? (plan s6)

Two ways to predict the VIIRS share of tiles burning on a day from the MODIS share:
  proportional: f_V = r * f_M            (what the headline index uses; can exceed 1)
  saturating:   f_V = 1 - (1 - f_M)**a   (bounded at 1; one parameter)
Both are fitted with one year hidden and scored on that year, on all days and on high days only.
"""
from __future__ import annotations

import numpy as np
import polars as pl

from . import settings as S


def daily_fractions(td: pl.DataFrame, tiles: pl.DataFrame, regions: list[str]) -> pl.DataFrame:
    """One row per pilot-month day in the learning window: year, MODIS share and VIIRS share of tiles burning."""
    n = tiles.filter(pl.col("region").is_in(regions)).height
    y0, y1 = S.LEARNING_WINDOW
    d = (td.filter(pl.col("region").is_in(regions) & pl.col("sensor_set").is_in([S.MODIS, S.SNPP])
                   & pl.col("date").dt.month().is_in(S.PILOT_MONTHS) & pl.col("date").dt.year().is_between(y0, y1))
         .group_by("date", "sensor_set").agg(pl.col("n_tile_day").sum().alias("n"))
         .pivot(on="sensor_set", index="date", values="n").fill_null(0))
    for col in (S.MODIS, S.SNPP):
        if col not in d.columns:
            d = d.with_columns(pl.lit(0).alias(col))
    return d.select(pl.col("date").dt.year().alias("year"), (pl.col(S.MODIS) / n).alias("f_m"), (pl.col(S.SNPP) / n).alias("f_v"))


def fit_proportional(f_m: np.ndarray, f_v: np.ndarray) -> float:
    """Ratio of totals, as the headline conversion does."""
    return float(f_v.sum() / f_m.sum()) if f_m.sum() else float("nan")


def fit_saturating(f_m: np.ndarray, f_v: np.ndarray) -> float:
    """Exponent a (searched on a grid) that minimises squared error of 1 - (1 - f_M)**a."""
    grid = np.linspace(1.0, 12.0, 221)
    base = 1.0 - np.clip(f_m, 0, 0.999999)
    err = [float(np.sum((1.0 - base ** a - f_v) ** 2)) for a in grid]
    return float(grid[int(np.argmin(err))])


def _score(pred: np.ndarray, actual: np.ndarray) -> dict:
    if not len(actual):
        return {"n_days": 0, "abs_error_pct": None, "bias_pct": None}
    rel = (pred - actual) / actual
    return {"n_days": int(len(actual)), "abs_error_pct": round(100 * float(np.mean(np.abs(rel))), 1),
            "bias_pct": round(100 * float(np.mean(rel)), 1)}


def hide_a_year(frac: pl.DataFrame) -> dict:
    """Score both methods on each hidden year; report all active days and days above the saturation share."""
    year, f_m, f_v = (frac[c].to_numpy() for c in ("year", "f_m", "f_v"))
    p_prop, p_sat = np.full(len(year), np.nan), np.full(len(year), np.nan)
    for y in np.unique(year):
        keep, test = year != y, year == y
        p_prop[test] = fit_proportional(f_m[keep], f_v[keep]) * f_m[test]
        p_sat[test] = 1.0 - (1.0 - np.clip(f_m[test], 0, 0.999999)) ** fit_saturating(f_m[keep], f_v[keep])
    active = f_v > 0.02
    high = f_v > S.SATURATION_FRAC
    out = {"max_viirs_share": round(float(f_v.max()), 3) if len(f_v) else None,
           "max_proportional_prediction": round(float(np.nanmax(p_prop)), 3) if len(f_v) else None}
    for name, sel in (("active_days", active), ("high_days", high)):
        out[name] = {"proportional": _score(p_prop[sel], f_v[sel]), "saturating": _score(p_sat[sel], f_v[sel])}
    hd = out["high_days"]
    if hd["proportional"]["n_days"] >= 5:
        out["better_on_high_days"] = "saturating" if hd["saturating"]["abs_error_pct"] < hd["proportional"]["abs_error_pct"] else "proportional"
    else:
        out["better_on_high_days"] = None
    out["used_in_headline"] = "proportional"
    return out


def run(td: pl.DataFrame, tiles: pl.DataFrame) -> dict:
    """The diagnostic for every preset."""
    return {"saturation_share": S.SATURATION_FRAC, "learning_window": list(S.LEARNING_WINDOW),
            "presets": {pid: hide_a_year(daily_fractions(td, tiles, regs)) for pid, regs in S.PRESETS.items()}}
