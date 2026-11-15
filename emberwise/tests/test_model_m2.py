"""Tests for the model checks: relay choice, alignment, Sensor-Loss test, peak-day fit and the NRT seam."""
from datetime import date, timedelta

import numpy as np
import polars as pl
import pytest

from pipeline.model import nrt_seam, relay, saturation
from pipeline.model import settings as S


def tile_day(rows):
    """rows: (region, tile, date, sensor_set, product) -> a tile_day-like frame with one tile-day per row."""
    return pl.DataFrame({"region": [r[0] for r in rows], "h3_r6": [r[1] for r in rows], "date": [r[2] for r in rows],
                         "sensor_set": [r[3] for r in rows], "product": [r[4] for r in rows],
                         "n_tile_day": [1] * len(rows)}, schema_overrides={"date": pl.Date})


def seasons(sensor, years, per_day):
    """`per_day(year, day_number)` tile-days on every Oct-Nov day of the given years."""
    rows = []
    for y in years:
        for k, d in enumerate(relay.season_days(y)):
            rows += [("punjab", f"t{i}", d, sensor, "SP") for i in range(per_day(y, k))]
    return rows


def drift(hours):
    """drift.json-like object from {satellite: {year: hour}} for the default preset."""
    names = list(hours)
    cols = {"satellite": [], "year": [], "region": [], "median_local_hour": []}
    for i, n in enumerate(names):
        for y, h in hours[n].items():
            cols["satellite"].append(i); cols["year"].append(y); cols["region"].append(2); cols["median_local_hour"].append(h)
    return {"satellites": names, "columns": cols}

# ----------------------------------------------------------------- relay choice

def test_relay_needs_two_shared_seasons_and_picks_the_one_nearest_1330():
    td = tile_day(seasons(S.SNPP, range(2018, 2026), lambda y, k: 3) + seasons("VIIRS_NOAA20", range(2018, 2026), lambda y, k: 3)
                  + seasons("VIIRS_NOAA21", [2025], lambda y, k: 3))
    d = drift({"NOAA-20": {y: 13.0 for y in range(2018, 2026)}, "NOAA-21": {2025: 13.5}})
    rows = relay.candidate_table(td, d)
    by = {r["sensor_set"]: r for r in rows}
    assert by["VIIRS_NOAA20"]["qualifies"] and not by["VIIRS_NOAA21"]["qualifies"]      # one shared season is not enough
    chosen = relay.choose_relay(rows)
    assert chosen["satellite"] == "NOAA-20" and chosen["provisional"] is False and chosen["hours_from_target"] == 0.5


def test_relay_choice_is_provisional_when_candidates_are_almost_tied_or_none_qualifies():
    rows = [{"sensor_set": "A", "satellite": "A", "shared_seasons": [1, 2], "qualifies": True, "hours_from_target": 0.35},
            {"sensor_set": "B", "satellite": "B", "shared_seasons": [1, 2], "qualifies": True, "hours_from_target": 0.37}]
    assert relay.choose_relay(rows)["satellite"] == "A" and relay.choose_relay(rows)["provisional"] is True
    none = [{**r, "qualifies": False} for r in rows]
    assert relay.choose_relay(none)["provisional"] is True


def test_noaa20_is_calibrated_on_pre_2024_seasons_only_and_never_on_the_tested_one():
    shared = list(range(2018, 2026))
    assert relay.calibration_years("VIIRS_NOAA20", shared, 2025) == [2018, 2019, 2020, 2021, 2022, 2023]
    assert relay.calibration_years("VIIRS_NOAA20", shared, 2021) == [2018, 2019, 2020, 2022, 2023]
    assert relay.calibration_years("VIIRS_NOAA21", [2023, 2024, 2025], 2025) == [2023, 2024]

# ------------------------------------------------------------- Sensor-Loss test

def test_sensor_loss_recovers_a_relay_that_sees_a_fixed_share():
    wave = lambda y, k: 4 + (k % 7) + (2 if y == 2025 else 0)             # noqa: E731
    td = tile_day(seasons(S.SNPP, range(2018, 2026), wave) + seasons("VIIRS_NOAA20", range(2018, 2026), lambda y, k: 2 * wave(y, k)))
    res = relay.sensor_loss(td, "VIIRS_NOAA20", 2025)
    assert res["alignment_factor"] == 0.5 and res["pct_diff"] == 0.0 and res["calibration_years"][-1] == 2023
    assert res["suomi_actual"] == res["relay_built"]


def test_sensor_loss_reports_a_real_gap_and_a_weak_daily_match():
    rng = np.random.default_rng(4)
    noise = {(y, k): int(rng.integers(0, 9)) for y in range(2018, 2026) for k in range(61)}
    own = {(y, k): int(rng.integers(1, 9)) for y in range(2018, 2026) for k in range(61)}
    td = tile_day(seasons(S.SNPP, range(2018, 2026), lambda y, k: own[(y, k)])
                  + seasons("VIIRS_NOAA20", range(2018, 2026), lambda y, k: noise[(y, k)] + (6 if y == 2025 else 0)))
    res = relay.sensor_loss(td, "VIIRS_NOAA20", 2025)
    assert res["pct_diff"] > 50 and abs(res["daily_rho_deseasonalized"]) < S.RANK_PASS     # reported as found


