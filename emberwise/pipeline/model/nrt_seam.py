"""NRT seam: same satellite, near-real-time against standard processing, in months where both exist (plan s6, s7)."""
from __future__ import annotations

from pathlib import Path

import polars as pl

from . import settings as S


def from_pairs(pairs: pl.DataFrame) -> dict:
    """Percent shift per satellite from M1's pairs table.

    Expects columns family (satellite), month, daynight and the counts SP and NRT. Only day passes and only
    months where both counts exist are compared.
    """
    need = {"family", "month", "SP", "NRT"}
    if not need <= set(pairs.columns):
        return {"tested": False, "reason": f"pairs file lacks columns: {sorted(need - set(pairs.columns))}"}
    d = pairs.drop_nulls(subset=["SP", "NRT"])
    if "daynight" in d.columns:
        d = d.filter(pl.col("daynight") == "D")
    if d.height == 0:
        return {"tested": False, "reason": "no month has both standard and near-real-time data for the same satellite"}
    rows = []
    for (fam,), g in d.group_by("family", maintain_order=True):
        sp, nrt = int(g["SP"].sum()), int(g["NRT"].sum())
        shift = round(100 * (nrt - sp) / sp, 1) if sp else None
        rows.append({"satellite": fam, "months": sorted(g["month"].unique().to_list()), "sp": sp, "nrt": nrt, "pct_shift": shift,
                     "factor_needed": shift is not None and abs(shift) > S.NRT_SHIFT_LIMIT_PCT})
    return {"tested": True, "unit": "day-pass hotspots", "limit_pct": S.NRT_SHIFT_LIMIT_PCT, "satellites": rows}


def from_tile_day(td: pl.DataFrame) -> dict:
    """tile_day keeps one product per day, so it can only tell us whether any month carries both products."""
    k = (td.with_columns(pl.col("date").dt.strftime("%Y-%m").alias("ym")).group_by("sensor_set", "ym")
         .agg(pl.col("product").n_unique().alias("k")).filter(pl.col("k") > 1))
    first = td.filter(pl.col("product") == "NRT").group_by("sensor_set").agg(pl.col("date").min().alias("d")).sort("sensor_set")
    return {"tested": False, "months_with_both_products": k.height,
            "nrt_starts": {s: d.isoformat() for s, d in first.iter_rows()},
            "reason": "tile_day.parquet holds one product per day; the comparison needs M1's nrt_sp_pairs.parquet"}


def run(td: pl.DataFrame, processed_dir: Path | None = None) -> dict:
    """Use M1's pairs file when it is there; otherwise say the seam is untested and why."""
    path = Path(processed_dir or S.PROCESSED_DIR) / "nrt_sp_pairs.parquet"
    if path.exists():
        res = from_pairs(pl.read_parquet(path))
        if res["tested"]:
            return res
        return {**from_tile_day(td), "reason": res["reason"]}
    return from_tile_day(td)
