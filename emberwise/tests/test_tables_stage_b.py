"""Stage B tests: every M3 function on small synthetic inputs, plus the checks run on the mocks."""
import json
from datetime import date

import numpy as np
import pytest

from pipeline.tables import analytics as A
from pipeline.tables import checks as K
from pipeline.tables import config as C
from pipeline.tables.timeutil import day_index

N = day_index("2026-11-13") + 1
CAL = A.day_calendar(N)


def month_series(month: int, level_by_year: dict, default: float = 0.0) -> np.ndarray:
    """Daily series that is constant inside `month` (level depends on the year) and `default` elsewhere."""
    x = np.full(N, default)
    for y, level in level_by_year.items():
        x[(CAL["year"] == y) & (CAL["month"] == month)] = level
    return x

# ---------------------------------------------------------------- this month

NOV = {2000: 0.5, **{y: float(y - 2000) for y in range(2001, 2026)}, 2026: 22.5}


def test_month_in_progress_uses_same_days_only():
    s = A.this_month(month_series(11, NOV), np.zeros(N), CAL, date(2026, 11, 13))
    assert s["in_progress"] and s["days_compared"] == 13
    assert s["value"] == 13 * 22.5 and s["typical_median"] == 13 * 12.5      # 13 days, never a whole month
    assert s["pct_diff"] == 80 and (s["rank_higher_than"], s["rank_of"]) == (23, 26)
    assert s["middle_half"] == pytest.approx([13 * 6.25, 13 * 18.75], abs=0.06)   # stored to 1 decimal
    assert s["percentile"] == 88.5 and s["band"] == "above"


def test_complete_month_and_bands_by_position():
    for level, band in ((0.1, "much below"), (4.5, "below"), (12.5, "near"), (20.5, "above"), (99.0, "much above")):
        s = A.this_month(month_series(10, {**NOV, 2026: level}), np.zeros(N), CAL, date(2026, 10, 31))
        assert not s["in_progress"] and s["band"] == band, level


def test_missing_days_give_no_number_not_zero():
    x = month_series(11, NOV)
    x[day_index("2026-11-05")] = np.nan
    s = A.this_month(x, np.zeros(N), CAL, date(2026, 11, 13))
    assert s["value"] is None and s["band"] is None
    x = month_series(11, NOV)
    x[day_index("2010-11-05")] = np.nan                       # a past year with a gap is left out
    assert A.this_month(x, np.zeros(N), CAL, date(2026, 11, 13))["rank_of"] == 25


def test_zero_median_gives_no_percent():
    s = A.this_month(month_series(7, {2026: 3.0}), np.zeros(N), CAL, date(2026, 7, 31))
    assert s["pct_diff"] is None and s["typical_median"] == 0
    assert A.month_sentence(s, "Haryana", "Measured")[0].startswith("no_typical")

# ----------------------------------------------------------------- sentences

def _stats(band: str, pct: int, saturated: bool = False, in_progress: bool = True) -> dict:
    return {"month": "2026-11", "in_progress": in_progress, "days_compared": 13, "value": 10.0,
            "typical_median": 8.0, "pct_diff": pct, "rank_higher_than": 9, "rank_of": 10,
            "middle_half": [5.0, 9.0], "percentile": 90.0, "band": band, "near_saturation": saturated}


def test_example_sentence_from_the_brief():
    variant, text = A.month_sentence(_stats("above", 38), "Indian Punjab and Haryana", "Provisional")
    assert text == ("So far this November, burning in Indian Punjab and Haryana is 38% above the typical November, "
                    "higher than 9 of 10 past years. Based on VIIRS measurements; the latest days are provisional.")
    assert variant == "above+basis_measured"


@pytest.mark.parametrize("band,pct,word", [("much above", 150, "above"), ("above", 38, "above"), ("near", -4, "close to"),
                                           ("below", -30, "below"), ("much below", -80, "below")])
def test_a_variant_for_every_band(band, pct, word):
    variant, text = A.month_sentence(_stats(band, pct), "Haryana", "Measured")
    assert variant.startswith(band.replace(" ", "_")) and word in text
    assert (f"{abs(pct)}%" in text) or (f"{pct:+d}%" in text)
    assert "9 of 10 past years" in text


@pytest.mark.parametrize("label,phrase", [("Estimated", "Estimated from MODIS"), ("Indicative", "Indicative only"),
                                          ("Measured", "Based on VIIRS measurements."),
                                          ("Provisional", "latest days are provisional")])
def test_a_variant_for_every_label(label, phrase):
    assert phrase in A.month_sentence(_stats("above", 38, in_progress=False), "Indian Punjab", label)[1]


