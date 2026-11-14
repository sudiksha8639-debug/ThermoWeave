import csv, glob, os
from datetime import date, timedelta

def d(s):
    y, m, dd = map(int, s.split("-"))
    return date(y, m, dd)

for f in sorted(glob.glob("data/raw/**/*.csv", recursive=True)):
    days = set()
    with open(f, newline="") as fh:
        for r in csv.DictReader(fh):
            days.add(r["acq_date"])
    a, b = d(min(days)), d(max(days))
    missing, x = [], a
    while x <= b:
        if x.isoformat() not in days:
            missing.append(x)
        x += timedelta(days=1)
    season = [m for m in missing if m.month <= 11 and (m.month, m.day) >= (9, 15)]
    name = os.path.basename(f)
    print("==", name, "| span days", (b - a).days + 1, "| no-row days", len(missing), "| no-row days Sep15-Nov30:", len(season))
    if name.startswith("fire_nrt") or len(season) <= 40:
        print("   ", [m.isoformat() for m in season])