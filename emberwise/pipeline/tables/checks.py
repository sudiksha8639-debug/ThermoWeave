"""M3's validation checks (plan s7): rank test, baselines, external check, negative control.

Every function returns the `result` object for its key in validation.json and reports
the value as found. Nothing here decides to hide a weak result.
"""
from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
import polars as pl
from scipy.stats import spearmanr

from . import analytics as A
from . import config as C
from .timeutil import day_index, parse

# ------------------------------------------------------------------ rank test

def spearman(x, y) -> tuple[float, int]:
    """Spearman rho over pairs where both values exist. NaN if under 3 pairs or a side is constant."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    ok = ~np.isnan(x) & ~np.isnan(y)
    x, y = x[ok], y[ok]
    if len(x) < 3 or np.ptp(x) == 0 or np.ptp(y) == 0:
        return float("nan"), int(len(x))
    return float(spearmanr(x, y).statistic), int(len(x))


def deseasonalize(values, groups) -> np.ndarray:
    """Remove each group's mean (group = calendar month), so the season cannot fake agreement."""
    values, groups = np.asarray(values, float), np.asarray(groups)
    out = values.copy()
    for g in np.unique(groups):
        sel = groups == g
        out[sel] -= np.nanmean(values[sel])
    return out


def rank_test(x, y, groups=None, method: str = C.RANK_METHOD, threshold: float = C.RANK_PASS) -> dict:
    """Reusable rank test. Do two series order the same periods the same way?

    method "deseasonalized": Spearman after removing each calendar month's mean from both series.
    method "within_month":   Spearman across years inside each calendar month; the median is reported.
    method "plain":          Spearman on the values as given (used for yearly series).
    Pass is rho >= threshold; the actual rho is returned either way.
    """
    if method == "plain" or groups is None:
        rho, n = spearman(x, y)
        label = "Spearman on yearly values"
    elif method == "deseasonalized":
        rho, n = spearman(deseasonalize(x, groups), deseasonalize(y, groups))
        label = "Spearman on values with each calendar month's mean removed"
    elif method == "within_month":
        x, y, groups = np.asarray(x, float), np.asarray(y, float), np.asarray(groups)
        per = [spearman(x[groups == g], y[groups == g]) for g in np.unique(groups)]
        rhos = [r for r, _ in per if not np.isnan(r)]
        rho, n = (float(np.median(rhos)) if rhos else float("nan")), int(sum(k for r, k in per if not np.isnan(r)))
        label = "Median of Spearman across years within each calendar month"
    else:
        raise ValueError(f"unknown rank-test method: {method}")
    found = not np.isnan(rho)
    return {"method": label, "rho": round(rho, 3) if found else None, "threshold": threshold,
            "passed": bool(rho >= threshold) if found else None, "n": n}


def monthly_pairs(agg: dict, inp: dict, flags: dict, tab: dict, months: list[str], preset: str):
    """(MODIS-converted monthly value, VIIRS monthly value, calendar month) for full Suomi NPP months.

    The converted value uses MODIS alone, so the pair tests the harmonization against what VIIRS saw.
    """
    from .harmonize import convert_modis
    from .timeutil import days_in_month
    parts = [C.BASE_REGIONS.index(r) for r in next(p for p in C.PRESETS if p["id"] == preset)["parts"]]
    in_preset = np.isin(inp["region_of_tile"], parts)
    z = inp["zone_of_tile"]
    x, y, g = [], [], []
    for j, ym in enumerate(months):
        a, dim = day_index(ym + "-01"), days_in_month(ym)
        full = a + dim <= len(flags["vday"]) and flags["vday"][a:a + dim].all() and not flags["relay"][a:a + dim].any()
        if not full:
            continue
        cm = int(ym[5:7]) - 1
        conv = np.minimum(convert_modis(agg["m_all_td_month"][:, j], tab["B"]["ratio"][z, cm]), dim)
        x.append(float(np.nansum(conv[in_preset])))
        y.append(float(agg["v_td_month"][in_preset, j].sum()))
        g.append(cm + 1)
    return np.array(x), np.array(y), np.array(g)

# ------------------------------------------------------------------ baselines

