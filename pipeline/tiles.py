"""Step 2: H3 tiles, boundary clip, static-source mask, tile_day, coverage, regions. Run from the repo root
after ingest.py. Needs: pip install polars pyarrow h3 shapely

Default run (mask ring 0, min_count 3) writes to data/processed.
A sensitivity run with another mask setting writes to its own folder, for example (PowerShell):
    $env:MASK_RING=1; $env:MASK_MIN=1; python pipeline/tiles.py; Remove-Item Env:MASK_RING, Env:MASK_MIN
"""
import json
import os
from datetime import date

import h3
import polars as pl
from shapely.geometry import shape
from shapely.ops import unary_union

PROC = "data/processed"
BOUNDARY = "data/boundary/india_adm1.geojson"          # state polygons (M6's chosen source)
CONTROL_BOUNDARY = "data/boundary/control_district.geojson"
BOUNDARY_SOURCE = "Survey of India (SOI) state and district boundaries, supplied by M6 (licence and URL: confirm with M6)"
STATES = ["punjab", "haryana"]
CONTROL_KEYS = ["lahul", "lahaul"]
MASK_RES = 8            # static-source mask cell size (about 0.7 km2)
MASK_RING = int(os.environ.get("MASK_RING", 0))   # default 0: no neighbouring cells
MASK_MIN = int(os.environ.get("MASK_MIN", 3))     # a cell needs this many static detections to be masked
SUSPECT_MIN_OTHER = 20  # other VIIRS satellites need this many rows on a no-row day to flag it
CAL_END = date(2026, 11, 14)

# the default setting writes to data/processed; any other setting writes to its own folder
OUT = PROC if (MASK_RING, MASK_MIN) == (0, 3) else f"{PROC}/sens_ring{MASK_RING}_min{MASK_MIN}"
os.makedirs(OUT, exist_ok=True)
print(f"output folder: {OUT}")

hot = pl.read_parquet(f"{PROC}/hotspots_clean.parquet")
static = pl.read_parquet(f"{PROC}/static_sources.parquet")


def cell_table(df):
    """Maps every unique (lat, lon) to H3 cells at res 8 (mask) and parents 7, 6, 5, 3."""
    coords = df.select(pl.col("latitude").cast(pl.Float64), pl.col("longitude").cast(pl.Float64)).unique()
    lat, lon = coords["latitude"].to_list(), coords["longitude"].to_list()
    coords = coords.with_columns(pl.Series("h8", [h3.latlng_to_cell(a, b, MASK_RES) for a, b in zip(lat, lon)]))
    cells = coords["h8"].unique().to_list()
    parents = pl.DataFrame({
        "h8": cells,
        "h3_r7": [h3.cell_to_parent(c, 7) for c in cells],
        "h3_r6": [h3.cell_to_parent(c, 6) for c in cells],
        "h3_r5": [h3.cell_to_parent(c, 5) for c in cells],
        "zone_r3": [h3.cell_to_parent(c, 3) for c in cells],
    })
    return coords.join(parents, on="h8", how="left")


def add_cells(df):
    return df.join(cell_table(df), on=["latitude", "longitude"], how="left")


def load_polys(path, match):
    """match(property_string) -> label or None. Returns {label: merged polygon}."""
    gj = json.load(open(path, encoding="utf-8"))
    found = {}
    for ft in gj["features"]:
        label = None
        for v in (ft.get("properties") or {}).values():
            if isinstance(v, str) and match(v.strip().lower()):
                label = match(v.strip().lower())
                break
        if label:
            found.setdefault(label, []).append(shape(ft["geometry"]))
    return {k: unary_union(v) for k, v in found.items()}


print("adding H3 cells ...")
hot = add_cells(hot)

# ---- boundary clip (tile centroid inside the polygon; H3 polygon fill uses centroids) ----
state_of = {}          # res-6 tile -> state, pbhr
universe = {5: set(), 6: set(), 7: set()}
if os.path.exists(BOUNDARY):
    polys = load_polys(BOUNDARY, lambda s: s if s in STATES else None)
    print("boundary features matched:", {k: [round(x, 2) for x in v.bounds] for k, v in polys.items()})
    for st, poly in polys.items():
        for res in (5, 6, 7):
            cells = set(h3.geo_to_cells(poly, res))
            universe[res] |= cells
            if res == 6:
                for c in cells:
                    state_of[c] = st.title()
    print("in-scope tiles r5/r6/r7:", len(universe[5]), len(universe[6]), len(universe[7]))
    clipped = True
