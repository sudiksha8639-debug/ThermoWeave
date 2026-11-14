"""Stage A tests: the mock hand-offs and the tables built from them satisfy the contract
and show the features the plan asks for. conftest.py builds a private mock tree first, so real data in the repo is never touched."""
import json
import shutil

import numpy as np
import polars as pl
import pytest

from pipeline.tables import analytics as A
from pipeline.tables import config as C
from pipeline.tables.contracts import (CONTRACTS, PARQUET, find_banned, validate_file, validate_parquet,
                                       validate_tree)
from pipeline.tables.harmonize import convert_modis, harmonize, support_factor, trust_score
from pipeline.tables.jsonio import nan_array
from pipeline.tables.timeutil import day_index, days_in_month, era_of, month_list, week_of_year, parse

D = C.DATA_DIR


def load(name):
    return json.loads((D / name).read_text())


@pytest.fixture(scope="module")
def manifest():
    return load("manifest.json")


@pytest.fixture(scope="module")
def daily():
    return load("region_daily.json")


def _mutated(tmp_path, name, fn):
    data = load(name)
    fn(data)
    p = tmp_path / name
    p.write_text(json.dumps(data))
    return p

# ----------------------------------------------------------------- contract

def test_everything_on_disk_passes_contract():
    assert not {k: v for k, v in validate_tree(C.DATA_DIR, C.PROCESSED_DIR).items() if v}


def test_every_contract_row_has_a_mock():
    for name, (_, pattern) in CONTRACTS.items():
        assert list(D.glob(pattern)), name
    assert len(list((D / "hotspots").glob("*.csv"))) == len(C.PRESET_IDS)
    for fname, _, _ in PARQUET.values():
        assert (C.PROCESSED_DIR / fname).exists()


def test_schema_version_everywhere():
    for p in D.glob("*.json"):
        assert json.loads(p.read_text())["schema_version"] == C.SCHEMA_VERSION, p.name


def test_missing_field_fails(tmp_path):
    p = _mutated(tmp_path, "regions.json", lambda d: d["regions"][0].pop("tiles_in_scope"))
    assert any("tiles_in_scope" in e for e in validate_file("regions", p))


def test_extra_field_fails(tmp_path):
    p = _mutated(tmp_path, "coverage.json", lambda d: d.update(surprise=1))
    assert any("surprise" in e for e in validate_file("coverage", p))


def test_nested_extra_field_fails(tmp_path):
    p = _mutated(tmp_path, "region_daily.json", lambda d: d["presets"]["indian_punjab"].update(total_fires=[]))
    assert validate_file("region_daily", p)


def test_wrong_schema_version_fails(tmp_path):
    p = _mutated(tmp_path, "hourly.json", lambda d: d.update(schema_version="0.9"))
    assert validate_file("hourly", p)


def test_unequal_columns_fail(tmp_path):
    p = _mutated(tmp_path, "relay_sim.json", lambda d: d["columns"]["pct_diff"].pop())
    assert any("unequal" in e for e in validate_file("relay_sim", p))


def test_zero_instead_of_null_viirs_fails(tmp_path):
    def zero(d):
        d["presets"]["indian_punjab"]["viirs_td"][0] = 0
    p = _mutated(tmp_path, "region_daily.json", zero)
    assert any("never zero" in e for e in validate_file("region_daily", p))


def test_owner_cannot_review_own_check(tmp_path):
    p = _mutated(tmp_path, "validation.json", lambda d: d["rank_test"].update(reviewer="M3"))
    assert any("reviewer" in e for e in validate_file("validation", p))


@pytest.mark.parametrize("phrase", C.BANNED_PHRASES)
def test_banned_phrase_fails(tmp_path, phrase):
    def poison(d):
        d["presets"]["indian_punjab"]["this_month"]["sentence"] += f" ({phrase})"
    p = _mutated(tmp_path, "narratives.json", poison)
    assert any("banned" in e for e in validate_file("narratives", p))


def test_no_banned_phrase_in_repo():
    paths = [p for ext in ("*.py", "*.md", "*.json", "*.csv", "Makefile*") for p in C.ROOT.rglob(ext)]
    for p in paths:
        if ".pytest_cache" not in p.parts:
            assert not find_banned(p.read_text(encoding="utf-8")), p


def test_missing_and_extra_files_fail(tmp_path):
    web = tmp_path / "data"
    shutil.copytree(D, web)
    (web / "periods.json").unlink()
    (web / "stray.json").write_text("{}")
    report = validate_tree(web, C.PROCESSED_DIR)
    assert report["periods (periods.json)"] == ["file missing"]
    assert report["stray.json"] and report["manifest.json"]


