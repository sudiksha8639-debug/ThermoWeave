"""Stage C tests: the hand-off readers, the fallback conversion and the real-pipeline pieces."""
import json
from datetime import date

import numpy as np
import polars as pl
import pytest

from pipeline.tables import build as B
from pipeline.tables import config as C
from pipeline.tables import conversion as CV
from pipeline.tables import handoff as H
from pipeline.tables.contracts import validate_file
from pipeline.tables.timeutil import day_index

D = C.DATA_DIR


def load(name):
    return json.loads((D / name).read_text(encoding="utf-8"))

# ----------------------------------------------------------------- conversion

def test_fit_ratio_recovers_a_constant_ratio():
    M = np.full((2, 8, 12), 100.0)
    fit = CV.fit_ratio(2.5 * M, M)
    assert np.allclose(fit["ratio"], 2.5) and np.allclose(fit["lo"], 2.5) and np.allclose(fit["hi"], 2.5)
    assert fit["n_support"][0, 0] == 800


def test_fit_ratio_shrinks_thin_zones_to_the_region():
    M = np.zeros((2, 8, 12)); V = np.zeros((2, 8, 12))
    M[0], V[0] = 1000.0, 2000.0                       # a busy zone with ratio 2
    M[1, 0, :], V[1, 0, :] = 1.0, 10.0                # one tile-day in one year with ratio 10
    fit = CV.fit_ratio(V, M)
    assert fit["ratio"][0, 0] == pytest.approx(2.0, abs=0.01)
    assert 2.0 < fit["ratio"][1, 0] < 3.0             # pulled almost all the way to the region
    assert (fit["lo"] <= fit["ratio"]).all() and (fit["ratio"] <= fit["hi"]).all()


def test_fit_ratio_month_without_modis_uses_the_all_month_ratio():
    M = np.full((1, 8, 12), 50.0); M[:, :, 6] = 0.0
    fit = CV.fit_ratio(3.0 * M, M)
    assert fit["ratio"][0, 6] == pytest.approx(3.0) and not np.isnan(fit["ratio"]).any()


def test_hide_a_year_never_sees_the_hidden_year():
    rng = np.random.default_rng(3)
    M = rng.uniform(50, 150, (2, 3, 8, 12))
    V = 2.0 * M
    V[:, :, 4] = 9.0 * M[:, :, 4]                     # one odd year
    rows = CV.hide_a_year_rows(V, M)
    odd = [r for r in rows if r["year_index"] == 4]
    assert len(rows) == 8 * len(C.PRESET_IDS)
    assert all(r["ratio"] < 0.3 * r["actual"] for r in odd)          # predicted from the other years only
    assert CV.widening(rows) > 0


def test_conversion_file_has_both_eras_and_widened_ranges():
    conv = load("conversion.json")
    c = conv["columns"]
    assert set(c["era"]) == {"A", "B"} and conv["learning_window"] == list(C.LEARNING_WINDOW) and conv["k"] == C.K_SUPPORT
    for lo, r, hi, wlo, whi in zip(c["lo"], c["ratio"], c["hi"], c["widened_lo"], c["widened_hi"]):
        if r is not None:
            assert wlo <= lo <= r <= hi <= whi
    assert len(c["zone"]) == 2 * 12 * len(conv["zones"])


def test_relay_simulation_shape():
    relay = load("relay_sim.json")
    assert relay["region"] == C.DEFAULT_PRESET and len(relay["columns"]["date"]) == 61
    assert relay["season"] not in relay["overlap_years"]

# ------------------------------------------------------------------- hand-off

def _coverage_file(tmp_path, rows, extra=None):
    df = pl.DataFrame({"date": [r[0] for r in rows], "sensor_set": [r[1] for r in rows],
                       "has_data": [r[2] for r in rows], **(extra or {})})
    df.write_parquet(tmp_path / "coverage.parquet")
    return tmp_path / "coverage.parquet"


def test_coverage_reader_maps_old_names_and_skips_unknown_sets(tmp_path):
    rows = [(date(2015, 11, 1), "SNPP", True), (date(2015, 11, 2), "SNPP", True), (date(2015, 11, 3), "SNPP", False),
            (date(2015, 11, 1), "AQUA", True), (date(2015, 11, 1), "N20", True)]
    runs = H.coverage_from_parquet(_coverage_file(tmp_path, rows, {"product": ["SP"] * 5}), day_index("2015-11-30") + 1)
    a = day_index("2015-11-01")
    assert (C.SNPP_SET, "SP", a, a + 1, True) in runs and (C.SNPP_SET, "SP", a + 2, a + 2, False) in runs
    assert ("VIIRS_NOAA20", "SP", a, a, True) in runs and not any(r[0] == "AQUA" for r in runs)


