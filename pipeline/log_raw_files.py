"""Writes docs/RAW_FILES.csv (hash, rows, dates per raw FIRMS file) and
docs/ROW_AUDIT.csv (raw rows vs rows kept in hotspots_clean.parquet).
Run from the repo root:  python pipeline\\log_raw_files.py
Reads only; never edits raw files."""
import csv
import glob
import hashlib
import os
import re

BOX = "W73.5 S27.4 E78 N32.8"
REQUESTS = {
    "845475": ("NOAA-20 (J1) VIIRS C2", "2018-04-01 to 2026-11-05", BOX,
               "2026-11-13 18:10:37", "2026-11-13 18:11:14"),
    "845493": ("Suomi NPP VIIRS C2", "2012-01-20 to 2026-11-02", BOX,
               "2026-11-13 18:20:59", "2026-11-13 18:32:23"),
    "845498": ("MODIS C6.1 (Terra + Aqua)", "2000-11-01 to 2026-11-05", BOX,
               "2026-11-13 18:22:18", "2026-11-13 18:31:50"),
    "845518": ("NOAA-21 (J2) VIIRS C2", "2023-03-01 to 2026-11-05", BOX,
               "2026-11-13 18:31:51", "2026-11-13 18:41:05"),
    "846801": ("Suomi NPP VIIRS C2, control box", "2012-01-20 to 2025-12-31",
              "W76 S31 E79.5 N33.5", "2026-11-14 06:21:59",
              "status was 'Submitted' when the request list was captured"),
}

os.makedirs("docs", exist_ok=True)
raw_rows = []
audit = []

for f in sorted(glob.glob("data/raw/**/*.csv", recursive=True)):
    name = os.path.basename(f)
    m = re.search(r"_(\d+)\.csv$", name)
    req = m.group(1) if m else ""
    kind = "NRT" if name.startswith("fire_nrt") else "SP"
    sha = hashlib.sha256()
    with open(f, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            sha.update(chunk)
    rows, dmin, dmax = 0, None, None
    with open(f, newline="") as fh:
        for r in csv.DictReader(fh):
            if not r:
                continue
            rows += 1
            d = r["acq_date"]
            dmin = d if dmin is None or d < dmin else dmin
            dmax = d if dmax is None or d > dmax else dmax
    info = REQUESTS.get(req, ("", "", "", "", ""))
    raw_rows.append([name, req, info[0], kind, info[1], info[2], info[3], info[4],
                     rows, dmin, dmax, sha.hexdigest()])
    audit.append(["raw", name, rows])

with open("docs/RAW_FILES.csv", "w", newline="") as out:
    w = csv.writer(out)
    w.writerow(["file", "request_id", "source", "kind", "requested_window",
                "bbox", "request_time_as_shown_by_FIRMS", "processed_time",
                "rows", "first_acq_date", "last_acq_date", "sha256"])
    w.writerows(raw_rows)

try:
    import polars as pl
    df = pl.read_parquet("data/processed/hotspots_clean.parquet")
    df = df.with_columns(
        pl.when(pl.col("version").str.contains("NRT"))
          .then(pl.lit("NRT")).otherwise(pl.lit("SP")).alias("kind"))
    g = df.group_by("family", "region", "kind").len().sort("family", "region", "kind")
    for fam, reg, kind, n in g.iter_rows():
        audit.append(["clean", f"{fam}|{reg}|{kind}", n])
    audit.append(["clean", "TOTAL hotspots_clean.parquet", df.height])
except Exception as e:  # keep the raw log even if the parquet is missing
    audit.append(["clean", f"could not read hotspots_clean.parquet: {e}", ""])

with open("docs/ROW_AUDIT.csv", "w", newline="") as out:
    w = csv.writer(out)
    w.writerow(["stage", "key", "rows"])
    w.writerows(audit)

print("wrote docs/RAW_FILES.csv and docs/ROW_AUDIT.csv")