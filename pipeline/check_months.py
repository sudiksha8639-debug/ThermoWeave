import polars as pl

df = pl.read_parquet("data/processed/hotspots_clean.parquet").filter(
    (pl.col("region") == "pbhr") & (pl.col("acq_date") >= "2026-05-01")
    & pl.col("family").is_in(["SNPP", "N20", "N21"]))
df = df.with_columns(pl.col("acq_date").str.slice(0, 7).alias("month"))
print(df.group_by("month", "family", "daynight").agg(pl.len().alias("rows")).sort("month", "family", "daynight"))