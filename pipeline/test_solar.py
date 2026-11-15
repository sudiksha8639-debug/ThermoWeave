import polars as pl
from solar import add_local_time


def run(t, lon, d="2026-10-20"):
    df = pl.DataFrame({"acq_date": [d], "acq_time": [t], "longitude": [lon]})
    r = add_local_time(df).row(0, named=True)
    return str(r["local_date"]), round(r["lst"], 3)


assert run("2350", 75.0) == ("2026-10-21", 4.833)      # 23:50 UTC at +75 E: next local day
assert run("0010", -75.0) == ("2026-10-19", 19.167)    # 00:10 UTC at -75 W: previous local day
assert run("1300", 179.9) == ("2026-10-21", 0.993)     # antimeridian, east side
assert run("1200", 179.9) == ("2026-10-20", 23.993)    # same day, just before midnight
assert run("2350", -179.9) == ("2026-10-20", 11.84)    # antimeridian, west side
print("solar tests passed")