def baselines(hide: dict, modis_by_region_year: dict) -> dict:
    """Per zone-month conversion (M2's hide-a-year predictions) against two simpler baselines.

    no conversion: raw MODIS tile-days used as the prediction.
    one global ratio: sum(actual) / sum(MODIS) over the OTHER years of the same region, times MODIS.
    Error = mean absolute percent error against the VIIRS actual.
    """
    rows = [(r, y, p, a) for r, y, p, a in zip(hide["region"], hide["year"], hide["predicted"], hide["actual"])
            if p is not None and a and (r, y) in modis_by_region_year]
    errs = {"per_zone_month": [], "global_ratio": [], "no_conversion": []}
    for r, y, pred, actual in rows:
        m = modis_by_region_year[r, y]
        others = [(modis_by_region_year[r2, y2], a2) for r2, y2, _, a2 in rows if r2 == r and y2 != y]
        den = sum(mo for mo, _ in others)
        if den <= 0:
            continue
        g = sum(a2 for _, a2 in others) / den
        for key, guess in (("per_zone_month", pred), ("global_ratio", g * m), ("no_conversion", m)):
            errs[key].append(abs(guess - actual) / actual)
    n = len(errs["per_zone_month"])
    out = {k: round(100 * float(np.mean(v)), 1) if n else None for k, v in errs.items()}
    beats = bool(out["per_zone_month"] < min(out["global_ratio"], out["no_conversion"])) if n else None
    return {"metric": "mean absolute percent error", "n": n, **out, "beats_both": beats}


def zone_month_baselines(agg: dict, inp: dict, months: list[str]) -> dict:
    """The same three-way comparison one level down: each zone, month and hidden year.

    Uses the plan's fit (refitted here without the hidden year), one global ratio from the other
    years, and no conversion. Zone-months with under CONVERSION_MIN_ACTUAL VIIRS tile-days are skipped.
    """
    from . import conversion as CV
    y0, y1 = C.LEARNING_WINDOW
    nz = len(inp["zones"])
    V, M = np.zeros((nz, y1 - y0 + 1, 12)), np.zeros((nz, y1 - y0 + 1, 12))
    for j, ym in enumerate(months):
        y, m = int(ym[:4]), int(ym[5:7])
        if y0 <= y <= y1 and (y, m) != (y0, 1):
            np.add.at(V[:, y - y0, m - 1], inp["zone_of_tile"], agg["v_td_month"][:, j])
            np.add.at(M[:, y - y0, m - 1], inp["zone_of_tile"], agg["m_all_td_month"][:, j])
    errs = {"per_zone_month": [], "global_ratio": [], "no_conversion": []}
    for yi in range(V.shape[1]):
        keep = np.arange(V.shape[1]) != yi
        fit = CV.fit_ratio(V[:, keep], M[:, keep])
        g = V[:, keep].sum() / M[:, keep].sum()
        actual, m = V[:, yi], M[:, yi]
        ok = actual >= C.CONVERSION_MIN_ACTUAL
        for key, guess in (("per_zone_month", m * fit["ratio"]), ("global_ratio", m * g), ("no_conversion", m)):
            errs[key] += (np.abs(guess[ok] - actual[ok]) / actual[ok]).tolist()
    n = len(errs["per_zone_month"])
    out = {k: round(100 * float(np.mean(v)), 1) if n else None for k, v in errs.items()}
    return {"n": n, **out,
            "beats_both": bool(out["per_zone_month"] < min(out["global_ratio"], out["no_conversion"])) if n else None}


def modis_region_year(agg: dict, inp: dict, months: list[str]) -> dict:
    """{(preset index, year): MODIS tile-days} over the months M2's hide-a-year covers."""
    out = {}
    use = C.HIDE_A_YEAR_MONTHS
    for ri, p in enumerate(C.PRESETS):
        sel = np.isin(inp["region_of_tile"], [C.BASE_REGIONS.index(r) for r in p["parts"]])
        col = agg["m_all_td_month"][sel].sum(axis=0)
        for j, ym in enumerate(months):
            if ym == f"{C.LEARNING_WINDOW[0]}-01":
                continue                                    # partial VIIRS month, left out of the fit too
            if use is None or int(ym[5:7]) in use:
                out[ri, int(ym[:4])] = out.get((ri, int(ym[:4])), 0.0) + float(col[j])
    return out

# ------------------------------------------------------------- external check

