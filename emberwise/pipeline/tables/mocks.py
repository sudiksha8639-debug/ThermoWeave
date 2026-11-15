"""Mock stand-ins for everything M3 receives from M1, M2, M5 and M6.

Writes data/processed/{tiles,tile_day}.parquet and the upstream JSON contracts
(regions, coverage, hourly, drift, conversion, validation, relay_sim, hotspot CSV
headers). M3's own tables are then built from these by build.py, exactly as they
are from the real hand-offs. A real file ("mock": false) is never overwritten.

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
from . import conversion as CV
from .handoff import coverage_json, validation_skeleton
from .jsonio import envelope, read_json, write_json
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
MOCK_BOUNDARY = "MOCK rough outline; not a real boundary"

# Mock-only dates and detection chances (not facts about the satellites).
AQUA_START = "2002-07-04"
NOAA20_START = "2018-01-01"
NRT_START = "2026-09-01"
GAP = ("2005-07-10", "2005-07-12")            # MODIS outage, to exercise "a gap is null, never zero"
P_DETECT = {"terra": 0.30, "aqua": 0.35, "snpp": 0.95, "noaa20": 0.93}


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
    """tile_day.parquet in M1's contract shape (sparse rows, day passes only)."""
    amp, a = burn_propensity(tiles), parse(as_of)
    ti, dd, ss, hs = [], [], [], []
    for year in range(parse(C.EPOCH).year, a.year + 1):
        sim = simulate_year(year, amp, a)
        for sset in ("TERRA", "MODIS_ALL", "VIIRS_SNPP", "VIIRS_NOAA20"):
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

# --------------------------------------------------------- coverage and clock

def coverage_runs(as_of: str) -> list[tuple]:
    """Mock coverage as runs of (sensor_set, product, start, end, has_data)."""
    end, nrt, g0, g1 = day_index(as_of), day_index(NRT_START), day_index(GAP[0]), day_index(GAP[1])
    runs = []
    for s in ("TERRA", C.MODIS_SET):
        runs += [(s, "SP", 0, g0 - 1, True), (s, "SP", g0, g1, False), (s, "SP", g1 + 1, nrt - 1, True),
                 (s, "NRT", nrt, end, True)]
    runs += [(C.SNPP_SET, "SP", day_index(C.VIIRS_START), nrt - 1, True),
             (C.SNPP_SET, "NRT", nrt, day_index(C.SNPP_END), True),
             (C.RELAY_SET, "SP", day_index(NOAA20_START), nrt - 1, True), (C.RELAY_SET, "NRT", nrt, end, True)]
    return runs


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
            parts = CV.preset_parts(pid)
            v, m = cube[C.SNPP_SET][parts][:, :, yi][:, :, pm].sum(), cube[C.MODIS_SET][parts][:, :, yi][:, :, pm].sum()
            rby["year"].append(y0 + yi); rby["region"].append(ri)
            rby["ratio"].append(round(float(v / m), C.Q_RATIO) if m > 0 else None)
    return {**env(), "satellites": C.SATELLITES, "columns": cols,
            "modis_viirs_ratio_by_year": {"months": C.PILOT_MONTHS, "learning_window": list(C.LEARNING_WINDOW),
                                          "columns": rby}}


def hourly_json(td: pl.DataFrame) -> dict:
    """hourly.json: hotspots by local solar hour per region, satellite, year and month (sparse)."""
    g = (td.filter(pl.col("region").is_in(C.BASE_REGIONS))
         .group_by("region", pl.col("date").dt.year().alias("y"), pl.col("date").dt.month().alias("m"), "sensor_set")
         .agg(pl.col("n_hotspots").sum().alias("n")))
    tot = {(r, y, m, s): n for r, y, m, s, n in g.iter_rows()}
    cols = {k: [] for k in ("region", "satellite", "year", "month", "local_hour", "n_hotspots")}
    sat_of = {"Terra": "TERRA", "Suomi NPP": C.SNPP_SET, "NOAA-20": C.RELAY_SET}
    keys = sorted({(y, m) for (_, y, m, _) in tot})
    for ri, pid in enumerate(C.PRESET_IDS):
        parts = next(p for p in C.PRESETS if p["id"] == pid)["parts"]
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

def generate(as_of: str = C.MOCK_AS_OF, data_dir=None, processed_dir=None) -> None:
    """Write every upstream mock: Parquet hand-offs, upstream JSON and hotspot CSV headers."""
    from pathlib import Path
    data_dir, processed_dir = Path(data_dir or C.DATA_DIR), Path(processed_dir or C.MOCK_PROCESSED_DIR)
    processed_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "hotspots").mkdir(parents=True, exist_ok=True)
    tiles = build_tiles()
    td = build_tile_day(tiles, as_of)
    tiles.write_parquet(processed_dir / "tiles.parquet")
    td.write_parquet(processed_dir / "tile_day.parquet")
    zones = sorted(tiles.filter(pl.col("region").is_in(C.BASE_REGIONS))["zone_r3"].unique().to_list())
    cube = CV.monthly_cube(td, zones, C.LEARNING_WINDOW[0], parse(as_of).year)
    conv, widen = CV.build_conversion(cube, zones)
    files = {"regions": regions_json(tiles), "coverage": {**env(), **coverage_json(coverage_runs(as_of))},
             "hourly": hourly_json(td), "drift": drift_json(cube, as_of), "conversion": {**env(), **conv},
             "validation": {**env(), **validation_skeleton(CV.hide_a_year(cube, widen["B"]))},
             "relay_sim": {**env(), **CV.relay_simulation(td)[0]}}
    for name, obj in files.items():
        target = data_dir / f"{name}.json"
        if target.exists() and read_json(target).get("mock") is False:
            continue                                  # never overwrite a real hand-off with a mock
        write_json(target, obj)
    for pid in C.PRESET_IDS:                          # header only; M1 fills these per preset and year
        if any((data_dir / "hotspots").glob(f"hotspots_{pid}_*.csv")):
            continue
        (data_dir / "hotspots" / f"hotspots_{pid}_{as_of[:4]}.csv").write_text(
            ",".join(C.HOTSPOT_COLUMNS) + "\n", encoding="utf-8", newline="\n")
