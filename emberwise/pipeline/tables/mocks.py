"""Mock stand-ins for everything M3 receives from M1, M2, M5 and M6.

Writes data/processed/{tiles,tile_day}.parquet and the upstream JSON contracts
(regions, coverage, hourly, drift, conversion, validation, relay_sim, hotspot CSV
headers). M3's own tables are then built from these by build.py, exactly as they
will be from the real hand-offs.

Everything is "mock": true. Behaviour is meant to be realistic (Oct-Nov peak,
smaller Apr-May peak, quiet months, saturated days, VIIRS absent before 2012,
a jump in raw counts at 2012, NRT newest months, a data gap, a low-fire control
district). The VALUES are invented and must never be quoted.
"""
from __future__ import annotations

from datetime import date

import h3
import numpy as np
import polars as pl

from . import config as C
from .jsonio import envelope, qlist, read_json, write_json
from .timeutil import day_index, index_day, parse

SEED = 20261114
GENERATED_AT = "2026-11-14T00:00:00Z"        # fixed so mocks are reproducible

# Rough outlines (lat, lng) for mocks only. Real boundaries come from M6/M1.
POLYS = {
    "punjab": [(32.3, 75.3), (32.4, 75.9), (31.3, 76.7), (30.7, 76.9), (30.3, 76.6),
               (29.6, 75.6), (29.9, 74.6), (30.1, 73.9), (30.9, 74.0), (31.6, 74.6)],
    "haryana": [(30.9, 77.0), (30.4, 77.5), (29.4, 77.1), (28.5, 77.5), (27.7, 77.2),
                (27.9, 76.3), (28.2, 75.9), (28.9, 75.5), (29.3, 74.6), (29.9, 74.6),
                (29.6, 75.6), (30.3, 76.6), (30.7, 76.9)],
    "control": [(32.0, 77.0), (32.9, 76.7), (33.2, 77.6), (32.6, 78.6), (31.9, 78.4)],
}
MOCK_BOUNDARY = "MOCK rough outline; real source and licence to be recorded by M6 [verify]"

# Mock-only dates and detection chances (not facts about the satellites).
AQUA_START = "2002-07-01"
NOAA20_START = "2018-01-01"
NRT_START = "2026-09-01"
GAP = ("2005-07-10", "2005-07-12")            # MODIS outage, to exercise "a gap is null, never zero"
P_DETECT = {"terra": 0.30, "aqua": 0.35, "snpp": 0.95, "noaa20": 0.93}
WIDEN = {"A": 0.25, "B": 0.15}                # stands in for M2's tested-error widening
RELAY_SEASON = 2025


def env() -> dict:
    """Envelope for mock files."""
    return envelope(mock=True, generated_at=GENERATED_AT)

# --------------------------------------------------------------------- tiles

def cells(region: str, res: int) -> set[str]:
    """H3 cells whose centroid is inside the mock outline of a region."""
    return set(h3.h3shape_to_cells(h3.LatLngPoly(POLYS[region]), res))


def build_tiles() -> pl.DataFrame:
    """tiles.parquet: every in-scope res-6 tile with its region and res-3 zone."""
    pb = cells("punjab", C.H3_RES)
    sets = {"punjab": pb, "haryana": cells("haryana", C.H3_RES) - pb, "control": cells("control", C.H3_RES)}
    rows = [(r, t, h3.cell_to_parent(t, C.ZONE_RES)) for r, s in sets.items() for t in sorted(s)]
    return pl.DataFrame(rows, schema=["region", "h3_r6", "zone_r3"], orient="row")


def burn_propensity(tiles: pl.DataFrame) -> np.ndarray:
    """Per-tile peak-season chance of burning on a day."""
    rng = np.random.default_rng(SEED)
    region = np.array(tiles["region"].to_list())
    lat = np.array([h3.cell_to_latlng(t)[0] for t in tiles["h3_r6"].to_list()])
    amp = np.where(region == "punjab", 0.78, 0.30) * np.clip(rng.lognormal(0, 0.35, len(lat)), 0.3, 1.25)
    amp[(region == "haryana") & (lat < 29.0)] *= 0.35
    amp[region == "control"] = 0.003
    return amp


