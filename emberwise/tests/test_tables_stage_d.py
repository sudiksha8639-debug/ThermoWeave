"""Stage D tests: the checks added for real data (seam step, resolution sensitivity, error by
activity level, the Terra test, ratio trend) and the pieces they depend on."""
import json

import numpy as np
import polars as pl
import pytest

from pipeline.tables import analytics as A
from pipeline.tables import checks as K
from pipeline.tables import config as C
from pipeline.tables import conversion as CV
from pipeline.tables import handoff as H
from pipeline.tables.contracts import validate_file
from pipeline.tables.timeutil import day_index, era_of

N = day_index("2026-11-13") + 1
CAL = A.day_calendar(N)
SEASON = np.isin(CAL["month"], C.PILOT_MONTHS)


def load(name):
    return json.loads((C.DATA_DIR / name).read_text(encoding="utf-8"))

# ------------------------------------------------------------------ seam step

def _preset_series(viirs_factor: float) -> dict:
    """MODIS sees 10 a day in season; VIIRS (from 2012) sees viirs_factor times as much."""
    modis = np.where(SEASON, 10.0, 0.0)
    viirs = np.where(CAL["year"] >= 2012, modis * viirs_factor, np.nan)
    harm = np.where(np.isnan(viirs), modis * viirs_factor, viirs)
    as_list = lambda x: [None if np.isnan(v) else float(v) for v in x]      # noqa: E731
    return {"modis_td": as_list(modis), "viirs_td": as_list(viirs), "modis_hotspots": as_list(modis * 2),
            "viirs_hotspots": as_list(viirs * 4), "harm": as_list(harm)}


def test_seam_step_sees_the_sensor_change_in_naive_counts_only():
    res = K.seam_step(_preset_series(3.0), CAL)
    assert res["naive_tile_days_step"] == 3.0 and res["naive_hotspots_step"] == 6.0
    assert res["harmonized_step"] == 1.0 and res["before"] == [2009, 2011] and res["after"] == [2012, 2014]


def test_seam_step_reports_a_real_change_too():
    s = _preset_series(3.0)
    harm = np.array(s["harm"]); harm[CAL["year"] >= 2012] *= 2          # activity really doubled
    s["harm"] = harm.tolist()
    assert K.seam_step(s, CAL)["harmonized_step"] == 2.0


def test_seam_step_without_activity_before_gives_no_number():
    s = _preset_series(3.0)
    s["harm"] = [0.0] * N
    assert K.seam_step(s, CAL)["harmonized_step"] is None

# ------------------------------------------------------ resolution sensitivity

def _surge(days_from: str, n: int, level: float) -> np.ndarray:
    x = np.zeros(N)
    x[:day_index(C.VIIRS_START)] = np.nan
    a = day_index(days_from)
    x[a:a + n] = level
    return x


def test_res_sensitivity_confirms_only_overlapping_periods():
    r6 = _surge("2016-11-01", 15, 500.0)
    r6[day_index("2019-10-20"):day_index("2019-10-20") + 15] = 300.0
    r5 = _surge("2016-11-03", 12, 80.0)                       # sees 2016 only
    r7 = r6 * 6                                              # sees both
    res = K.res_sensitivity({5: r5, 6: r6, 7: r7}, {5: 300, 6: 2000, 7: 14000}, CAL)
    assert res["top_n"] == 2 and res["confirmed"] == {"r5": 1, "r7": 2} and res["confirmed_at_all"] == 1
    assert res["periods_found"]["r6"] == 2 and res["tiles_in_scope"] == {"r5": 300, "r6": 2000, "r7": 14000}
    first = res["periods"][0]
    assert first["start"].startswith("2016-11") and first["r5"] and first["r7"]
    assert res["periods"][1]["r5"] is False


def test_res_daily_counts_distinct_day_tiles_and_respects_gaps(tmp_path):
    from datetime import date
    rows = [("Punjab", "a", date(2016, 11, 1), "SNPP", "D"), ("Punjab", "a", date(2016, 11, 1), "SNPP", "D"),
            ("Haryana", "b", date(2016, 11, 1), "VIIRS_SNPP", "D"), ("Punjab", "c", date(2016, 11, 1), "SNPP", "N"),
            ("Punjab", "d", date(2016, 11, 1), "MODIS_ALL", "D"), ("Punjab", "a", date(2016, 11, 2), "SNPP", "D")]
    pl.DataFrame(rows, schema=["state", "h3", "date", "sensor_set", "daynight"], orient="row").write_parquet(tmp_path / "r.parquet")
    state = list(C.STATE_OF_REGION.values())
    assert {"Punjab", "Haryana"} <= set(state)
    flags = {"vday": np.ones(N, bool), "relay": np.zeros(N, bool)}
    flags["vday"][day_index("2016-11-02")] = False
    out = K.res_daily(tmp_path / "r.parquet", flags, N)
    assert out[day_index("2016-11-01")] == 2 and np.isnan(out[day_index("2016-11-02")]) and out[day_index("2016-11-03")] == 0

