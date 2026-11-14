"""Stage C tests: turning M1's hand-off into contract files, and the fallback conversion fit."""
from datetime import date

import numpy as np
import polars as pl
import pytest

from pipeline.tables import config as C
from pipeline.tables import conversion as CV
from pipeline.tables import handoff as H
from pipeline.tables.timeutil import day_index

TILES = pl.DataFrame({"region": ["punjab", "punjab", "haryana", "control"],
                      "h3_r6": ["863d14d1fffffff", "864248ad7ffffff", "863d10407ffffff", "863d9a007ffffff"],
                      "zone_r3": ["833d14fffffffff", "834248fffffffff", "833d10fffffffff", "833d9afffffffff"]})
M1_REGIONS = {"boundary_source": "test source", "in_scope_tile_count": {"r5": 1, "r6": 3, "r7": 21},
              "presets": {"indian_punjab": ["863d14d1fffffff", "864248ad7ffffff"], "haryana": ["863d10407ffffff"],
                          "punjab_haryana": ["863d14d1fffffff", "864248ad7ffffff", "863d10407ffffff"]}}

# ------------------------------------------------------------------- regions

def test_regions_from_m1_counts_and_nulls():
    reg = {r["id"]: r for r in H.regions_from_m1(M1_REGIONS, TILES)["regions"]}
    assert set(reg) == set(C.PRESET_IDS) | {"control"}
    assert reg["punjab_haryana"]["tiles_in_scope"] == {"r5": 1, "r6": 3, "r7": 21} and reg["punjab_haryana"]["default"]
    assert reg["indian_punjab"]["tiles_in_scope"] == {"r5": None, "r6": 2, "r7": None}      # not guessed
    assert reg["control"]["kind"] == "control" and reg["control"]["tiles_in_scope"]["r6"] == 1
    assert reg["haryana"]["boundary_source"] == "test source" and len(reg["haryana"]["bbox"]) == 4


def test_regions_disagreement_is_an_error():
    bad = {**M1_REGIONS, "presets": {**M1_REGIONS["presets"], "haryana": ["863d14d1fffffff"]}}
    with pytest.raises(ValueError):
        H.regions_from_m1(bad, TILES)

# ------------------------------------------------------------------ coverage

def test_coverage_from_parquet_makes_runs_and_keeps_gaps(tmp_path):
    days = [date(2000, 11, d) for d in range(1, 11)]
    cov = pl.DataFrame({"date": days, "sensor_set": ["MODIS_ALL"] * 10,
                        "product": ["SP"] * 6 + ["NRT"] * 4,
                        "has_data": [True] * 3 + [False] * 2 + [True] * 5,
                        "status": ["x"] * 10})                                   # extra column is ignored
    cov.write_parquet(tmp_path / "coverage.parquet")
    runs = H.coverage_from_parquet(tmp_path / "coverage.parquet", n_days=12)
    assert runs == [("MODIS_ALL", "SP", 0, 2, True), ("MODIS_ALL", "SP", 3, 4, False),
                    ("MODIS_ALL", "SP", 5, 5, True), ("MODIS_ALL", "NRT", 6, 9, True)]
    body = H.coverage_json(runs)
    assert body["columns"]["has_data"] == [True, False, True, True] and body["columns"]["end"] == [2, 4, 5, 9]


def test_stand_in_coverage_uses_first_last_and_last_sp_day():
    td = pl.DataFrame({"sensor_set": ["VIIRS_SNPP"] * 3,
                       "date": [date(2012, 1, 20), date(2026, 7, 31), date(2026, 11, 2)],
                       "product": ["SP", "SP", "NRT"]})
    runs = H.coverage_from_tile_day(td, n_days=day_index("2026-11-06") + 1)
    assert runs == [("VIIRS_SNPP", "SP", day_index("2012-01-20"), day_index("2026-07-31"), True),
                    ("VIIRS_SNPP", "NRT", day_index("2026-08-01"), day_index("2026-11-02"), True)]

# --------------------------------------------------------------- conversion

def cube_like(ratio_by_zone, years=8, modis=200.0, noise=0.0, seed=0):
    """V and M of shape [zone, year, month] with a known ratio per zone."""
    rng = np.random.default_rng(seed)
    M = np.full((len(ratio_by_zone), years, 12), modis)
    V = M * np.array(ratio_by_zone)[:, None, None] * (1 + noise * rng.standard_normal(M.shape))
    return V, M


def test_fit_recovers_the_ratio_with_plenty_of_data():
    V, M = cube_like([2.0, 3.0])
    fit = CV.fit_ratio(V, M)
    assert fit["ratio"][0, 10] == pytest.approx(2.0, abs=0.02) and fit["ratio"][1, 10] == pytest.approx(3.0, abs=0.02)
    assert (fit["lo"] <= fit["ratio"]).all() and (fit["ratio"] <= fit["hi"]).all()
    assert fit["n_support"][0, 0] == 8 * 200