def regions_json(tiles: pl.DataFrame) -> dict:
    """regions.json: three presets and the control district."""
    def entry(rid, label, kind, parts):
        cs = tiles.filter(pl.col("region").is_in(parts))["h3_r6"].to_list()
        ll = np.array([h3.cell_to_latlng(c) for c in cs])
        scope = {f"r{r}": (len(cs) if r == C.H3_RES else len(set().union(*(cells(p, r) for p in parts))))
                 for r in C.SENSITIVITY_RES}
        return {"id": rid, "label": label, "kind": kind, "default": rid == C.DEFAULT_PRESET,
                "tiles_in_scope": scope, "boundary_source": MOCK_BOUNDARY,
                "bbox": [round(float(v), 2) for v in (ll[:, 1].min(), ll[:, 0].min(), ll[:, 1].max(), ll[:, 0].max())]}
    out = [entry(p["id"], p["label"], "preset", p["parts"]) for p in C.PRESETS]
    out.append(entry(C.CONTROL_REGION["id"], C.CONTROL_REGION["label"], "control", ["control"]))
    return {**env(), "regions": out}

# ---------------------------------------------------------------- simulation

def season(doy: np.ndarray) -> np.ndarray:
    """Seasonal burn propensity: big Oct-Nov peak, smaller Apr-May peak, quiet otherwise."""
    return (np.exp(-0.5 * ((doy - 307) / 10.0) ** 2) + 0.30 * np.exp(-0.5 * ((doy - 125) / 8.0) ** 2) + 0.002)


def simulate_year(year: int, amp: np.ndarray, as_of: date) -> dict:
    """Detections (tile x day) for one year per sensor set. One shared 'truth', separate sensors."""
    rng = np.random.default_rng([SEED, year])
    days = np.arange(day_index(max(date(year, 1, 1), parse(C.EPOCH))), day_index(min(date(year, 12, 31), as_of)) + 1)
    doy = np.array([index_day(i).timetuple().tm_yday for i in days])
    p = np.clip(amp[:, None] * rng.uniform(0.7, 1.25) * season(doy)[None, :], 0, 0.97)
    burn = rng.random(p.shape) < p

    def seen(key, start=None, end=None):
        on = np.ones(len(days), bool)
        if start:
            on &= days >= day_index(start)
        if end:
            on &= days <= day_index(end)
        return burn & (rng.random(p.shape) < P_DETECT[key]) & on[None, :]

    modis_up = ~((days >= day_index(GAP[0])) & (days <= day_index(GAP[1])))[None, :]
    terra, aqua = seen("terra") & modis_up, seen("aqua", AQUA_START) & modis_up
    snpp, noaa20 = seen("snpp", C.VIIRS_START, C.SNPP_END), seen("noaa20", NOAA20_START)
    hs_terra = terra * (1 + rng.poisson(0.6, p.shape))
    return {"days": days,
            "TERRA": hs_terra, "MODIS_ALL": hs_terra + aqua * (1 + rng.poisson(0.8, p.shape)),
            "VIIRS_SNPP": snpp * (1 + rng.poisson(4.0, p.shape)),
            "VIIRS_NOAA20": noaa20 * (1 + rng.poisson(4.0, p.shape))}


def build_tile_day(tiles: pl.DataFrame, as_of: str) -> pl.DataFrame:
    """tile_day.parquet in M1's contract shape (sparse rows)."""
    amp, a = burn_propensity(tiles), parse(as_of)
    ti, dd, ss, hs = [], [], [], []
    for year in range(parse(C.EPOCH).year, a.year + 1):
        sim = simulate_year(year, amp, a)
        for sset in ("TERRA", "MODIS_ALL", C.SNPP_SET, C.RELAY_SET):
            t, d = np.nonzero(sim[sset])
            ti.append(t); dd.append(sim["days"][d]); hs.append(sim[sset][t, d])
            ss.append(np.full(len(t), C.SENSOR_SETS.index(sset)))
    ti, dd, ss, hs = (np.concatenate(x) for x in (ti, dd, ss, hs))
    rng = np.random.default_rng([SEED, 7])
    return pl.DataFrame({
        "region": tiles["region"].gather(ti), "h3_r6": tiles["h3_r6"].gather(ti),
        "zone_r3": tiles["zone_r3"].gather(ti),
        "date": (np.datetime64(C.EPOCH) + dd.astype("timedelta64[D]")).astype("datetime64[D]"),
        "sensor_set": pl.Series(C.SENSOR_SETS).gather(ss),
        "product": pl.Series(C.PRODUCTS).gather((dd >= day_index(NRT_START)).astype(int)),
        "frp_sum": np.round(hs * rng.uniform(4, 30, len(hs)), 1),
        "n_hotspots": hs.astype(np.int32), "n_tile_day": np.ones(len(hs), np.int32),
    })