# ------------------------------------------------------ conversion diagnostics

def _cube(first: int, last: int, ratio_by_year=None, aqua_share=0.5) -> dict:
    """[region, zone, year, month] cube: MODIS 300 per zone-month, VIIRS = ratio x MODIS."""
    ny = last - first + 1
    M = np.full((len(C.BASE_REGIONS), 3, ny, 12), 300.0)
    r = np.array([(ratio_by_year or {}).get(first + i, 2.5) for i in range(ny)])
    cube = {s: np.zeros_like(M) for s in C.SENSOR_SETS}
    cube[C.MODIS_SET], cube["TERRA"] = M, M * (1 - aqua_share)
    cube[C.SNPP_SET] = M * r[None, None, :, None]
    return cube


def test_error_by_level_is_zero_for_a_perfect_ratio_and_signed_otherwise():
    perfect = CV.error_by_level(_cube(2012, 2019))["levels"]          # all cases equal: one level, no error
    assert len(perfect) == 1 and perfect[0]["abs_error_pct"] == 0 and perfect[0]["bias_pct"] == 0
    flat = CV.error_by_level(_cube(2012, 2019, {2015: 5.0}))
    assert sum(lv["n"] for lv in flat["levels"]) == 3 * 8 * 12
    high = next(lv for lv in flat["levels"] if lv["level"] == "high")
    assert high["bias_pct"] < 0 and high["abs_error_pct"] > 0            # the odd high year is under-predicted


def test_error_by_level_with_no_activity_says_so():
    cube = _cube(2012, 2019)
    cube[C.SNPP_SET][:] = 0.0
    assert CV.error_by_level(cube)["levels"] == []


def test_ratio_trend_flags_a_drift_and_a_flat_ratio():
    flat = CV.ratio_trend(_cube(2012, 2026))
    assert flat["pct_change_after"] == 0.0 and flat["years"][0] == 2012 and flat["years"][-1] == 2025
    drift = CV.ratio_trend(_cube(2012, 2026, {y: 2.5 - 0.1 * (y - 2012) for y in range(2012, 2027)}))
    assert drift["rho_within_learning_window"] == -1.0 and drift["pct_change_after"] < -20
    assert drift["mean_ratio_learning_window"] == pytest.approx(2.15)


def test_era_b_test_runs_on_the_mock_hand_off_and_is_signed():
    td = pl.read_parquet(C.PROCESSED_DIR / "tile_day.parquet")
    zones = load("conversion.json")["zones"]
    res = CV.era_b_test(td, zones)
    assert res["learned_on"] == list(C.LEARNING_WINDOW) and res["tested_on"] == list(C.ERA_B_TEST_YEARS)
    assert res["n"] == 9 * len(C.PRESET_IDS) and res["abs_error_pct"] >= abs(res["bias_pct"])

# --------------------------------------------------------- hand-off additions

def test_control_label_reads_the_district_name(tmp_path):
    assert H.control_label(tmp_path) == C.CONTROL_REGION["label"]         # no file: the config label
    gj = {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": None,
          "properties": {"district": "LAHUL AND SPITI", "state_name": "Himachal Pradesh"}}]}
    (tmp_path / "control_district.geojson").write_text(json.dumps(gj), encoding="utf-8")
    assert H.control_label(tmp_path) == "Lahul and Spiti, Himachal Pradesh (control district)"


def test_era_switch_is_4_july_2002():
    assert era_of("2002-07-03") == "A" and era_of("2002-07-04") == "B"

# ------------------------------------------------------- results in the files

def test_every_m3_check_has_a_result_and_a_different_reviewer():
    v = load("validation.json")
    for key in ("rank_test", "baselines", "external_check", "negative_control", "seam_step", "hide_a_year",
                "error_by_level", "era_b_test", "ratio_trend"):
        assert v[key]["result"] is not None and v[key]["owner"] == "M3" and v[key]["reviewer"] != "M3", key
    assert not validate_file("validation", C.DATA_DIR / "validation.json")


def test_failed_checks_are_reported_not_hidden():
    v = load("validation.json")
    r = v["rank_test"]["result"]
    assert r["threshold"] == C.RANK_PASS and r["passed"] == (r["rho"] >= C.RANK_PASS)
    assert "other_method" in r and "beats_both" in v["baselines"]["result"]
    assert "zone_month_level" in v["baselines"]["result"]