def test_parquet_extra_and_missing_columns_fail(tmp_path):
    df = pl.read_parquet(C.PROCESSED_DIR / "tiles.parquet").rename({"zone_r3": "zone"})
    df.write_parquet(tmp_path / "tiles.parquet")
    errors = validate_parquet("tiles", tmp_path / "tiles.parquet")
    assert any("missing column: zone_r3" in e for e in errors) and any("extra column: zone" in e for e in errors)

# ------------------------------------------------------- features of the mocks

def test_three_presets_default_and_control():
    reg = {r["id"]: r for r in load("regions.json")["regions"]}
    assert [reg[i]["label"] for i in C.PRESET_IDS] == ["Indian Punjab", "Haryana", "Punjab + Haryana"]
    assert reg["punjab_haryana"]["default"] and reg["control"]["kind"] == "control"
    assert reg["punjab_haryana"]["tiles_in_scope"]["r6"] == (reg["indian_punjab"]["tiles_in_scope"]["r6"]
                                                             + reg["haryana"]["tiles_in_scope"]["r6"])


def test_viirs_null_before_it_existed(daily):
    cut = day_index(C.VIIRS_START)
    v = daily["presets"]["punjab_haryana"]["viirs_td"]
    assert all(x is None for x in v[:cut]) and all(x is not None for x in v[cut:])
    c = load("tile_month_2011.json")["columns"]
    assert all(x is None for x in c["raw_viirs"])


def test_gap_is_null_not_zero(daily):
    from pipeline.tables.mocks import GAP
    s = daily["presets"]["punjab_haryana"]
    for i in range(day_index(GAP[0]), day_index(GAP[1]) + 1):
        assert s["modis_td"][i] is None and s["harm"][i] is None
    assert s["harm"][day_index(GAP[0]) - 1] is not None


def test_sensors_never_added(daily):
    s = daily["presets"]["punjab_haryana"]
    i = day_index("2015-11-03")
    assert s["harm"][i] == s["viirs_td"][i] and s["modis_td"][i] > 0      # VIIRS day: MODIS not added
    j = day_index("2008-11-03")
    assert s["viirs_td"][j] is None and s["lo"][j] <= s["harm"][j] <= s["hi"][j]


def test_saturation_day_and_cap(daily):
    frac = nan_array(daily["presets"]["punjab_haryana"]["frac_burning"])
    assert C.SATURATION_FRAC < np.nanmax(frac) <= 1.0


def test_oct_nov_peak_and_quiet_months(daily):
    cal = A.day_calendar(daily["n_days"])
    harm = nan_array(daily["presets"]["punjab_haryana"]["harm"])
    by_month = np.array([np.nanmean(harm[cal["month"] == m]) for m in range(1, 13)])
    assert by_month.argmax() + 1 in (10, 11)
    assert by_month[[0, 1, 6, 7]].max() < 0.02 * by_month.max()


def test_2012_cliff_in_raw_counts_but_not_in_harmonized():
    raw, harm = {}, {}
    for y in (2010, 2011, 2012, 2013):
        c = load(f"tile_month_{y}.json")["columns"]
        raw[y], harm[y] = sum(c["raw_hotspots"]), sum(v for v in c["harm"] if v is not None)
    assert min(raw[2012], raw[2013]) > 2 * max(raw[2010], raw[2011])
    assert max(harm.values()) < 2 * min(harm.values())


def test_labels_by_era_and_provisional(manifest):
    def labels(year):
        f = load(f"tile_month_{year}.json")
        return [(manifest["months"][ym], f["label_codes"][c]) for ym, c in zip(f["blocks"]["ym"], f["blocks"]["label"])]
    assert {lab for _, lab in labels(2001)} == {"Indicative"}
    assert {lab for _, lab in labels(2005)} == {"Estimated"}
    assert {lab for _, lab in labels(2015)} == {"Measured"}
    assert dict(labels(2012))["2012-01"] == "Estimated"            # partial VIIRS month
    prov = manifest["provisional_from"]
    assert all((lab == "Provisional") == (ym >= prov) for ym, lab in labels(int(manifest["as_of"][:4])))


def test_tile_month_one_file_per_year(manifest):
    years = sorted(int(p.stem[-4:]) for p in D.glob("tile_month_*.json"))
    assert years == list(range(int(manifest["months"][0][:4]), int(manifest["as_of"][:4]) + 1))


def test_trust_rules():
    for year, top in ((2001, 60), (2005, 80)):
        t = [x for x in load(f"tile_month_{year}.json")["columns"]["trust"] if x is not None]
        assert t and max(t) <= top
    c = load("tile_month_2015.json")["columns"]
    assert all((t is None) == (h == 0) for h, t in zip(c["harm"], c["trust"]))
    assert all(lo <= h <= hi for h, lo, hi in zip(c["harm"], c["lo"], c["hi"]))