else:
    print("WARNING: no boundary file at", BOUNDARY, "-> UNCLIPPED (bounding box) output. Do not call this Indian Punjab and Haryana.")
    clipped = False

if clipped:
    st_df = pl.DataFrame({"h3_r6": list(state_of), "state": list(state_of.values())})
    pb = hot.filter(pl.col("region") == "pbhr").join(st_df, on="h3_r6", how="inner")
else:
    pb = hot.filter(pl.col("region") == "pbhr").with_columns(pl.lit("UNCLIPPED").alias("state"))
    for res, col in ((5, "h3_r5"), (6, "h3_r6"), (7, "h3_r7")):
        universe[res] = set(pb[col].unique().to_list())

ctl = hot.filter(pl.col("region") == "control")
if os.path.exists(CONTROL_BOUNDARY):
    cp = load_polys(CONTROL_BOUNDARY, lambda s: "control" if any(k in s for k in CONTROL_KEYS) else None)
    if "control" in cp:
        keep = set(h3.geo_to_cells(cp["control"], 6))
        ctl = ctl.filter(pl.col("h3_r6").is_in(list(keep)))
        print("control district tiles (r6):", len(keep), "| control rows kept:", ctl.height)
    else:
        print("WARNING: control polygon not found in", CONTROL_BOUNDARY, "-> control UNCLIPPED")
else:
    print("WARNING: no control boundary file -> control UNCLIPPED (bounding box)")
ctl = ctl.with_columns(pl.lit("Control").alias("state"))
print("rows in scope: pbhr", pb.height, "| control", ctl.height)

# ---- sensor sets ----
SETS = {
    "SNPP": pl.col("family") == "SNPP", "N20": pl.col("family") == "N20", "N21": pl.col("family") == "N21",
    "TERRA": pl.col("satellite") == "Terra", "AQUA": pl.col("satellite") == "Aqua",
    "MODIS_ALL": pl.col("family") == "MODIS",   # union of Terra and Aqua flags, never a sum
}
VIIRS_SETS = ["SNPP", "N20", "N21"]

# ---- coverage (rows in scope, BEFORE the static mask: a day with only masked rows still has data) ----
whole = hot.filter(pl.col("region") == "pbhr")   # whole box, to find each product's delivered window
windows = {}
for fam in ("SNPP", "N20", "N21", "MODIS"):
    for prod in ("SP", "NRT"):
        w = whole.filter((pl.col("family") == fam) & (pl.col("product") == prod))
        if w.height:
            # windows use the UTC date range of delivered files, so a local day that straddles the SP/NRT switch is not a false gap
            windows[(fam, prod)] = (w["utc_date"].min(), w["utc_date"].max())
cov_parts = []
for name, cond in SETS.items():
    fam = "MODIS" if name in ("TERRA", "AQUA", "MODIS_ALL") else name
    start = whole.filter(cond)["local_date"].min()
    days = pl.DataFrame({"date": pl.date_range(start, CAL_END, "1d", eager=True)})
    in_win = pl.lit(False)
    for prod in ("SP", "NRT"):
        if (fam, prod) in windows:
            a, b = windows[(fam, prod)]
            in_win = in_win | ((pl.col("date") >= a) & (pl.col("date") <= b))
    counts = pb.filter(cond).group_by("local_date").agg(pl.len().alias("n_hotspots_in_scope")).rename({"local_date": "date"})
    c = (days.join(counts, on="date", how="left")
         .with_columns(pl.col("n_hotspots_in_scope").fill_null(0), in_win.alias("in_window"))
         .with_columns(pl.when(~pl.col("in_window")).then(pl.lit("gap"))
                       .when(pl.col("n_hotspots_in_scope") > 0).then(pl.lit("data"))
                       .otherwise(pl.lit("no_rows")).alias("status"),
                       pl.lit(name).alias("sensor_set")))
    cov_parts.append(c)
cov = pl.concat(cov_parts)
viirs_total = (cov.filter(pl.col("sensor_set").is_in(VIIRS_SETS)).group_by("date")
               .agg(pl.col("n_hotspots_in_scope").sum().alias("viirs_total")))
