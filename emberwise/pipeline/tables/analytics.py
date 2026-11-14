"""Climatology, critical periods, this-month logic, Local Normal and sentences (plan s6).

Stage A versions used to fill the tables; Stage B hardens them and adds unit tests.
All inputs are 1-D daily arrays indexed by days since config.EPOCH; NaN = missing.
Sentences are template-written; every number comes from code.
"""
from __future__ import annotations

import calendar
from datetime import date

import numpy as np

from . import config as C
from .timeutil import index_day, week_of_year

# ------------------------------------------------------------------ calendar

def day_calendar(n_days: int) -> dict:
    """Per-day date, year, month, day-of-month, day-of-year and week-of-year arrays."""
    ds = [index_day(i) for i in range(n_days)]
    return {"date": ds,
            "year": np.array([d.year for d in ds]), "month": np.array([d.month for d in ds]),
            "dom": np.array([d.day for d in ds]),
            "doy": np.array([d.timetuple().tm_yday for d in ds]),
            "week": np.array([week_of_year(d) for d in ds])}

# --------------------------------------------------------------- climatology

def weekly_matrix(daily: np.ndarray, cal: dict) -> tuple[np.ndarray, np.ndarray]:
    """Sum a daily series into (year x week). A week with any missing day is NaN."""
    years = np.unique(cal["year"])
    mat = np.full((len(years), C.CLIM_WEEKS), np.nan)
    for yi, y in enumerate(years):
        tail = (366 if calendar.isleap(int(y)) else 365) - 7 * (C.CLIM_WEEKS - 1)
        for w in range(C.CLIM_WEEKS):
            vals = daily[(cal["year"] == y) & (cal["week"] == w)]
            if len(vals) == (7 if w < C.CLIM_WEEKS - 1 else tail) and not np.isnan(vals).any():
                mat[yi, w] = vals.sum()
    return mat, years


def weekly_percentiles(mat: np.ndarray) -> dict:
    """P10..P90 per week, pooling +/- CLIM_WINDOW_WEEKS weeks circularly.

    Circular: week 51 (late December) pools with week 0 (early January).
    """
    out = {f"p{p}": np.full(C.CLIM_WEEKS, np.nan) for p in C.CLIM_PERCENTILES}
    for w in range(C.CLIM_WEEKS):
        cols = [(w + k) % C.CLIM_WEEKS for k in range(-C.CLIM_WINDOW_WEEKS, C.CLIM_WINDOW_WEEKS + 1)]
        vals = mat[:, cols].ravel()
        vals = vals[~np.isnan(vals)]
        if len(vals):
            for p in C.CLIM_PERCENTILES:
                out[f"p{p}"][w] = np.percentile(vals, p)
    out["n_years"] = int((~np.isnan(mat)).all(axis=1).sum())
    return out

# ------------------------------------------------- day-of-year window helpers

def _doy_pools(x: np.ndarray, doy: np.ndarray, window: int):
    """Yield (day_of_year, sorted valid values within +/- window days, circular)."""
    for d in range(1, 367):
        dist = np.abs(doy - d)
        vals = x[(np.minimum(dist, 366 - dist) <= window) & ~np.isnan(x)]
        yield d, np.sort(vals)


def doy_percentile(x: np.ndarray, doy: np.ndarray, pct: float, window: int) -> np.ndarray:
    """Percentile of x across years within +/- window days of each day of year."""
    table = np.full(367, np.nan)
    for d, vals in _doy_pools(x, doy, window):
        if len(vals):
            table[d] = np.percentile(vals, pct)
    return table[doy]


def pct_rank(x: np.ndarray, doy: np.ndarray, window: int = C.PERIOD_DOY_WINDOW) -> np.ndarray:
    """Position 0-100 of each day among all years within +/- window days of its day of year."""
    out = np.full(len(x), np.nan)
    for d, vals in _doy_pools(x, doy, window):
        sel = (doy == d) & ~np.isnan(x)
        if len(vals) and sel.any():
            out[sel] = 100.0 * np.searchsorted(vals, x[sel], side="left") / len(vals)
    return out

# ----------------------------------------------------------- critical periods

def rolling_mean(x: np.ndarray, n: int) -> np.ndarray:
    """Trailing n-day mean; NaN unless all n days are present."""
    x = np.asarray(x, float)
    c = np.concatenate([[0.0], np.cumsum(np.nan_to_num(x))])
    bad = np.concatenate([[0], np.cumsum(np.isnan(x))])
    out = np.full(len(x), np.nan)
    i = np.arange(n, len(x) + 1)
    ok = (bad[i] - bad[i - n]) == 0
    out[n - 1:][ok] = (c[i] - c[i - n])[ok] / n
    return out


def _runs(flag: np.ndarray, max_gap: int, min_days: int) -> list[tuple[int, int]]:
    """Runs of True as (start, end) inclusive, after merging gaps of max_gap days or fewer."""
    idx = np.flatnonzero(flag)
    if not len(idx):
        return []
    runs, start, prev = [], idx[0], idx[0]
    for i in idx[1:]:
        if i - prev - 1 > max_gap:
            runs.append((start, prev))
            start = i
        prev = i
    runs.append((start, prev))
    return [(int(a), int(b)) for a, b in runs if b - a + 1 >= min_days]