def yearly_season_total(harm, cal: dict, months=C.PILOT_MONTHS) -> dict:
    """{year: Oct-Nov harmonized total}; a year with any missing day in the season is left out."""
    harm = np.asarray(harm, float)
    out = {}
    for y in np.unique(cal["year"]):
        sel = (cal["year"] == y) & np.isin(cal["month"], months)
        full = sel.sum() == sum(30 if m in (4, 6, 9, 11) else 31 for m in months)
        if full and not np.isnan(harm[sel]).any():
            out[int(y)] = float(harm[sel].sum())
    return out


def read_external(path: Path | None = None) -> dict | None:
    """{year: value} from the outside series CSV (columns year,value); None if the file is absent."""
    path = Path(path or C.EXTERNAL_FILE)
    if not path.exists():
        return None
    with open(path, newline="", encoding="utf-8") as f:
        return {int(r["year"]): float(r["value"]) for r in csv.DictReader(f) if r["value"] not in ("", None)}


def external_check(yearly_harm: dict, external: dict, source: str = C.EXTERNAL_SOURCE,
                   limits: str = C.EXTERNAL_LIMITS) -> dict:
    """Spearman between yearly Oct-Nov harmonized activity and one outside series (reuses rank_test)."""
    years = sorted(set(yearly_harm) & set(external))
    res = rank_test([yearly_harm[y] for y in years], [external[y] for y in years], method="plain")
    return {"source": source, "source_limits": limits, "rho": res["rho"], "n": res["n"], "years": years}

# ----------------------------------------------------------- negative control

def control_daily(td: pl.DataFrame, n_days: int) -> np.ndarray:
    """Control district: Suomi NPP tile-days per day (tile-days only); NaN outside the Suomi NPP record."""
    g = (td.filter((pl.col("region") == C.CONTROL_REGION["id"]) & (pl.col("sensor_set") == C.SNPP_SET))
         .group_by("date").agg(pl.col("n_tile_day").sum().alias("n")))
    out = np.zeros(n_days)
    for d, n in g.iter_rows():
        out[day_index(d)] = n
    out[:day_index(C.VIIRS_START)] = np.nan
    out[day_index(C.SNPP_END) + 1:] = np.nan
    return out


def negative_control(series, tile_count: int, cal: dict) -> dict:
    """Count Oct-Nov days in the control district that the critical-period rule would flag.

    In a low-fire district these are false anomalies; the count is reported as found.
    """
    y0, y1 = C.NEG_CONTROL_YEARS
    window = (cal["year"] >= y0) & (cal["year"] <= y1) & np.isin(cal["month"], C.NEG_CONTROL_MONTHS)
    runs, _, _, _ = A.anomaly_runs(series, tile_count, cal)
    flagged = np.zeros(len(window), bool)
    for a, b in runs:
        flagged[a:b + 1] = True
    tested = int((window & ~np.isnan(np.asarray(series, float))).sum())
    false = int((flagged & window).sum())
    return {"region": C.CONTROL_REGION["id"], "years": [y0, y1], "days_tested": tested,
            "false_anomalies": false, "rate": round(false / tested, 4) if tested else None}

# -------------------------------------------------------------------- driver

def run_all(agg: dict, inp: dict, flags: dict, tab: dict, months: list[str], cal: dict, rd: dict,
            validation: dict) -> dict:
    """Run every M3 check and return {key: result}. A check whose input is absent is left out (stays pending)."""
    from .jsonio import nan_array
    out = {}
    x, y, g = monthly_pairs(agg, inp, flags, tab, months, C.DEFAULT_PRESET)
    other = "within_month" if C.RANK_METHOD == "deseasonalized" else "deseasonalized"
    out["rank_test"] = {**rank_test(x, y, g), "other_method": rank_test(x, y, g, method=other)}
    hide = (validation.get("hide_a_year") or {}).get("result")
    if hide:
        out["baselines"] = {**baselines(hide["columns"], modis_region_year(agg, inp, months)),
                            "zone_month_level": zone_month_baselines(agg, inp, months)}
    external = read_external()
    if external:
        harm = nan_array(rd["presets"][C.EXTERNAL_PRESET]["harm"])
        out["external_check"] = external_check(yearly_season_total(harm, cal), external)
    if inp["control_tiles"]:
        out["negative_control"] = negative_control(control_daily(inp["td"], len(cal["date"])),
                                                   inp["control_tiles"], cal)
    return out