# ------------------------------------------------------- aggregates for mocks

def yearly_cube(td: pl.DataFrame, zones: list[str], last_year: int, col: str = "n_tile_day") -> dict:
    """{sensor_set: array[base region, zone, year, month]} for 2012 onward, Suomi NPP period only."""
    y0 = C.LEARNING_WINDOW[0]
    g = (td.filter(pl.col("region").is_in(C.BASE_REGIONS) & (pl.col("date") <= parse(C.SNPP_END))
                   & (pl.col("date").dt.year() >= y0))
         .group_by("region", "zone_r3", pl.col("date").dt.year().alias("y"),
                   pl.col("date").dt.month().alias("m"), "sensor_set").agg(pl.col(col).sum().alias("n")))
    zi = {z: i for i, z in enumerate(zones)}
    cube = {s: np.zeros((2, len(zones), last_year - y0 + 1, 12)) for s in C.SENSOR_SETS}
    for r, z, y, m, s, n in g.iter_rows():
        if (y, m) != (y0, 1):                       # January 2012 is partial for VIIRS: left out
            cube[s][C.BASE_REGIONS.index(r), zi[z], y - y0, m - 1] = n
    return cube


def _div(a, b):
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(b > 0, a / b, np.nan)


def fit_ratio(V: np.ndarray, M: np.ndarray, k: float = C.K_SUPPORT):
    """Shrunk zone-month ratio (plan s6): (sum V + k r_region) / (sum M + k). V, M: [zone, year, month]."""
    r_region = _div(V.sum(axis=(0, 1)), M.sum(axis=(0, 1)))
    r_hat = (V.sum(axis=1) + k * r_region) / (M.sum(axis=1) + k)
    yearly = (V + k * r_region) / (M + k)
    return r_hat, yearly


def conversion_json(cube: dict, zones: list[str]) -> dict:
    """conversion.json: stands in for M2 (learned twice, shrunk, range widened)."""
    y0, y1 = C.LEARNING_WINDOW
    L = slice(0, y1 - y0 + 1)
    V = cube[C.SNPP_SET].sum(axis=0)
    cols = {k: [] for k in ("zone", "month", "era", "ratio", "lo", "hi", "widened_lo", "widened_hi", "n_support")}
    for era, mset in (("A", "TERRA"), ("B", C.MODIS_SET)):
        M = cube[mset].sum(axis=0)
        r_hat, yearly = fit_ratio(V[:, L], M[:, L])
        lo = np.minimum(np.percentile(yearly, 10, axis=1), r_hat)
        hi = np.maximum(np.percentile(yearly, 90, axis=1), r_hat)
        for z in range(len(zones)):
            for m in range(12):
                cols["zone"].append(z); cols["month"].append(m + 1); cols["era"].append(era)
                vals = (r_hat[z, m], lo[z, m], hi[z, m], lo[z, m] * (1 - WIDEN[era]), hi[z, m] * (1 + WIDEN[era]))
                for key, v in zip(("ratio", "lo", "hi", "widened_lo", "widened_hi"), vals):
                    cols[key].append(None if np.isnan(v) else round(float(v), C.Q_RATIO))
                cols["n_support"].append(int(M[z, L, m].sum()))
    M = cube[C.MODIS_SET].sum(axis=0)
    rby = {k: [] for k in ("zone", "month", "year", "ratio", "in_learning_window")}
    for z in range(len(zones)):
        for m in C.PILOT_MONTHS:
            for yi in range(M.shape[1]):
                r = _div(V[z, yi, m - 1], M[z, yi, m - 1])
                rby["zone"].append(z); rby["month"].append(m); rby["year"].append(y0 + yi)
                rby["ratio"].append(None if np.isnan(r) else round(float(r), C.Q_RATIO))
                rby["in_learning_window"].append(y0 + yi <= y1)
    return {**env(), "unit": "VIIRS tile-days per MODIS tile-day", "learning_window": [y0, y1],
            "k": C.K_SUPPORT, "zones": zones, "columns": cols, "ratio_by_year": {"columns": rby}}


