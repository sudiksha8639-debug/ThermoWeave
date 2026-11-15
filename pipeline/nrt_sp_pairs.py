import polars as pl
pl.Config.set_tbl_rows(80); pl.Config.set_tbl_cols(14)

df = pl.read_parquet("data/processed/hotspots_clean.parquet")
print(df.schema)

# Find the SP/NRT column (a product or source style string column)
flag = None
for c, t in df.schema.items():
    if t == pl.Utf8 and c not in ("acq_date", "region", "family", "daynight"):
        vals = [str(v).upper() for v in df[c].unique().to_list()]
        if any(("NRT" in v) or (v in ("SP", "URT")) or v.endswith("_SP") for v in vals):
            flag = c
            break
print("SP/NRT column:", flag)

if flag:
    d = df.with_columns(
        pl.col("acq_date").str.slice(0, 7).alias("month"),
        pl.when(pl.col(flag).str.to_uppercase().str.contains("NRT"))
          .then(pl.lit("NRT")).otherwise(pl.lit("SP")).alias("kind"),
    )
    pairs = (d.group_by("family", "month", "kind", "daynight")
               .agg(pl.len().alias("n_hotspots"))
               .pivot(on="kind", index=["family", "month", "daynight"], values="n_hotspots")
               .sort("family", "month", "daynight"))
    print(pairs)
    # keep only rows where both exist
    both = pairs.drop_nulls(subset=[c for c in ("NRT", "SP") if c in pairs.columns])
    print("overlap rows:", both.height)
    pairs.write_parquet("data/processed/nrt_sp_pairs.parquet")
    both.write_csv("data/processed/nrt_sp_pairs_overlap.csv")