def critical_periods(harm, lo, tile_count: int, cal: dict, labels: list[str], region: str) -> list[dict]:
    """Periods where the 7-day harmonized value exceeds its day-of-year P90 (plan s6)."""
    roll = rolling_mean(harm, C.PERIOD_ROLL_DAYS)
    roll_lo = rolling_mean(lo, C.PERIOD_ROLL_DAYS)
    p90 = doy_percentile(roll, cal["doy"], C.PERIOD_PERCENTILE, C.PERIOD_DOY_WINDOW)
    p50 = doy_percentile(roll, cal["doy"], 50, C.PERIOD_DOY_WINDOW)
    flag = (roll > p90) & (roll >= C.PERIOD_MIN_FRAC * tile_count)
    out = []
    for a, b in _runs(flag, C.PERIOD_MAX_GAP, C.PERIOD_MIN_DAYS):
        s = slice(a, b + 1)
        med = float(np.nanmean(p50[s]))
        peak = a + int(np.nanargmax(roll[s]))
        status = "firm" if bool(np.all(roll_lo[s] > p90[s])) else "tentative"
        label = "Provisional" if "Provisional" in labels[a:b + 1] else labels[a]
        p = {"start": cal["date"][a].isoformat(), "end": cal["date"][b].isoformat(), "days": b - a + 1,
             "status": status, "severity": round(float(np.nanmean(roll[s])) / med - 1, 2) if med > 0 else None,
             "peak_date": cal["date"][peak].isoformat(), "peak_value": round(float(roll[peak]), C.Q_VALUE),
             "label": label}
        p["sentence"] = period_sentence(p, region)
        out.append(p)
    return out

# ---------------------------------------------------------------- this month

def band_for(percentile: float) -> str:
    """Band by position among past years: under 10, 10-30, 30-70, 70-90, over 90."""
    lo1, lo2, hi1, hi2 = C.BAND_CUTS
    if percentile < lo1:
        return C.BAND_NAMES[0]
    if percentile < lo2:
        return C.BAND_NAMES[1]
    if percentile <= hi1:
        return C.BAND_NAMES[2]
    if percentile <= hi2:
        return C.BAND_NAMES[3]
    return C.BAND_NAMES[4]


def this_month(harm, frac, cal: dict, as_of: date) -> dict:
    """Compare the month containing as_of with the SAME DAYS of that month in other years."""
    harm = np.asarray(harm, float)
    in_month = (cal["month"] == as_of.month) & (cal["dom"] <= as_of.day)

    def total(year):
        sel = in_month & (cal["year"] == year)
        ok = sel.sum() == as_of.day and not np.isnan(harm[sel]).any()
        return harm[sel].sum() if ok else np.nan

    cur = total(as_of.year)
    past = np.array([t for y in np.unique(cal["year"]) if y != as_of.year and not np.isnan(t := total(y))])
    cur_frac = np.asarray(frac, float)[in_month & (cal["year"] == as_of.year)]
    res = {"month": f"{as_of.year:04d}-{as_of.month:02d}",
           "in_progress": as_of.day < calendar.monthrange(as_of.year, as_of.month)[1],
           "days_compared": as_of.day, "value": None, "typical_median": None, "pct_diff": None,
           "rank_higher_than": None, "rank_of": int(len(past)), "middle_half": [None, None],
           "percentile": None, "band": None,
           "near_saturation": bool(np.nanmax(cur_frac, initial=0) > C.SATURATION_FRAC)}
    if np.isnan(cur) or not len(past):
        return res
    med = float(np.median(past))
    higher = int((past < cur).sum())
    pctile = 100.0 * higher / len(past)
    res.update({"value": round(float(cur), C.Q_VALUE), "typical_median": round(med, C.Q_VALUE),
                "pct_diff": int(round(100 * (cur - med) / med)) if med > 0 else None,
                "rank_higher_than": higher,
                "middle_half": [round(float(np.percentile(past, q)), C.Q_VALUE) for q in (25, 75)],
                "percentile": round(pctile, 1), "band": band_for(pctile)})
    return res

# -------------------------------------------------------------- Local Normal

LOCAL_NORMAL_EXPLANATIONS = {     # plan s6 table: one possible explanation, hypothesis not conclusion
    "both_elevated": "A genuine surge is more likely; two sensors agree.",
    "viirs_only": "Many small or cool fires that only the sharper sensor sees, such as crop burning.",
    "modis_only": "Timing, viewing, smoke or cloud effects; Indicative after 2019 (possible Terra/Aqua drift).",
    "neither": "Normal background, or missing data (check coverage).",
}