def _preset_parts(pid: str) -> list[int]:
    return [C.BASE_REGIONS.index(r) for r in next(p for p in C.PRESETS if p["id"] == pid)["parts"]]


def pending(name: str, result) -> dict:
    """A check block that has not been run on real data yet."""
    return {"owner": C.OWNERS[name], "reviewer": C.REVIEWERS[name], "status": "pending",
            "label": "Measured", "result": result}


def validation_json(cube: dict) -> dict:
    """validation.json: mock hide-a-year from M2, every other check pending."""
    y0, y1 = C.LEARNING_WINDOW
    L = slice(0, y1 - y0 + 1)
    V, M = cube[C.SNPP_SET][:, :, L], cube[C.MODIS_SET][:, :, L]
    cols = {k: [] for k in ("region", "year", "predicted", "actual", "in_range")}
    for yi in range(y1 - y0 + 1):
        keep = np.arange(y1 - y0 + 1) != yi
        r_hat, _ = fit_ratio(V.sum(axis=0)[:, keep], M.sum(axis=0)[:, keep])       # learned without the year
        for ri, pid in enumerate(C.PRESET_IDS):
            m_y = M[_preset_parts(pid)].sum(axis=0)[:, yi]
            pred, actual = float(np.nansum(m_y * r_hat)), float(V[_preset_parts(pid)].sum(axis=0)[:, yi].sum())
            cols["region"].append(ri); cols["year"].append(y0 + yi)
            cols["predicted"].append(round(pred, C.Q_VALUE)); cols["actual"].append(actual)
            cols["in_range"].append(bool(pred * (1 - WIDEN["B"]) <= actual <= pred * (1 + WIDEN["B"])))
    hide = pending("hide_a_year", {"columns": cols})
    lo, hi = C.NEG_CONTROL_YEARS
    out = {"hide_a_year": hide}
    for name in ("error_by_level", "seam_step", "era_b_test", "ratio_trend", "res_sensitivity", "nrt_seam"):
        out[name] = pending(name, None)
    out["baselines"] = pending("baselines", {"metric": "mean absolute percent error", "n": 0,
                                             "per_zone_month": None, "global_ratio": None,
                                             "no_conversion": None, "beats_both": None,
                                           "zone_month_level": None})
    out["rank_test"] = pending("rank_test", {"method": "within calendar month, across years", "rho": None,
                                             "threshold": C.RANK_PASS, "passed": None, "n": 0,
                                             "other_method": None})
    out["external_check"] = pending("external_check", {
        "source": "[verify] MCD64A1 burned area or published Punjab farm-fire counts; chosen in prep by M6",
        "source_limits": "Only partly independent and may itself miss small crop fires.",
        "rho": None, "n": 0, "years": []})
    out["negative_control"] = pending("negative_control", {"region": C.CONTROL_REGION["id"], "years": [lo, hi],
                                                           "days_tested": 0, "false_anomalies": None, "rate": None})
    order = ["hide_a_year", "error_by_level", "baselines", "rank_test", "seam_step", "era_b_test",
             "ratio_trend", "res_sensitivity", "nrt_seam", "external_check", "negative_control"]
    return {**env(), **{k: out[k] for k in order}}