def test_near_saturation_variant_and_flag():
    variant, text = A.month_sentence(_stats("much above", 90, saturated=True), "Indian Punjab", "Measured")
    assert variant.endswith("+near_saturation") and "more than half the tiles" in text
    frac = np.zeros(N)
    frac[day_index("2026-11-04")] = 0.62
    assert A.this_month(month_series(11, NOV), frac, CAL, date(2026, 11, 13))["near_saturation"]


def test_no_template_uses_banned_or_overclaiming_words():
    from pipeline.tables.contracts import find_banned
    text = " ".join(A.TEMPLATES.values())
    assert not find_banned(text)
    assert "relative burning activity" in A.TEMPLATES["index_note"].lower()

# ------------------------------------------------------------ critical periods

def surge_series(extra: float, days: range) -> np.ndarray:
    """Same seasonal shape every year, plus a surge on the given days."""
    x = 100.0 + 50.0 * np.sin(2 * np.pi * CAL["doy"] / 366.0)
    x[list(days)] += extra
    return x


def test_period_found_firm_when_whole_lower_range_is_above_p90():
    a = day_index("2021-11-01")
    x = surge_series(400.0, range(a, a + 20))
    ps = A.critical_periods(x, x, 1000, CAL, ["Measured"] * N, "Indian Punjab")
    assert len(ps) == 1 and ps[0]["status"] == "firm" and ps[0]["days"] >= 14
    assert ps[0]["start"] >= "2021-11-01" and ps[0]["end"] <= "2021-11-27" and ps[0]["severity"] > 0.5
    assert "Indian Punjab" in ps[0]["sentence"] and "(firm)" in ps[0]["sentence"]


def test_period_tentative_when_lower_range_is_not_above_p90():
    a = day_index("2008-11-01")
    x = surge_series(400.0, range(a, a + 20))
    ps = A.critical_periods(x, x * 0.3, 1000, CAL, ["Estimated"] * N, "Haryana")
    assert len(ps) == 1 and ps[0]["status"] == "tentative" and ps[0]["label"] == "Estimated"


def test_short_bursts_and_tiny_values_are_not_periods():
    a = day_index("2015-07-10")
    assert A.critical_periods(surge_series(400.0, range(a, a + 1)), np.zeros(N), 10 ** 6, CAL, ["Measured"] * N, "x") == []
    quiet = np.zeros(N)
    quiet[a:a + 10] = 2.0                                      # above P90 (zero) but under 1% of tiles
    assert A.critical_periods(quiet, quiet, 1000, CAL, ["Measured"] * N, "x") == []


def test_pct_rank_orders_years_on_the_same_dates():
    x = month_series(11, NOV)
    r = A.pct_rank(x, CAL["doy"])
    i = lambda y: day_index(f"{y}-11-15")                      # noqa: E731
    assert r[i(2025)] > r[i(2013)] > r[i(2001)] and 0 <= np.nanmin(r) and np.nanmax(r) <= 100

# -------------------------------------------------------------- Local Normal

def test_local_normal_counts_use_each_sensors_own_p90():
    m = np.array([[1.0, 9.0, 9.0, np.nan]])
    v = np.array([[1.0, 1.0, 9.0, 9.0]])
    counts = A.local_normal_counts(m, v, np.full(4, 5.0), np.full(4, 5.0))
    assert counts == {"both_elevated": 1, "viirs_only": 0, "modis_only": 1, "neither": 1}   # the NaN week is skipped


def test_local_normal_wording_is_cautious():
    for flag in A.LOCAL_NORMAL_EXPLANATIONS:
        assert "One possible explanation" in A.local_normal_sentence(flag)
    assert "Indicative after 2019" in A.LOCAL_NORMAL_EXPLANATIONS["modis_only"]

# ----------------------------------------------------------------- rank test

def test_rank_test_is_not_fooled_by_the_season():
    rng = np.random.default_rng(1)
    month = np.tile(np.arange(1, 13), 10)
    season = 1000.0 * np.exp(-0.5 * ((month - 11) / 1.0) ** 2)
    x, y = season + rng.normal(0, 5, 120), season + rng.normal(0, 5, 120)     # share a season, nothing else
    assert K.spearman(x, y)[0] > 0.6
    res = K.rank_test(x, y, month)
    assert abs(res["rho"]) < 0.4 and res["passed"] is False and res["n"] == 120   # real value reported, not hidden


