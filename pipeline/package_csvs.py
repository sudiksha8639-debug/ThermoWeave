"""Packages the hotspot CSVs the way M4 asked and copies them into mock-data/.
Run from the repo root:  python pipeline/package_csvs.py
Reads data/processed/web/hotspots/<preset>_<year>.csv (also accepts hotspots_<preset>_<year>.csv).
Writes mock-data/hotspots_<preset_id>_<year>.csv for indian_punjab and haryana only (punjab_haryana is skipped:
M4 joins it in the browser), header with day_night, newest years first until the 60 MB budget is met."""
import glob
import os
import re
import shutil

SRC = "data/processed/web/hotspots"
DST = "mock-data"
PRESET_MAP = {"punjab": "indian_punjab", "indian_punjab": "indian_punjab", "haryana": "haryana"}
FIRST, LAST = 2019, 2026
BUDGET = 60 * 1024 * 1024
MAX_FILE = 20 * 1024 * 1024
EXPECT = ["satellite", "date", "time_utc", "local_solar_time", "lat", "lon", "frp", "confidence", "day_night", "product"]

found = {}   # (preset_id, year) -> source path
for p in glob.glob(os.path.join(SRC, "*.csv")):
    m = re.match(r"^(?:hotspots_)?([a-z_]+?)_(\d{4})\.csv$", os.path.basename(p))
    if not m or m.group(1) not in PRESET_MAP:
        print("skipping", os.path.basename(p))
        continue
    found[(PRESET_MAP[m.group(1)], int(m.group(2)))] = p
if not found:
    raise SystemExit("No CSVs found in " + SRC)

years = [y for y in range(FIRST, LAST + 1) if any(k[1] == y for k in found)]


def total(ys):
    return sum(os.path.getsize(p) for (pid, y), p in found.items() if y in ys)


while total(years) > BUDGET and len(years) > 1:
    print(f"{years[0]}-{years[-1]} is {total(years)/2**20:.1f} MB, over budget: dropping {years[0]}")
    years.pop(0)

os.makedirs(DST, exist_ok=True)
for old in glob.glob(os.path.join(DST, "hotspots_*.csv")):   # remove skeleton and stale files
    os.remove(old)
    print("removed old", os.path.basename(old))

sizes = {}
for (pid, y), p in sorted(found.items()):
    if y not in years:
        continue
    out = os.path.join(DST, f"hotspots_{pid}_{y}.csv")
    with open(p, encoding="utf-8", newline="") as fi, open(out, "w", encoding="utf-8", newline="") as fo:
        cols = ["day_night" if c == "daynight" else c for c in fi.readline().rstrip("\r\n").split(",")]
        if cols != EXPECT:
            raise SystemExit(f"Unexpected header in {p}:\n  got      {cols}\n  expected {EXPECT}")
        fo.write(",".join(cols) + "\n")
        shutil.copyfileobj(fi, fo)
    sizes[(pid, y)] = os.path.getsize(out)

tot = sum(sizes.values())
print("\nYears shipped:", years[0], "to", years[-1])
for pid in sorted({k[0] for k in sizes}):
    print(f"  {pid}: {sum(v for k, v in sizes.items() if k[0] == pid)/2**20:.1f} MB")
big = max(sizes, key=sizes.get)
print(f"TOTAL {tot/2**20:.1f} MB | largest file hotspots_{big[0]}_{big[1]}.csv {sizes[big]/2**20:.1f} MB")
if tot > BUDGET or sizes[big] > MAX_FILE:
    print("WARNING: still over budget (60 MB total or 20 MB per file). Tell M4.")