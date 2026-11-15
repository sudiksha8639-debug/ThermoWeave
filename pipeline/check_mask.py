"""Compares static-source mask settings. Run after ingest.py, from the repo root."""
import h3
import polars as pl

pl.Config.set_tbl_rows(40)
RES = 8
hot = pl.read_parquet("data/processed/hotspots_clean.parquet").filter(pl.col("region") == "pbhr")
static = pl.read_parquet("data/processed/static_sources.parquet").filter(pl.col("region") == "pbhr")


def add_h8(df):
    c = df.select(pl.col("latitude").cast(pl.Float64), pl.col("longitude").cast(pl.Float64)).unique()
    cells = [h3.latlng_to_cell(a, b, RES) for a, b in zip(c["latitude"].to_list(), c["longitude"].to_list())]
    return df.join(c.with_columns(pl.Series("h8", cells)), on=["latitude", "longitude"], how="left")


print("computing cells ...")
hot, static = add_h8(hot), add_h8(static)
counts = static.group_by("h8").len()
total = hot.group_by("product").len().rename({"len": "total"})
rows = []
for ring in (0, 1):
    for minc in (1, 3):
        cells = set()
        for c in counts.filter(pl.col("len") >= minc)["h8"].to_list():
            cells.update(h3.grid_disk(c, ring))
        removed = hot.filter(pl.col("h8").is_in(list(cells))).group_by("product").len().rename({"len": "removed"})
        r = total.join(removed, on="product", how="left").with_columns(pl.col("removed").fill_null(0))
        for d in r.sort("product").to_dicts():
            rows.append({"ring": ring, "min_count": minc, "cells": len(cells), "product": d["product"],
                         "rows_removed": d["removed"], "pct_removed": round(100 * d["removed"] / d["total"], 2)})
print(pl.DataFrame(rows))