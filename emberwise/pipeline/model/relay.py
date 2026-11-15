"""Relay satellite: choice by the Clock Ledger, alignment to Suomi NPP, and Sensor-Loss tests (plan s2, s6, s7)."""
from __future__ import annotations

from datetime import date

import numpy as np
import polars as pl
from scipy.stats import spearmanr

from . import settings as S


def season_days(year: int) -> list[date]:
    """Every date of the Oct-Nov season of one year."""
    return [date(year, m, d) for m in S.PILOT_MONTHS for d in range(1, 32 if m == 10 else 31)]


def daily_tile_days(td: pl.DataFrame, sensor: str, regions: list[str] | None = None) -> dict:
    """{date: tile-days} for one sensor set over the given base regions, pilot months only."""
    g = (td.filter((pl.col("sensor_set") == sensor) & pl.col("region").is_in(regions or S.BASE_REGIONS)
                   & pl.col("date").dt.month().is_in(S.PILOT_MONTHS) & (pl.col("date") <= date.fromisoformat(S.SNPP_END)))
         .group_by("date").agg(pl.col("n_tile_day").sum().alias("n")))
    return dict(g.iter_rows())


def full_seasons(daily: dict) -> list[int]:
    """Years whose whole Oct-Nov season lies before the end of the Suomi NPP record and has data."""
    end = date.fromisoformat(S.SNPP_END)
    years = sorted({d.year for d in daily})
    return [y for y in years if date(y, 11, 30) <= end and any(d.year == y for d in daily)]


def clock_ledger(drift: dict, preset: str = S.DEFAULT_PRESET) -> dict:
    """{satellite name: {year: median local solar hour}} for one preset, from drift.json."""
    c, names = drift["columns"], drift["satellites"]
    code = S.DRIFT_REGION_ORDER.index(preset)
    out: dict = {}
    for sat, year, region, hour in zip(c["satellite"], c["year"], c["region"], c["median_local_hour"]):
        if region == code and hour is not None:
            out.setdefault(names[sat], {})[year] = hour
    return out


def candidate_table(td: pl.DataFrame, drift: dict) -> list[dict]:
    """One row per relay candidate: shared seasons with Suomi NPP and distance from 13:30 in those seasons."""
    ledger, snpp = clock_ledger(drift), full_seasons(daily_tile_days(td, S.SNPP))
    rows = []
    for sensor, name in S.RELAY_CANDIDATES.items():
        shared = [y for y in full_seasons(daily_tile_days(td, sensor)) if y in snpp]
        hours = [ledger.get(name, {}).get(y) for y in shared]
        hours = [h for h in hours if h is not None]
        rows.append({"sensor_set": sensor, "satellite": name, "shared_seasons": shared,
                     "qualifies": len(shared) >= S.MIN_OVERLAP_SEASONS and bool(hours),
                     "median_local_hour": round(float(np.mean(hours)), 2) if hours else None,
                     "hours_from_target": round(float(np.mean([abs(h - S.TARGET_LOCAL_HOUR) for h in hours])), 3) if hours else None})
    return rows


def choose_relay(rows: list[dict]) -> dict:
    """The qualifying candidate closest to the target hour. Marked provisional when nothing qualifies or the gap is tiny."""
    ok = sorted((r for r in rows if r["qualifies"]), key=lambda r: r["hours_from_target"])
    if not ok:
        best = max(rows, key=lambda r: len(r["shared_seasons"]))
        return {**best, "provisional": True, "reason": "no candidate meets the overlap rule; the one with most shared seasons is used"}
    margin = ok[1]["hours_from_target"] - ok[0]["hours_from_target"] if len(ok) > 1 else None
    close = margin is not None and margin < 0.05
    reason = "closest to 13:30 among satellites that meet the overlap rule"
    if close:
        reason += f"; the margin over the other candidate is only {margin:.3f} h, so the choice is provisional"
    return {**ok[0], "provisional": close, "reason": reason}


def calibration_years(sensor: str, shared: list[int], exclude: int) -> list[int]:
    """Seasons used to align a relay to Suomi NPP: shared seasons except the tested one (NOAA-20: pre-2024 only)."""
    years = [y for y in shared if y != exclude]
    if sensor == "VIIRS_NOAA20":
        years = [y for y in years if y <= S.NOAA20_LAST_CALIBRATION_YEAR]
    return years


def alignment_factor(snpp: dict, relay: dict, years: list[int]) -> float | None:
    """Suomi NPP tile-days per relay tile-day over the given seasons."""
    a = sum(n for d, n in snpp.items() if d.year in years)
    b = sum(n for d, n in relay.items() if d.year in years)
    return a / b if b else None


def deseasonalized_rho(actual: np.ndarray, built: np.ndarray, typical: np.ndarray) -> float | None:
    """Spearman between two daily series after removing the typical value of each calendar day."""
    x, y = actual - typical, built - typical
    if len(x) < 3 or np.ptp(x) == 0 or np.ptp(y) == 0:
        return None
    return round(float(spearmanr(x, y).statistic), 3)


def sensor_loss(td: pl.DataFrame, sensor: str, season: int) -> dict | None:
    """Pretend Suomi NPP stopped before `season`: rebuild the season from the relay and compare with what it saw."""
    snpp, relay = daily_tile_days(td, S.SNPP), daily_tile_days(td, sensor)
    shared = [y for y in full_seasons(relay) if y in full_seasons(snpp)]
    years = calibration_years(sensor, shared, season)
    factor = alignment_factor(snpp, relay, years)
    if season not in shared or len(years) < 1 or factor is None:
        return None
    days = season_days(season)
    actual = np.array([snpp.get(d, 0) for d in days], float)
    built = np.array([relay.get(d, 0) for d in days], float) * factor
    typical = np.array([np.mean([snpp.get(d.replace(year=y), 0) for y in years]) for d in days])
    return {"season": season, "relay": sensor, "calibration_years": years, "alignment_factor": round(factor, 4),
            "suomi_actual": round(float(actual.sum()), 1), "relay_built": round(float(built.sum()), 1),
            "pct_diff": round(100 * float(built.sum() - actual.sum()) / float(actual.sum()), 1) if actual.sum() else None,
            "daily_rho_deseasonalized": deseasonalized_rho(actual, built, typical), "rho_pass_mark": S.RANK_PASS}


def run(td: pl.DataFrame, drift: dict) -> dict:
    """Relay choice plus the two Sensor-Loss tests (last full shared season and one earlier held-out season)."""
    rows = candidate_table(td, drift)
    chosen = choose_relay(rows)
    last = chosen["shared_seasons"][-1] if chosen["shared_seasons"] else None
    tests = [t for t in (sensor_loss(td, chosen["sensor_set"], y) for y in (last, S.HELD_OUT_SEASON) if y) if t]
    other = [r for r in rows if r["sensor_set"] != chosen["sensor_set"]]
    alt = sensor_loss(td, other[0]["sensor_set"], other[0]["shared_seasons"][-1]) if other and other[0]["shared_seasons"] else None
    return {"target_local_hour": S.TARGET_LOCAL_HOUR, "candidates": rows, "chosen": chosen,
            "sensor_loss_tests": tests, "other_candidate_test": alt}