def relay_sim_json(td: pl.DataFrame) -> dict:
    """relay_sim.json: Sensor-Loss simulation on the last full Oct-Nov season (mock for M2)."""
    d = (td.filter(pl.col("region").is_in(C.BASE_REGIONS) & pl.col("date").dt.month().is_in(C.PILOT_MONTHS)
                   & pl.col("sensor_set").is_in([C.SNPP_SET, C.RELAY_SET]))
         .group_by("date", "sensor_set").agg(pl.col("n_tile_day").sum().alias("n")))
    overlap = list(range(parse(NOAA20_START).year, RELAY_SEASON))
    tot = {s: d.filter((pl.col("sensor_set") == s) & pl.col("date").dt.year().is_in(overlap))["n"].sum()
           for s in (C.SNPP_SET, C.RELAY_SET)}
    align = tot[C.SNPP_SET] / tot[C.RELAY_SET]
    season_days = range(day_index(date(RELAY_SEASON, 10, 1)), day_index(date(RELAY_SEASON, 11, 30)) + 1)
    by = {(dt, s): n for dt, s, n in d.filter(pl.col("date").dt.year() == RELAY_SEASON).iter_rows()}
    cols = {"date": [], "suomi_actual": [], "relay_built": [], "pct_diff": []}
    for i in season_days:
        actual, built = by.get((index_day(i), C.SNPP_SET), 0), by.get((index_day(i), C.RELAY_SET), 0) * align
        cols["date"].append(i); cols["suomi_actual"].append(actual)
        cols["relay_built"].append(round(built, C.Q_VALUE))
        cols["pct_diff"].append(round(100 * (built - actual) / actual, 1) if actual else None)
    return {**env(), "region": C.DEFAULT_PRESET, "season": RELAY_SEASON, "relay_satellite": "NOAA-20",
            "overlap_years": overlap, "epoch": C.EPOCH, "columns": cols}

# --------------------------------------------------------- coverage and clock

def coverage_json(as_of: str) -> dict:
    """coverage.json as runs of (sensor_set, product, start, end, has_data)."""
    end, nrt, g0, g1 = day_index(as_of), day_index(NRT_START), day_index(GAP[0]), day_index(GAP[1])
    runs = []
    for s in ("TERRA", C.MODIS_SET):
        runs += [(s, "SP", 0, g0 - 1, True), (s, "SP", g0, g1, False), (s, "SP", g1 + 1, nrt - 1, True),
                 (s, "NRT", nrt, end, True)]
    runs += [(C.SNPP_SET, "SP", day_index(C.VIIRS_START), nrt - 1, True),
             (C.SNPP_SET, "NRT", nrt, day_index(C.SNPP_END), True),
             (C.RELAY_SET, "SP", day_index(NOAA20_START), nrt - 1, True), (C.RELAY_SET, "NRT", nrt, end, True)]
    cols = {"sensor_set": [C.SENSOR_SETS.index(r[0]) for r in runs],
            "product": [C.PRODUCTS.index(r[1]) for r in runs],
            "start": [r[2] for r in runs], "end": [r[3] for r in runs], "has_data": [r[4] for r in runs]}
    return {**env(), "epoch": C.EPOCH, "sensor_sets": C.SENSOR_SETS, "products": C.PRODUCTS, "columns": cols}


def overpass_hour(sat: str, year: int) -> float:
    """Mock mean daytime overpass (local solar hour) with late drift for Terra and Aqua."""
    return {"Terra": 10.5 - 0.15 * max(0, year - 2020), "Aqua": 13.5 + 0.10 * max(0, year - 2021),
            "Suomi NPP": 13.5, "NOAA-20": 13.4}[sat]


SAT_FIRST_YEAR = {"Terra": 2000, "Aqua": 2002, "Suomi NPP": 2012, "NOAA-20": 2018}


def drift_json(cube: dict, as_of: str) -> dict:
    """drift.json: Clock Ledger per satellite-year-region, plus MODIS/VIIRS ratio by year."""
    cols = {k: [] for k in ("satellite", "year", "region", "median_local_hour", "iqr")}
    for sat, first in SAT_FIRST_YEAR.items():
        last = parse(C.SNPP_END).year if sat == "Suomi NPP" else parse(as_of).year
        for year in range(first, last + 1):
            for ri in range(len(C.PRESET_IDS)):
                cols["satellite"].append(C.SATELLITES.index(sat)); cols["year"].append(year)
                cols["region"].append(ri); cols["median_local_hour"].append(round(overpass_hour(sat, year), 2))
                cols["iqr"].append(0.9)
    y0 = C.LEARNING_WINDOW[0]
    pm = [m - 1 for m in C.PILOT_MONTHS]
    rby = {"year": [], "region": [], "ratio": []}
    for yi in range(cube[C.SNPP_SET].shape[2]):
        for ri, pid in enumerate(C.PRESET_IDS):
            parts = _preset_parts(pid)
            r = _div(cube[C.SNPP_SET][parts][:, :, yi][:, :, pm].sum(), cube[C.MODIS_SET][parts][:, :, yi][:, :, pm].sum())
            rby["year"].append(y0 + yi); rby["region"].append(ri)
            rby["ratio"].append(None if np.isnan(r) else round(float(r), C.Q_RATIO))
    return {**env(), "satellites": C.SATELLITES, "columns": cols,
            "modis_viirs_ratio_by_year": {"months": C.PILOT_MONTHS, "learning_window": list(C.LEARNING_WINDOW),
                                          "columns": rby}}


