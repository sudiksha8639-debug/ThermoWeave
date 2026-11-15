"""Step 1: read raw FIRMS CSVs, label SP/NRT, clean, add local solar date. Run from the repo root."""
import glob
import os

import polars as pl

from solar import add_local_time

RAW = "data/raw"
OUT = "data/processed"
os.makedirs(OUT, exist_ok=True)

FAMILIES = ["SV-C2", "J1V-C2", "J2V-C2", "M-C61"]
FAMILY_NAME = {"SV-C2": "SNPP", "J1V-C2": "N20", "J2V-C2": "N21", "M-C61": "MODIS"}
COLS = ["latitude", "longitude", "brightness", "scan", "track", "acq_date", "acq_time",
        "satellite", "instrument", "confidence", "version", "bright_t31", "frp",
        "daynight", "type", "product", "family", "region", "source_file"]


def load(path):
    path = os.path.normpath(path)
    name = os.path.basename(path)
    product = "NRT" if name.startswith("fire_nrt") else "SP"
    family = FAMILY_NAME[next(k for k in FAMILIES if k in name)]
    region = "control" if (os.sep + "control" + os.sep) in path else "pbhr"
    df = pl.read_csv(path, infer_schema_length=0)  # every column as text: keeps acq_time like 0729
    df = df.filter(pl.col("latitude").is_not_null())  # drops blank lines
    if "type" not in df.columns:
        df = df.with_columns(pl.lit(None, dtype=pl.String).alias("type"))
    df = df.with_columns(
        pl.lit(product).alias("product"),
        pl.lit(family).alias("family"),
        pl.lit(region).alias("region"),
        pl.lit(name).alias("source_file"),
    )
    return df.select(COLS)


files = sorted(glob.glob(f"{RAW}/**/fire_*.csv", recursive=True))
print("files found:", len(files))
df = pl.concat([load(f) for f in files])
print("rows read:", df.height)

# Static sources from SP (type 2): kept for the mask, never used as fires
static = df.filter((pl.col("product") == "SP") & (pl.col("type") == "2"))
static.select(pl.col("latitude").cast(pl.Float64), pl.col("longitude").cast(pl.Float64),
              "family", "region").write_parquet(f"{OUT}/static_sources.parquet")
print("static-source rows saved:", static.height)

df = df.with_columns(
    pl.col("latitude").cast(pl.Float64),
    pl.col("longitude").cast(pl.Float64),
    pl.col("frp").cast(pl.Float64, strict=False),
    pl.col("scan").cast(pl.Float64, strict=False),
)

print("VIIRS confidence values:",
      df.filter(pl.col("family") != "MODIS")["confidence"].unique().sort().to_list())

# SP keeps presumed vegetation fire (type 0). NRT has no type, so it is kept here and masked later.
type_ok = (pl.col("product") == "NRT") | (pl.col("type") == "0")
# MODIS confidence 30 or more; VIIRS nominal or high
conf_ok = (
    pl.when(pl.col("family") == "MODIS")
    .then(pl.col("confidence").cast(pl.Int32, strict=False) >= 30)
    .otherwise(pl.col("confidence").is_in(["n", "h"]))
)

n0 = df.height
df = df.filter(type_ok)
n1 = df.height
df = df.filter(conf_ok)
n2 = df.height
df = df.unique(subset=["region", "latitude", "longitude", "acq_date", "acq_time", "satellite"],
               keep="first", maintain_order=True)
n3 = df.height
print(f"dropped by type: {n0 - n1} | by confidence: {n1 - n2} | duplicates: {n2 - n3} | kept: {n3}")

df = add_local_time(df)
df.write_parquet(f"{OUT}/hotspots_clean.parquet")

print(df.group_by(["region", "family", "product"]).agg(
    pl.len().alias("rows"),
    pl.col("local_date").min().alias("first"),
    pl.col("local_date").max().alias("last"),
).sort(["region", "family", "product"]))