def test_small_samples_shrink_toward_the_region_ratio():
    V, M = cube_like([2.0, 3.0])
    M[1], V[1] = 0.5, 0.5 * 10.0                     # zone 1: almost no data, wild ratio of 10
    fit = CV.fit_ratio(V, M, k=20)
    assert 2.0 < fit["ratio"][1, 10] < 3.5           # pulled back near the region ratio (about 2)


def test_empty_zone_month_gets_the_region_ratio_not_null():
    V, M = cube_like([2.0, 2.0])
    M[1, :, 6], V[1, :, 6] = 0.0, 0.0
    fit = CV.fit_ratio(V, M)
    assert fit["ratio"][1, 6] == pytest.approx(2.0) and fit["n_support"][1, 6] == 0


def test_widening_is_p80_of_hidden_year_error():
    V, M = cube_like([2.0, 2.0], noise=0.0)
    rows = CV.hide_a_year_rows(V[None].repeat(2, axis=0), M[None].repeat(2, axis=0))
    assert len(rows) == 8 * len(C.PRESET_IDS) and CV.widening(rows) == pytest.approx(0.0, abs=1e-9)
    V2, M2 = cube_like([2.0, 2.0], noise=0.3, seed=3)
    noisy = CV.widening(CV.hide_a_year_rows(V2[None].repeat(2, axis=0), M2[None].repeat(2, axis=0)))
    assert 0 < noisy < 0.3


def test_build_conversion_and_hide_a_year_shapes():
    zones = ["z_a", "z_b"]
    V, M = cube_like([2.0, 3.0], years=15, noise=0.05, seed=1)
    cube = {s: np.zeros((2, 2, 15, 12)) for s in C.SENSOR_SETS}
    cube[C.SNPP_SET][0], cube[C.MODIS_SET][0], cube["TERRA"][0] = V, M, M * 0.4
    body, widen = CV.build_conversion(cube, zones)
    c = body["columns"]
    assert len(c["zone"]) == 2 * 12 * 2 and set(c["era"]) == {"A", "B"} and set(widen) == {"A", "B"}
    b_nov = [i for i in range(len(c["zone"])) if c["era"][i] == "B" and c["month"][i] == 11 and c["zone"][i] == 0][0]
    a_nov = [i for i in range(len(c["zone"])) if c["era"][i] == "A" and c["month"][i] == 11 and c["zone"][i] == 0][0]
    assert c["ratio"][b_nov] == pytest.approx(2.0, abs=0.1) and c["ratio"][a_nov] == pytest.approx(5.0, abs=0.3)
    assert c["widened_lo"][b_nov] <= c["lo"][b_nov] <= c["ratio"][b_nov] <= c["hi"][b_nov] <= c["widened_hi"][b_nov]
    r = body["ratio_by_year"]["columns"]
    assert sum(r["in_learning_window"]) == 2 * len(C.PILOT_MONTHS) * 8
    hide = CV.hide_a_year(cube, widen["B"])
    assert len(hide["year"]) == 8 * len(C.PRESET_IDS) and min(hide["year"]) == 2012 and max(hide["year"]) == 2019


def test_validation_skeleton_marks_fallback_owner_and_reviewer():
    v = H.validation_skeleton({"region": [0], "year": [2012], "predicted": [1.0], "actual": [1.0], "in_range": [True]})
    assert (v["hide_a_year"]["owner"], v["hide_a_year"]["reviewer"], v["hide_a_year"]["status"]) == ("M3", "M2", "done")
    assert v["baselines"]["status"] == "pending" and all(b["owner"] != b["reviewer"] for b in v.values())


def test_coverage_old_names_no_product_and_suspect_gaps(tmp_path):
    days = [date(2026, 7, d) for d in range(28, 32)] + [date(2026, 8, d) for d in range(1, 4)]
    cov = pl.DataFrame({"date": days * 2, "sensor_set": ["SNPP"] * 7 + ["AQUA"] * 7,
                        "has_data": [True] * 14, "suspect_gap": [False, True] + [False] * 12})
    cov.write_parquet(tmp_path / "coverage.parquet")
    td = pl.DataFrame({"sensor_set": ["VIIRS_SNPP"], "date": [date(2026, 7, 31)], "product": ["SP"]})
    a = day_index("2026-07-28")
    runs = H.coverage_from_parquet(tmp_path / "coverage.parquet", n_days=day_index("2026-08-03") + 1, td=td)
    assert runs == [("VIIRS_SNPP", "SP", a, a, True), ("VIIRS_SNPP", "SP", a + 1, a + 1, False),      # suspect day = gap
                    ("VIIRS_SNPP", "SP", a + 2, a + 3, True), ("VIIRS_SNPP", "NRT", a + 4, a + 6, True)]
    assert H.last_covered_day(runs) == "2026-08-03"                                             # AQUA is skipped