def test_sensor_loss_needs_a_shared_season():
    td = tile_day(seasons(S.SNPP, [2019, 2020], lambda y, k: 2))
    assert relay.sensor_loss(td, "VIIRS_NOAA20", 2020) is None


def test_days_after_the_suomi_npp_record_are_ignored():
    after = date.fromisoformat(S.SNPP_END) + timedelta(days=3)
    td = tile_day([("punjab", "t", after, "VIIRS_NOAA20", "NRT"), ("punjab", "t", date(2025, 10, 5), "VIIRS_NOAA20", "SP")])
    assert list(relay.daily_tile_days(td, "VIIRS_NOAA20")) == [date(2025, 10, 5)]

# ---------------------------------------------------------------- peak-day fit

def test_fits_recover_their_own_shape():
    f_m = np.linspace(0.01, 0.6, 50)
    assert saturation.fit_proportional(f_m, 2.5 * f_m) == pytest.approx(2.5)
    assert saturation.fit_saturating(f_m, 1 - (1 - f_m) ** 3.0) == pytest.approx(3.0, abs=0.05)


def test_saturating_fit_wins_on_high_days_when_the_truth_saturates():
    rng = np.random.default_rng(5)
    f_m = np.tile(np.linspace(0.02, 0.45, 61), 8)
    frac = pl.DataFrame({"year": np.repeat(np.arange(2012, 2020), 61), "f_m": f_m,
                         "f_v": (1 - (1 - f_m) ** 3.0) * rng.uniform(0.97, 1.03, len(f_m))})
    res = saturation.hide_a_year(frac)
    hd = res["high_days"]
    assert res["better_on_high_days"] == "saturating" and hd["proportional"]["bias_pct"] > 0
    assert hd["saturating"]["abs_error_pct"] < hd["proportional"]["abs_error_pct"]
    assert res["max_proportional_prediction"] > res["max_viirs_share"] and res["used_in_headline"] == "proportional"


def test_no_verdict_without_enough_high_days():
    frac = pl.DataFrame({"year": np.repeat(np.arange(2012, 2020), 10), "f_m": np.full(80, 0.05), "f_v": np.full(80, 0.1)})
    res = saturation.hide_a_year(frac)
    assert res["better_on_high_days"] is None and res["high_days"]["proportional"]["n_days"] == 0

# -------------------------------------------------------------------- NRT seam

def test_nrt_seam_from_pairs_uses_day_passes_and_shared_months_only():
    pairs = pl.DataFrame({"family": ["SNPP", "SNPP", "SNPP", "N20"], "month": ["2026-06", "2026-06", "2026-07", "2026-06"],
                          "daynight": ["D", "N", "D", "D"], "SP": [100, 999, 50, 200], "NRT": [115, 1, None, 204]})
    res = nrt_seam.from_pairs(pairs)
    by = {r["satellite"]: r for r in res["satellites"]}
    assert res["tested"] and by["SNPP"]["pct_shift"] == 15.0 and by["SNPP"]["factor_needed"] is True
    assert by["SNPP"]["months"] == ["2026-06"] and by["N20"]["pct_shift"] == 2.0 and by["N20"]["factor_needed"] is False


def test_nrt_seam_says_untested_when_nothing_overlaps(tmp_path):
    empty = pl.DataFrame({"family": ["SNPP"], "month": ["2026-06"], "daynight": ["D"], "SP": [10], "NRT": [None]},
                         schema_overrides={"NRT": pl.Int64})
    assert nrt_seam.from_pairs(empty)["tested"] is False
    assert nrt_seam.from_pairs(pl.DataFrame({"family": ["x"]}))["tested"] is False
    td = tile_day([("punjab", "t", date(2026, 7, 1), S.SNPP, "SP"), ("punjab", "t", date(2026, 8, 2), S.SNPP, "NRT")])
    res = nrt_seam.run(td, tmp_path)
    assert res["tested"] is False and res["months_with_both_products"] == 0 and res["nrt_starts"] == {S.SNPP: "2026-08-02"}

# ------------------------------------------------------------------- manifest

def test_refresh_manifest_updates_only_changed_entries(tmp_path):
    import hashlib
    import json

    from pipeline.model.refresh_manifest import refresh
    (tmp_path / "a.json").write_text("{}"); (tmp_path / "b.json").write_text("[1]")
    good = hashlib.sha256(b"{}").hexdigest()
    m = {"as_of": "2026-11-05", "files": [{"path": "a.json", "contract": "a", "bytes": 2, "sha256": good},
                                          {"path": "b.json", "contract": "b", "bytes": 99, "sha256": "0" * 64},
                                          {"path": "gone.json", "contract": "c", "bytes": 1, "sha256": "1" * 64}]}
    (tmp_path / "manifest.json").write_text(json.dumps(m, separators=(",", ":")))
    assert refresh(tmp_path) == ["b.json"]
    out = json.loads((tmp_path / "manifest.json").read_text())
    assert out["files"][0] == m["files"][0] and out["files"][2] == m["files"][2] and out["as_of"] == "2026-11-05"
    assert out["files"][1]["bytes"] == 3 and out["files"][1]["sha256"] == hashlib.sha256(b"[1]").hexdigest()
    assert refresh(tmp_path) == []