cov = (cov.join(viirs_total, on="date", how="left")
       .with_columns(((pl.col("status") == "no_rows") & pl.col("sensor_set").is_in(VIIRS_SETS)
                      & (pl.col("viirs_total") >= SUSPECT_MIN_OTHER)).alias("suspect_gap"),
                     (pl.col("status") != "gap").alias("has_data"))
       .select("date", "sensor_set", "status", "has_data", "n_hotspots_in_scope", "suspect_gap")
       .sort("sensor_set", "date"))
cov.write_parquet(f"{OUT}/coverage.parquet")
print("coverage rows:", cov.height)
print(cov.group_by("sensor_set", "status").len().sort("sensor_set", "status"))
print("suspect-gap days by satellite:", cov.filter(pl.col("suspect_gap")).group_by("sensor_set").len().to_dicts())

# ---- static-source mask (from SP type-2 locations), applied to every row of every era ----
# one row per static detection, so the per-cell counts match check_mask.py
sc = add_cells(static)
cnt = sc.group_by("h8").len().filter(pl.col("len") >= MASK_MIN)
mask = set()
for c8 in cnt["h8"].to_list():
    mask.update(h3.grid_disk(c8, MASK_RING))
print(f"mask setting: ring {MASK_RING}, min_count {MASK_MIN} | mask cells:", len(mask))
mask_list = list(mask)


def apply_mask(df, label):
    m = df["h8"].is_in(mask_list)
    print(f"mask removes ({label}):", df.filter(m).group_by("family", "product").len().sort("family", "product").to_dicts())
    return df.filter(~m)


pb = apply_mask(pb, "pbhr")
ctl = apply_mask(ctl, "control")

# ---- tile_day at res 5, 6, 7 ----
def tile_day(df, res):
    col = f"h3_r{res}"
    parts = []
    for name, cond in SETS.items():
        sub = df.filter(cond)
        if sub.height == 0:
            continue
        # one row per tile-day (a local day can hold SP rows and NRT rows; they are merged, product = NRT if any NRT row)
        parts.append(sub.group_by("state", col, "zone_r3", "local_date", "daynight")
                     .agg(pl.len().alias("n_hotspots"), pl.col("frp").sum().alias("frp_sum"),
                          pl.when((pl.col("product") == "NRT").any()).then(pl.lit("NRT")).otherwise(pl.lit("SP")).alias("product"))
                     .with_columns(pl.lit(name).alias("sensor_set")))
    out = (pl.concat(parts).rename({col: "h3", "local_date": "date"})
           .with_columns(pl.lit(1).alias("n_tile_day"), pl.lit(res).alias("res"))
           .select("state", "res", "h3", "zone_r3", "date", "sensor_set", "product", "daynight",
                   "n_hotspots", "frp_sum", "n_tile_day").sort("sensor_set", "date", "h3"))
    return out


for res in (5, 6, 7):
    td = tile_day(pb, res)
    td.write_parquet(f"{OUT}/tile_day_r{res}.parquet")
    print(f"tile_day_r{res}: {td.height} rows")
tdc = tile_day(ctl, 6)
tdc.write_parquet(f"{OUT}/tile_day_control_r6.parquet")
print("tile_day_control_r6:", tdc.height, "rows")

# ---- regions ----
tiles = []
for c in sorted(universe[6]):
    lat, lon = h3.cell_to_latlng(c)
    tiles.append({"h3_r6": c, "zone_r3": h3.cell_to_parent(c, 3), "state": state_of.get(c, "UNCLIPPED"),
                  "lat": round(lat, 4), "lon": round(lon, 4)})
regions = {
    "boundary_source": BOUNDARY_SOURCE,
    "clipped_to_boundary": clipped,
    "label": "Indian Punjab and Haryana",
    "rule": "A tile is in scope if its centroid is inside the state polygon.",
    "static_mask": {"res": MASK_RES, "ring": MASK_RING, "min_count": MASK_MIN},
    "in_scope_tile_count": {f"r{r}": len(universe[r]) for r in (5, 6, 7)},
    "presets": {
        "indian_punjab": [t["h3_r6"] for t in tiles if t["state"] == "Punjab"],
        "haryana": [t["h3_r6"] for t in tiles if t["state"] == "Haryana"],
        "punjab_haryana": [t["h3_r6"] for t in tiles],
    },
    "tiles_r6": tiles,
}
json.dump(regions, open(f"{OUT}/regions.json", "w"))
print("regions.json written | r6 tiles:", len(tiles))
print("DONE. clipped =", clipped, "| mask ring", MASK_RING, "min", MASK_MIN, "| output", OUT)