def local_normal_flag(modis_week: float, viirs_week: float, modis_p90: float, viirs_p90: float) -> str | None:
    """Flag from each sensor against its OWN P90. None if either side is missing."""
    if any(np.isnan(v) for v in (modis_week, viirs_week, modis_p90, viirs_p90)):
        return None
    m, v = modis_week > modis_p90, viirs_week > viirs_p90
    return "both_elevated" if m and v else "viirs_only" if v else "modis_only" if m else "neither"


def local_normal_label(flag: str | None, year: int, base_label: str) -> str:
    """The MODIS-only flag is Indicative for dates after 2019."""
    return "Indicative" if flag == "modis_only" and year > C.MODIS_ONLY_INDICATIVE_AFTER else base_label

# ------------------------------------------------------------------ sentences

TEMPLATES = {
    "prefix_in_progress": "So far this {month_name}",
    "prefix_complete": "In {month_name} {year}",
    "above": "{prefix}, burning in {region} is {pct}% above the typical {month_name}, higher than {k} of {n} past years.",
    "much_above": "{prefix}, burning in {region} is {pct}% above the typical {month_name}, higher than {k} of {n} past years, among the highest on record.",
    "near": "{prefix}, burning in {region} is close to the typical {month_name} ({signed_pct}%), higher than {k} of {n} past years.",
    "below": "{prefix}, burning in {region} is {pct}% below the typical {month_name}, higher than only {k} of {n} past years.",
    "much_below": "{prefix}, burning in {region} is {pct}% below the typical {month_name}, higher than only {k} of {n} past years, among the lowest on record.",
    "no_typical": "{prefix}, burning in {region} cannot be compared with a typical {month_name}, because past years show almost none.",
    "no_data": "There is not enough data yet to describe burning in {region} this {month_name}.",
    "basis_measured": "Based on VIIRS measurements; the latest days are provisional.",
    "basis_measured_final": "Based on VIIRS measurements.",
    "basis_estimated": "Estimated from MODIS detections converted to VIIRS scale; treat it as an estimate with a range.",
    "basis_indicative": "Indicative only: estimated from Terra alone, the least certain part of the record.",
    "near_saturation": "On the busiest days more than half the tiles were burning, so the index flattens at the peak; read it with the fraction burning and the raw hotspot view.",
    "period": "From {start} to {end}, burning in {region} stayed above the usual range for those dates for {days} days{severity} ({status}).",
    "period_severity": ", about {pct}% above the median",
    "local_normal": "This week: {flag_text}. One possible explanation: {explanation}",
    "local_normal_none": "Not enough data this week to compare each sensor with its own normal.",
    "flag_both_elevated": "both sensors are above their own normal",
    "flag_viirs_only": "only VIIRS is above its own normal",
    "flag_modis_only": "only MODIS is above its own normal",
    "flag_neither": "neither sensor is above its own normal",
    "range_note": C.RANGE_NOTE,
    "index_note": C.INDEX_NOTE,
    "safety_disclaimer": C.SAFETY_DISCLAIMER,
}
_BASIS = {"Provisional": "basis_measured", "Measured": "basis_measured_final",
          "Estimated": "basis_estimated", "Indicative": "basis_indicative"}


def _fmt_day(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {calendar.month_abbr[d.month]} {d.year}"


def month_sentence(stats: dict, region: str, label: str) -> tuple[str, str]:
    """This-month sentence from computed numbers only. Returns (variant keys, sentence)."""
    y, m = int(stats["month"][:4]), int(stats["month"][5:7])
    name = calendar.month_name[m]
    if stats["value"] is None:
        return "no_data", TEMPLATES["no_data"].format(region=region, month_name=name)
    prefix = TEMPLATES["prefix_in_progress" if stats["in_progress"] else "prefix_complete"].format(
        month_name=name, year=y)
    key = "no_typical" if stats["pct_diff"] is None else stats["band"].replace(" ", "_")
    body = TEMPLATES[key].format(prefix=prefix, region=region, month_name=name,
                                 pct=abs(stats["pct_diff"] or 0), signed_pct=f"{stats['pct_diff'] or 0:+d}",
                                 k=stats["rank_higher_than"], n=stats["rank_of"])
    parts, variant = [body, TEMPLATES[_BASIS[label]]], f"{key}+{_BASIS[label]}"
    if stats["near_saturation"]:
        parts.append(TEMPLATES["near_saturation"])
        variant += "+near_saturation"
    return variant, " ".join(parts)


def period_sentence(p: dict, region: str) -> str:
    """Sentence for one critical period."""
    sev = "" if p["severity"] is None else TEMPLATES["period_severity"].format(pct=int(round(100 * p["severity"])))
    return TEMPLATES["period"].format(start=_fmt_day(p["start"]), end=_fmt_day(p["end"]), region=region,
                                      days=p["days"], severity=sev, status=p["status"])


def local_normal_sentence(flag: str | None) -> str:
    """Cautious Local Normal wording: an explanation is a hypothesis, not a conclusion."""
    if flag is None:
        return TEMPLATES["local_normal_none"]
    return TEMPLATES["local_normal"].format(flag_text=TEMPLATES[f"flag_{flag}"],
                                            explanation=LOCAL_NORMAL_EXPLANATIONS[flag])
