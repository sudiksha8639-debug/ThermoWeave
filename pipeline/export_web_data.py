"""M1 web deliverables in the contract format: hourly.json, drift.json (with the MODIS/VIIRS ratio series) and the
hotspot CSVs. Scope is the same as tile_day: inside the Punjab / Haryana tiles, static-source mask ring 0 / min 3 removed.
Run from the repo root after tiles.py and export_contract.py:   python pipeline/export_web_data.py
Output goes to data/processed/web/ (override with the WEB_DIR environment variable):
    hourly.json, drift.json, hotspots/<preset>_<year>.csv
Needs: pip install polars pyarrow h3"""
import json
import os
from datetime import datetime, timezone

import h3
import polars as pl

PROC = "data/processed"
WEB = os.environ.get("WEB_DIR", f"{PROC}/web")
os.makedirs(f"{WEB}/hotspots", exist_ok=True)

# ---- contract constants (copied from pipeline/tables/config.py; keep in sync) ----
SCHEMA_VERSION = "1.0"
SATELLITES = ["Terra", "Aqua", "Suomi NPP", "NOAA-20", "NOAA-21"]            # code = index
SAT_CODE = {"Terra": 0, "Aqua": 1, "SNPP": 2, "N20": 3, "N21": 4}             # hotspots_clean.satellite -> code
PRESET_IDS = ["punjab", "haryana", "punjab_haryana"]                          # region code = index
PILOT_MONTHS = [10, 11]
LEARNING_WINDOW = [2012, 2019]
MASK_RES, MASK_MIN, MASK_RING = 8, 3, 0
Q_RATIO = 3