def test_coverage_reader_treats_suspect_gap_as_no_data(tmp_path):
    rows = [(date(2015, 11, 1), "VIIRS_SNPP", True), (date(2015, 11, 2), "VIIRS_SNPP", True)]
    path = _coverage_file(tmp_path, rows, {"product": ["SP", "NRT"], "suspect_gap": [False, True]})
    runs = H.coverage_from_parquet(path, day_index("2015-11-30") + 1)
    a = day_index("2015-11-01")
    assert runs == [(C.SNPP_SET, "SP", a, a, True), (C.SNPP_SET, "NRT", a + 1, a + 1, False)]


def test_last_covered_day_is_the_as_of_date():
    cov = load("coverage.json")
    runs = [tuple(r) for r in zip(*(cov["columns"][k] for k in ("sensor_set", "product", "start", "end", "has_data")))]
    named = [(cov["sensor_sets"][s], cov["products"][p], a, b, h) for s, p, a, b, h in runs]
    assert load("manifest.json")["as_of"] == load("narratives.json")["as_of"] == H.last_covered_day(named)
    assert not validate_file("coverage", D / "coverage.json") and cov["sensor_sets"] == C.SENSOR_SETS


def test_regions_reader_refuses_a_tile_mismatch():
    tiles = pl.read_parquet(C.PROCESSED_DIR / "tiles.parquet")
    with pytest.raises(ValueError):
        H.regions_from_m1({"presets": {"indian_punjab": ["not_a_tile"]}}, tiles)
    out = H.regions_from_m1({"in_scope_tile_count": {"r5": 11, "r7": 77}, "boundary_source": "test"}, tiles, "X (control)")
    by = {r["id"]: r for r in out["regions"]}
    assert by["punjab_haryana"]["tiles_in_scope"]["r5"] == 11 and by["haryana"]["tiles_in_scope"]["r5"] is None
    assert by["control"]["label"] == "X (control)" and by["indian_punjab"]["boundary_source"] == "test"


def test_placeholders_are_never_passed_off_as_real():
    v = load("validation.json")
    assert v["nrt_seam"]["status"] == "pending" and v["nrt_seam"]["result"] is None
    for key in C.FALLBACK_KEYS:
        assert v[key]["owner"] == "M3" and v[key]["reviewer"] == C.FALLBACK_REVIEWER
    for key, block in v.items():
        if isinstance(block, dict) and "owner" in block:
            assert block["owner"] != block["reviewer"], key

# ---------------------------------------------------------------------- build

def _flags(n, vdays=(), mdays=(), nrt=()):
    f = {k: np.zeros(n, bool) for k in ("vday", "mday", "nrt", "relay")}
    for key, days in (("vday", vdays), ("mday", mdays), ("nrt", nrt)):
        f[key][list(days)] = True
    return f


def test_month_label_rules():
    n = day_index("2026-11-13") + 1
    a = day_index("2012-01-01")
    part = _flags(n, vdays=range(a + 19, a + 31), mdays=range(a, a + 19))
    assert B.month_label("2012-01", part, "2026-11-13") == "Estimated"         # under 80% VIIRS days
    b = day_index("2015-11-01")
    assert B.month_label("2015-11", _flags(n, vdays=range(b, b + 30)), "2026-11-13") == "Measured"
    assert B.month_label("2015-11", _flags(n, vdays=range(b, b + 30), nrt=[b + 29]), "2026-11-13") == "Provisional"
    c = day_index("2001-11-01")
    assert B.month_label("2001-11", _flags(n, mdays=range(c, c + 30)), "2026-11-13") == "Indicative"


def test_manifest_paths_use_forward_slashes_and_match_disk():
    m = load("manifest.json")
    names = [f["path"] for f in m["files"]]
    assert not any("\\" in n for n in names) and any(n.startswith("hotspots/") for n in names)
    assert all((D / n).exists() for n in names)
    assert B.contract_of("hotspots/hotspots_haryana_2026.csv") == "hotspots_csv"
    assert B.contract_of("tile_month_2015.json") == "tile_month"


def test_json_files_use_unix_newlines():
    for p in list(D.glob("*.json")) + list((D / "hotspots").glob("*.csv")):
        assert b"\r\n" not in p.read_bytes(), p.name


def test_tile_geometry_matches_the_tile_table():
    g = load("tile_geometry.json")
    tiles = pl.read_parquet(C.PROCESSED_DIR / "tiles.parquet").filter(pl.col("region").is_in(C.BASE_REGIONS))
    assert len(g["tiles"]) == tiles.height and set(g["tiles"]) == set(tiles["h3_r6"].to_list())