def test_rank_test_passes_when_years_agree_and_within_month_method():
    rng = np.random.default_rng(2)
    month = np.tile(np.arange(1, 13), 10)
    year_effect = np.repeat(rng.uniform(0.5, 1.5, 10), 12)
    season = 100.0 + 1000.0 * np.exp(-0.5 * ((month - 11) / 1.0) ** 2)
    x, y = season * year_effect, 1.9 * season * year_effect * rng.uniform(0.98, 1.02, 120)
    assert K.rank_test(x, y, month)["passed"] is True
    res = K.rank_test(x, y, month, method="within_month")
    assert res["passed"] is True and "within each calendar month" in res["method"]


def test_rank_test_handles_too_little_data():
    res = K.rank_test([1.0, 2.0], [2.0, 1.0], method="plain")
    assert res["rho"] is None and res["passed"] is None and res["n"] == 2

# ------------------------------------------------------------------ baselines

def test_baselines_compare_three_predictions():
    years = list(range(2012, 2020))
    ratio = {y: 1.5 + 0.1 * (y - 2012) for y in years}                         # the true ratio changes by year
    modis = {(0, y): 100.0 for y in years}
    hide = {"region": [0] * 8, "year": years, "actual": [100.0 * ratio[y] for y in years],
            "predicted": [100.0 * ratio[y] * 1.01 for y in years]}             # the conversion is 1% off
    res = K.baselines(hide, modis)
    assert res["n"] == 8 and res["per_zone_month"] == 1.0 and res["beats_both"] is True
    assert res["per_zone_month"] < res["global_ratio"] < res["no_conversion"]


def test_baselines_report_a_loss_honestly():
    years = list(range(2012, 2020))
    hide = {"region": [0] * 8, "year": years, "actual": [200.0] * 8, "predicted": [300.0] * 8}
    res = K.baselines(hide, {(0, y): 100.0 for y in years})
    assert res["beats_both"] is False and res["global_ratio"] == 0.0 and res["per_zone_month"] == 50.0

# ------------------------------------------------------------- external check

def test_yearly_season_total_skips_incomplete_seasons():
    tot = K.yearly_season_total(month_series(11, NOV), CAL)
    assert tot[2025] == 30 * 25.0 and 2026 not in tot and 2000 not in tot      # 2026 unfinished; 2000 starts in Nov


def test_external_check_reuses_rank_test_and_reports_as_found(tmp_path):
    f = tmp_path / "external_series.csv"
    f.write_text("year,value\n2019,5\n2020,9\n2021,7\n2022,\n2023,1\n")
    ext = K.read_external(f)
    assert ext == {2019: 5.0, 2020: 9.0, 2021: 7.0, 2023: 1.0}
    res = K.external_check({2019: 50.0, 2020: 70.0, 2021: 90.0, 2023: 10.0, 2024: 3.0}, ext, "test series", "limits")
    assert res["years"] == [2019, 2020, 2021, 2023] and res["n"] == 4 and res["rho"] == 0.8
    assert K.read_external(tmp_path / "missing.csv") is None

# ----------------------------------------------------------- negative control

def test_negative_control_counts_only_flagged_oct_nov_days():
    quiet = np.zeros(N)
    quiet[:day_index(C.VIIRS_START)] = np.nan
    res = K.negative_control(quiet, 400, CAL)
    assert res["false_anomalies"] == 0 and res["days_tested"] == 61 * 14 and res["rate"] == 0
    a = day_index("2018-10-10")
    quiet[a:a + 12] = 60.0                                     # a burst big enough to pass the floor
    res = K.negative_control(quiet, 400, CAL)
    assert 8 <= res["false_anomalies"] <= 18 and res["rate"] > 0
    b = day_index("2018-06-10")
    quiet[b:b + 12] = 60.0                                     # outside Oct-Nov: not counted
    assert K.negative_control(quiet, 400, CAL)["false_anomalies"] == res["false_anomalies"]

# ------------------------------------------------------ checks run on the mocks

def test_validation_json_has_m3_results_with_owner_and_reviewer():
    v = json.loads((C.DATA_DIR / "validation.json").read_text(encoding="utf-8"))
    for key in ("rank_test", "baselines", "negative_control"):
        assert v[key]["status"] == "done" and v[key]["owner"] == "M3" and v[key]["reviewer"] == "M1"
        assert v[key]["result"] is not None
    assert v["rank_test"]["result"]["rho"] is not None and v["rank_test"]["result"]["threshold"] == C.RANK_PASS
    assert v["negative_control"]["result"]["days_tested"] == 61 * 14
    assert v["external_check"]["status"] == "pending"          # no outside series supplied yet
    assert v["hide_a_year"]["owner"] == "M2" and v["seam_step"]["result"] is None   # others untouched