def test_control_district_is_low_fire():
    td = pl.read_parquet(C.PROCESSED_DIR / "tile_day.parquet").filter(pl.col("sensor_set") == C.SNPP_SET)
    tiles = pl.read_parquet(C.PROCESSED_DIR / "tiles.parquet")
    rate = {r: td.filter(pl.col("region") == r).height / tiles.filter(pl.col("region") == r).height
            for r in ("punjab", "control")}
    assert 0 < rate["control"] < 0.05 * rate["punjab"]


def test_narrative_numbers_come_from_code():
    n = load("narratives.json")
    for p in n["presets"].values():
        t = p["this_month"]
        assert t["in_progress"] and t["days_compared"] == int(n["as_of"][-2:])
        assert str(abs(t["pct_diff"])) in t["sentence"]
        assert f"{t['rank_higher_than']} of {t['rank_of']}" in t["sentence"]
        assert "provisional" in t["sentence"] and t["label"] == "Provisional"
        assert p["local_normal"]["flag"] in n["local_normal_explanations"]


def test_manifest_precache_and_hashes(manifest):
    assert all((D / f).exists() for f in manifest["precache"])
    assert sum(f.startswith("tile_month_") for f in manifest["precache"]) == C.PRECACHE_TILE_MONTH_YEARS
    assert all(len(f["sha256"]) == 64 for f in manifest["files"])
    assert manifest["safety_disclaimer"] == C.SAFETY_DISCLAIMER and manifest["ai_use_note"]


def test_precache_set_within_budget(manifest):
    total = sum((D / f).stat().st_size for f in manifest["precache"]) / 1024 / 1024
    assert total <= C.SIZE_BUDGET_MB, f"{total:.2f} MB"

# ------------------------------------------------------------ unit: functions

def test_convert_modis_keeps_zero_and_null():
    out = convert_modis([0, 2, 3], np.array([np.nan, 2.0, np.nan]))
    assert out[0] == 0 and out[1] == 4 and np.isnan(out[2])


def test_harmonize_caps_and_splices():
    harm, lo, hi = harmonize([5, 0, 0], [0, 2, 20], 2.0, 1.6, 2.5, 30)
    assert list(harm) == [5, 4, 30] and lo[1] == pytest.approx(3.2) and hi[2] == 30


def test_trust_score_formula_and_na():
    t = trust_score([10.0, 0.0, 10.0], [8.0, 0.0, 0.0], [12.0, 0.0, 30.0], support_factor(20), 0.8)
    assert t[0] == pytest.approx(100 * 0.6 * 0.5 * 0.8) and np.isnan(t[1]) and t[2] == 0


def test_support_factor_falls_with_few_tile_days():
    f = support_factor([0, 20, 2000])
    assert f[0] == 0 and f[1] == 0.5 and f[2] > 0.99


def test_bands():
    assert [A.band_for(p) for p in (5, 10, 29.9, 30, 70, 70.1, 90, 90.1)] == [
        "much below", "below", "below", "near", "near", "above", "above", "much above"]


def test_runs_merge_gap_of_one_and_drop_short():
    flag = np.array([1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1], bool)
    assert A._runs(flag, max_gap=1, min_days=3) == [(0, 3), (10, 12)]


def test_rolling_mean_needs_full_window():
    out = A.rolling_mean(np.array([1.0, 2.0, 3.0, np.nan, 5.0, 6.0, 7.0]), 3)
    assert np.isnan(out[:2]).all() and out[2] == 2 and np.isnan(out[3:6]).all() and out[6] == 6


def test_weekly_percentiles_are_circular():
    mat = np.zeros((3, C.CLIM_WEEKS))
    mat[:, 0] = 90.0                                  # only the first week of January has activity
    pc = A.weekly_percentiles(mat)
    assert pc["p90"][C.CLIM_WEEKS - 1] > 0 and pc["p90"][1] > 0 and pc["p90"][10] == 0


def test_local_normal_flags_and_label():
    f = A.local_normal_flag
    assert [f(5, 5, 1, 1), f(0, 5, 1, 1), f(5, 0, 1, 1), f(0, 0, 1, 1)] == [
        "both_elevated", "viirs_only", "modis_only", "neither"]
    assert f(np.nan, 5, 1, 1) is None
    assert A.local_normal_label("modis_only", 2021, "Measured") == "Indicative"
    assert A.local_normal_label("modis_only", 2015, "Measured") == "Measured"


def test_time_helpers():
    months = month_list("2026-11-13")
    assert months[0] == "2000-11" and months[-1] == "2026-11"
    assert [era_of(d) for d in ("2000-11-01", "2002-07-01", "2012-01", "2026-11-02", "2026-11-03")] == list("ABCCD")
    assert days_in_month("2026-11", "2026-11-13") == 13 and days_in_month("2024-02") == 29
    assert week_of_year(parse("2025-12-31")) == 51 and week_of_year(parse("2025-01-01")) == 0
