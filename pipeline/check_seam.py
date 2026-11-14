import polars as pl

df = pl.read_parquet("data/processed/hotspots_clean.parquet").filter(pl.col("region") == "pbhr")
for fam in ["SNPP", "N20", "N21"]:
    sub = df.filter((pl.col("family") == fam)
                    & (pl.col("acq_date") >= "2026-07-30")
                    & (pl.col("acq_date") <= "2026-08-02"))
    print(fam)
    print(sub.group_by("acq_date", "product", "daynight").agg(
        pl.len().alias("rows"),
        pl.col("acq_time").min().alias("first_utc"),
        pl.col("acq_time").max().alias("last_utc"),
    ).sort("acq_date", "product", "daynight"))