ENVELOPE = {"schema_version": SCHEMA_VERSION, "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "mock": False}


def write_json(name, obj):
    path = f"{WEB}/{name}"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({**ENVELOPE, **obj}, fh, separators=(",", ":"))
    print("wrote", path, round(os.path.getsize(path) / 1024, 1), "KB")


def with_cell(df, res):
    c = df.select(pl.col("latitude").cast(pl.Float64), pl.col("longitude").cast(pl.Float64)).unique()
    cells = [h3.latlng_to_cell(a, b, res) for a, b in zip(c["latitude"].to_list(), c["longitude"].to_list())]
    return df.join(c.with_columns(pl.Series("cell", cells)), on=["latitude", "longitude"], how="left")


# ================= scope the hotspots =================
hot = pl.read_parquet(f"{PROC}/hotspots_clean.parquet").filter(pl.col("region") == "pbhr")
hot = hot.select("latitude", "longitude", "satellite", "acq_time", "confidence", "frp", "daynight", "product",
                 "local_date", "lst")
unknown = set(hot["satellite"].unique().to_list()) - set(SAT_CODE)
assert not unknown, f"unmapped satellite values: {unknown}"

static = pl.read_parquet(f"{PROC}/static_sources.parquet")
keep = with_cell(static, MASK_RES).group_by("cell").len().filter(pl.col("len") >= MASK_MIN)["cell"].to_list()
mask = set()
for c in keep:
    mask.update(h3.grid_disk(c, MASK_RING))

hot = with_cell(hot, MASK_RES).rename({"cell": "h8"}).filter(~pl.col("h8").is_in(list(mask)))
hot = hot.with_columns(pl.Series("h3_r6", [h3.cell_to_parent(c, 6) for c in hot["h8"].to_list()]))
tiles = pl.read_parquet(f"{PROC}/tiles.parquet").filter(pl.col("region").is_in(["punjab", "haryana"])) \
    .select("h3_r6", pl.col("region").alias("part"))
hot = hot.join(tiles, on="h3_r6", how="inner")        # the clip: only Punjab and Haryana tiles
print("hotspots in scope:", hot.height, "| parts:", hot.group_by("part").len().sort("part").to_dicts())

lst24 = pl.col("lst") % 24
hot = hot.with_columns(
    pl.col("local_date").dt.year().alias("year"), pl.col("local_date").dt.month().alias("month"),
    lst24.floor().cast(pl.Int32).alias("local_hour"), lst24.alias("lst24"),
    pl.col("satellite").replace_strict(SAT_CODE, return_dtype=pl.Int32).alias("sat_code"))


def with_all(df, keys, aggs):
    """Aggregate per part (punjab / haryana) and for the union punjab_haryana. Returns a 'region' code column."""
    per = df.group_by("part", *keys).agg(*aggs).rename({"part": "pid"})
    both = df.group_by(*keys).agg(*aggs).with_columns(pl.lit("punjab_haryana").alias("pid"))
    out = pl.concat([per, both.select(per.columns)])
    return out.with_columns(pl.col("pid").replace_strict({p: i for i, p in enumerate(PRESET_IDS)}, return_dtype=pl.Int32).alias("region"))


# ================= hourly.json =================
h = with_all(hot, ["sat_code", "year", "month", "local_hour"], [pl.len().alias("n")]).sort("region", "sat_code", "year", "month", "local_hour")
write_json("hourly.json", {"satellites": SATELLITES, "columns": {
    "region": h["region"].to_list(), "satellite": h["sat_code"].to_list(), "year": h["year"].to_list(),
    "month": h["month"].to_list(), "local_hour": h["local_hour"].to_list(), "n_hotspots": h["n"].to_list()}})

# ================= drift.json =================
day = hot.filter(pl.col("daynight") == "D")
d = with_all(day, ["sat_code", "year"], [pl.col("lst24").median().alias("med"), pl.col("lst24").quantile(0.25).alias("q1"),
                                          pl.col("lst24").quantile(0.75).alias("q3")]) \
    .with_columns((pl.col("q3") - pl.col("q1")).alias("iqr")).sort("sat_code", "year", "region")

# ratio: VIIRS (Suomi NPP) tile-days / MODIS_ALL tile-days, Oct-Nov, only days where both had data (coverage)
td = pl.read_parquet(f"{PROC}/tile_day.parquet").filter(pl.col("region").is_in(["punjab", "haryana"]))
cov = pl.read_parquet(f"{PROC}/coverage.parquet").filter(pl.col("has_data") & pl.col("date").dt.month().is_in(PILOT_MONTHS))
common = (cov.filter(pl.col("sensor_set") == "MODIS_ALL").select("date")
          .join(cov.filter(pl.col("sensor_set") == "VIIRS_SNPP").select("date"), on="date", how="inner"))
td = td.join(common, on="date", how="inner").with_columns(pl.col("date").dt.year().alias("year"))


def tdays(sensor):
    per = td.filter(pl.col("sensor_set") == sensor).group_by("region", "year").len()
    both = per.group_by("year").agg(pl.col("len").sum()).with_columns(pl.lit("punjab_haryana").alias("region"))
    return pl.concat([per, both.select(per.columns)]).rename({"len": sensor})


r = tdays("MODIS_ALL").join(tdays("VIIRS_SNPP"), on=["region", "year"], how="full", coalesce=True).fill_null(0)
r = (r.filter(pl.col("year") >= 2012)
     .with_columns(pl.col("region").replace_strict({p: i for i, p in enumerate(PRESET_IDS)}, return_dtype=pl.Int32).alias("rid"),
                   pl.when(pl.col("MODIS_ALL") > 0).then((pl.col("VIIRS_SNPP") / pl.col("MODIS_ALL")).round(Q_RATIO)).otherwise(None).alias("ratio"))
     .sort("year", "rid"))
print(r.select("year", "region", "MODIS_ALL", "VIIRS_SNPP", "ratio"))
write_json("drift.json", {"satellites": SATELLITES, "columns": {
    "satellite": d["sat_code"].to_list(), "year": d["year"].to_list(), "region": d["region"].to_list(),
    "median_local_hour": [round(x, 2) for x in d["med"].to_list()], "iqr": [round(x, 2) for x in d["iqr"].to_list()]},
    "modis_viirs_ratio_by_year": {"months": PILOT_MONTHS, "learning_window": LEARNING_WINDOW, "columns": {
        "year": r["year"].to_list(), "region": r["rid"].to_list(), "ratio": r["ratio"].to_list()}}})

# ================= hotspot CSVs (header = config.HOTSPOT_COLUMNS) =================
SAT_NAME = {k: SATELLITES[v] for k, v in SAT_CODE.items()}
two = lambda e: e.cast(pl.Int32).cast(pl.String).str.pad_start(2, "0")
t = pl.col("acq_time").cast(pl.String).str.replace(r"\.0$", "").str.pad_start(4, "0")
out = hot.with_columns(
    pl.col("satellite").replace_strict(SAT_NAME, return_dtype=pl.String).alias("satellite"),
    pl.col("local_date").cast(pl.String).alias("date"),
    (t.str.slice(0, 2) + pl.lit(":") + t.str.slice(2, 2)).alias("time_utc"),
    (two(lst24.floor()) + pl.lit(":") + two(((lst24 - lst24.floor()) * 60).floor())).alias("local_solar_time"),
    pl.col("latitude").round(4).alias("lat"), pl.col("longitude").round(4).alias("lon"),
    pl.col("frp").round(1).alias("frp"))
cols = ["satellite", "date", "time_utc", "local_solar_time", "lat", "lon", "frp", "confidence", "daynight", "product"]
total = 0
for pid in PRESET_IDS:
    sub = out if pid == "punjab_haryana" else out.filter(pl.col("part") == pid)
    for y in sorted(sub["year"].unique().to_list()):
        p = f"{WEB}/hotspots/{pid}_{y}.csv"
        sub.filter(pl.col("year") == y).sort("date", "time_utc").select(cols).write_csv(p)
        total += os.path.getsize(p)
print(f"hotspot CSVs: {total/1e6:.1f} MB in {WEB}/hotspots (punjab_haryana repeats punjab + haryana)")