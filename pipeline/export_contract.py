"""Writes the contract hand-off files from the tiles.py outputs:
    data/processed/tile_day.parquet   daytime passes only, res 6, main region + control, contract columns only
    data/processed/tiles.parquet      every in-scope res-6 tile, including tiles that never burn
    data/processed/coverage.parquet   renamed to the contract sensor sets, with a product (SP or NRT) column
Run from the repo root after tiles.py:   python pipeline/export_contract.py
Safe to run twice. Needs: pip install polars pyarrow h3 shapely"""
import json

import h3
import polars as pl
from shapely.geometry import shape
from shapely.ops import unary_union

PROC = "data/processed"
CONTROL_BOUNDARY = "data/boundary/control_district.geojson"
# contract sensor sets (config.SENSOR_SETS). AQUA is not one of them: MODIS_ALL already holds Terra U Aqua.
SENSOR_RENAME = {"SNPP": "VIIRS_SNPP", "N20": "VIIRS_NOAA20", "N21": "VIIRS_NOAA21"}
CONTRACT_SETS = ["TERRA", "MODIS_ALL", "VIIRS_SNPP", "VIIRS_NOAA20", "VIIRS_NOAA21"]
FAMILY_OF = {"TERRA": "MODIS", "MODIS_ALL": "MODIS", "VIIRS_SNPP": "SNPP", "VIIRS_NOAA20": "N20", "VIIRS_NOAA21": "N21"}

# ---- tile_day: DAY passes only, one row per region + tile + date + sensor set, n_tile_day = 1 ----
main = pl.read_parquet(f"{PROC}/tile_day_r6.parquet")
ctl = pl.read_parquet(f"{PROC}/tile_day_control_r6.parquet")
td = pl.concat([main, ctl], how="vertical_relaxed")
print("daynight values in input:", td["daynight"].unique().sort().to_list(), "| rows:", td.height)
td = (td.filter(pl.col("daynight") == "D")        # night passes are left out, not added in
      .with_columns(pl.col("state").str.to_lowercase().alias("region"),
                    pl.col("sensor_set").replace(SENSOR_RENAME))
      .filter(pl.col("sensor_set").is_in(CONTRACT_SETS))
      .group_by("region", "h3", "zone_r3", "date", "sensor_set")
      .agg(pl.col("n_hotspots").sum().alias("n_hotspots"),
           pl.col("frp_sum").sum().alias("frp_sum"),
           pl.when((pl.col("product") == "NRT").any()).then(pl.lit("NRT")).otherwise(pl.lit("SP")).alias("product"))
      .rename({"h3": "h3_r6"})
      .with_columns(pl.lit(1).cast(pl.Int32).alias("n_tile_day"))
      .select("region", "h3_r6", "zone_r3", "date", "sensor_set", "product", "frp_sum", "n_hotspots", "n_tile_day")
      .sort("sensor_set", "date", "region", "h3_r6"))
assert td.group_by("region", "h3_r6", "date", "sensor_set").len()["len"].max() == 1, "duplicate tile-days"
td.write_parquet(f"{PROC}/tile_day.parquet")
print("tile_day.parquet:", td.height, "rows | regions:", td["region"].unique().sort().to_list())
print("sensor_set values:", td["sensor_set"].unique().sort().to_list(), "| product values:", td["product"].unique().sort().to_list())

# ---- tiles: every in-scope res-6 tile (main region from regions.json, control from its polygon) ----
reg = json.load(open(f"{PROC}/regions.json", encoding="utf-8"))
t = reg["tiles_r6"]
tiles = pl.DataFrame({"region": [x["state"].lower() for x in t], "h3_r6": [x["h3_r6"] for x in t],
                      "zone_r3": [x["zone_r3"] for x in t]})
gj = json.load(open(CONTROL_BOUNDARY, encoding="utf-8"))
cells = sorted(h3.geo_to_cells(unary_union([shape(f["geometry"]) for f in gj["features"]]), 6))
ctl_tiles = pl.DataFrame({"region": ["control"] * len(cells), "h3_r6": cells,
                          "zone_r3": [h3.cell_to_parent(c, 3) for c in cells]})
tiles = pl.concat([tiles, ctl_tiles]).unique().sort("region", "h3_r6")
tiles.write_parquet(f"{PROC}/tiles.parquet")
print("tiles.parquet:", tiles.height, "rows |", tiles.group_by("region").len().sort("region").to_dicts())

# ---- coverage: contract sensor sets, MODIS_ALL kept, AQUA dropped, product column ----
# product rule: a day is SP up to the last day SP data was delivered for that satellite family, NRT after that.
# This also labels days with no fires, and the NRT days that are still a gap.
cov = pl.read_parquet(f"{PROC}/coverage.parquet")
if "product" in cov.columns:
    cov = cov.drop("product")
cov = (cov.with_columns(pl.col("sensor_set").replace(SENSOR_RENAME))
       .filter(pl.col("sensor_set").is_in(CONTRACT_SETS)))
sp_end = (pl.scan_parquet(f"{PROC}/hotspots_clean.parquet")
          .filter((pl.col("region") == "pbhr") & (pl.col("product") == "SP"))
          .group_by("family").agg(pl.col("utc_date").max().alias("sp_end")).collect())
print("last SP day per family:", {r["family"]: str(r["sp_end"]) for r in sp_end.to_dicts()})
ends = pl.DataFrame({"sensor_set": list(FAMILY_OF), "family": list(FAMILY_OF.values())}).join(sp_end, on="family", how="left")
cov = (cov.join(ends.select("sensor_set", "sp_end"), on="sensor_set", how="left")
       .with_columns(pl.when(pl.col("date") <= pl.col("sp_end")).then(pl.lit("SP")).otherwise(pl.lit("NRT")).alias("product"))
       .drop("sp_end")
       .select("date", "sensor_set", "product", "has_data", "status", "n_hotspots_in_scope", "suspect_gap")
       .sort("sensor_set", "date"))
cov.write_parquet(f"{PROC}/coverage.parquet")
print("coverage.parquet:", cov.height, "rows | sensor sets:", cov["sensor_set"].unique().sort().to_list())
print(cov.group_by("sensor_set", "product", "has_data").len().sort("sensor_set", "product", "has_data"))