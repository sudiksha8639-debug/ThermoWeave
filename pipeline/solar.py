import polars as pl


def add_local_time(df: pl.DataFrame) -> pl.DataFrame:
    """Adds utc_date, local_date and lst (local solar time, hours 0 to 24).
    Needs acq_date (YYYY-MM-DD text), acq_time (HHMM text) and longitude (float)."""
    t = pl.col("acq_time").str.zfill(4)
    utc_hours = t.str.slice(0, 2).cast(pl.Float64) + t.str.slice(2, 2).cast(pl.Float64) / 60.0
    local_hours = utc_hours + pl.col("longitude") / 15.0
    shift = (local_hours / 24.0).floor().cast(pl.Int32)
    return (
        df.with_columns(
            pl.col("acq_date").str.to_date("%Y-%m-%d").alias("utc_date"),
            local_hours.alias("_lh"),
            shift.alias("_shift"),
        )
        .with_columns(
            (pl.col("utc_date") + pl.duration(days=pl.col("_shift"))).alias("local_date"),
            (pl.col("_lh") - pl.col("_shift") * 24).alias("lst"),
        )
        .drop("_lh", "_shift")
    )