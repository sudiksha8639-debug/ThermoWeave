import csv, glob, os
from collections import Counter

for f in sorted(glob.glob("data/raw/**/*.csv", recursive=True)):
    dates, types, rows = set(), Counter(), 0
    with open(f, newline="") as fh:
        for r in csv.DictReader(fh):
            dates.add(r["acq_date"])
            types[r.get("type", "none")] += 1
            rows += 1
    d = sorted(dates)
    print(os.path.basename(f), "rows", rows, "|", d[0], "to", d[-1], "| distinct days", len(d), "| types", dict(types))