"""Shows what share of hotspots the static-source mask removes, month by month.
Run from the repo root after ingest.py:  python pipeline\check_mask_months.py"""
import h3
import polars as pl

pl.Config.set_tbl_rows(40)
RES = 8

hot = pl.read_parquet("data/processed/hotspots_clean.parquet").filter(pl.col("region") == "pbhr")
static = pl.read_parquet("data/processed/static_sources.parquet").filter(pl.col("region") == "pbhr")

DATE_COL = "acq_date"
if DATE_COL not in hot.columns:
    raise SystemExit(f"No '{DATE_COL}' column. Columns are: {hot.columns}. Change DATE_COL at the top of the script.")


def add_h8(df):
    c = df.select(pl.col("latitude").cast(pl.Float64), pl.col("longitude").cast(pl.Float64)).unique()
    cells = [h3.latlng_to_cell(a, b, RES) for a, b in zip(c["latitude"].to_list(), c["longitude"].to_list())]
    return df.join(c.with_columns(pl.Series("h8", cells)), on=["latitude", "longitude"], how="left")


print("computing cells ...")
hot, static = add_h8(hot), add_h8(static)
counts = static.group_by("h8").len()

hot = hot.with_columns(pl.col(DATE_COL).str.to_date().dt.month().alias("month"))
out = hot.group_by("month").len().rename({"len": "all_rows"})

for ring, minc in ((1, 1), (0, 3)):
    cells = set()
    for c in counts.filter(pl.col("len") >= minc)["h8"].to_list():
        cells.update(h3.grid_disk(c, ring))
    name = f"pct_ring{ring}_min{minc}"
    removed = (hot.filter(pl.col("h8").is_in(list(cells))).group_by("month").len()
               .rename({"len": f"removed_r{ring}m{minc}"}))
    out = out.join(removed, on="month", how="left").with_columns(pl.col(f"removed_r{ring}m{minc}").fill_null(0))
    out = out.with_columns((100 * pl.col(f"removed_r{ring}m{minc}") / pl.col("all_rows")).round(2).alias(name))

print(out.sort("month"))