def hourly_json(td: pl.DataFrame) -> dict:
    """hourly.json: hotspots by local solar hour per region, satellite, year and month (sparse)."""
    g = (td.filter(pl.col("region").is_in(C.BASE_REGIONS))
         .group_by("region", pl.col("date").dt.year().alias("y"), pl.col("date").dt.month().alias("m"), "sensor_set")
         .agg(pl.col("n_hotspots").sum().alias("n")))
    tot: dict = {}
    for r, y, m, s, n in g.iter_rows():
        tot[(r, y, m, s)] = n
    cols = {k: [] for k in ("region", "satellite", "year", "month", "local_hour", "n_hotspots")}
    sat_of = {"Terra": "TERRA", "Suomi NPP": C.SNPP_SET, "NOAA-20": C.RELAY_SET}
    for ri, pid in enumerate(C.PRESET_IDS):
        parts = next(p for p in C.PRESETS if p["id"] == pid)["parts"]
        keys = sorted({(y, m) for (_, y, m, _) in tot})
        for sat in SAT_FIRST_YEAR:
            for y, m in keys:
                if sat == "Aqua":
                    n = sum(tot.get((r, y, m, C.MODIS_SET), 0) - tot.get((r, y, m, "TERRA"), 0) for r in parts)
                else:
                    n = sum(tot.get((r, y, m, sat_of[sat]), 0) for r in parts)
                h = overpass_hour(sat, y)
                night = int(round(0.06 * n))
                late = int(round((n - night) * (h - int(h))))
                for hour, k in ((int(h), n - night - late), (int(h) + 1, late), ((int(h) + 12) % 24, night)):
                    if k > 0:
                        for key, v in zip(cols, (ri, C.SATELLITES.index(sat), y, m, hour, int(k))):
                            cols[key].append(v)
    return {**env(), "satellites": C.SATELLITES, "columns": cols}

# -------------------------------------------------------------------- driver

def generate(as_of: str = C.MOCK_AS_OF, data_dir=C.DATA_DIR, processed_dir=C.MOCK_PROCESSED_DIR) -> None:
    """Write every upstream mock: Parquet hand-offs, upstream JSON and hotspot CSV headers."""
    processed_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "hotspots").mkdir(parents=True, exist_ok=True)
    tiles = build_tiles()
    td = build_tile_day(tiles, as_of)
    tiles.write_parquet(processed_dir / "tiles.parquet")
    td.write_parquet(processed_dir / "tile_day.parquet")
    zones = sorted(tiles.filter(pl.col("region").is_in(C.BASE_REGIONS))["zone_r3"].unique().to_list())
    cube = yearly_cube(td, zones, parse(as_of).year)
    for name, obj in (("regions", regions_json(tiles)), ("coverage", coverage_json(as_of)),
                      ("hourly", hourly_json(td)), ("drift", drift_json(cube, as_of)),
                      ("conversion", conversion_json(cube, zones)), ("validation", validation_json(cube)),
                      ("relay_sim", relay_sim_json(td))):
        target = data_dir / f"{name}.json"
        if target.exists() and read_json(target).get("mock") is False:
            continue                                  # never overwrite a real hand-off with a mock
        write_json(target, obj)
    for pid in C.PRESET_IDS:                      # header only; M1 fills these per preset and year
        if any((data_dir / "hotspots").glob(f"hotspots_{pid}_*.csv")):
            continue
        (data_dir / "hotspots" / f"hotspots_{pid}_{as_of[:4]}.csv").write_text(
            ",".join(C.HOTSPOT_COLUMNS) + "\n", encoding="utf-8", newline="\n")
