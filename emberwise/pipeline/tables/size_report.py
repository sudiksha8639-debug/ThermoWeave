"""Print MB per shipped file against the 8 MB budget (plan s5). Exits 1 if the precache set is over.

Usage: python -m pipeline.tables.size_report [web_data_dir]
  precache set = the files the service worker caches (core files + last five tile_month years);
  all files    = every JSON file including all tile_month years.
Hotspot CSV files are lazy and budgeted separately, so they are listed but not counted.
"""
import gzip
import sys
from pathlib import Path

from . import config as C
from .build import precache_list

MB = 1024 * 1024


def main(argv: list[str]) -> int:
    data_dir = Path(argv[1]) if len(argv) > 1 else C.DATA_DIR
    files = sorted(data_dir.glob("*.json"))
    years = sorted(int(p.stem[-4:]) for p in files if p.name.startswith("tile_month_"))
    pre = set(precache_list(years))
    rows = [(p.name, p.stat().st_size, len(gzip.compress(p.read_bytes(), 6))) for p in files]
    print(f"{'file':26s} {'MB':>7s} {'gzip':>7s}  precache")
    for name, raw, gz in rows:
        print(f"{name:26s} {raw / MB:7.3f} {gz / MB:7.3f}  {'yes' if name in pre else ''}")
    csv = sum(p.stat().st_size for p in (data_dir / "hotspots").glob("*.csv"))
    pre_mb = sum(r for n, r, _ in rows if n in pre) / MB
    all_mb, gz_mb = sum(r for _, r, _ in rows) / MB, sum(g for _, _, g in rows) / MB
    budget = C.SIZE_BUDGET_MB
    print("-" * 52)
    print(f"{'precache set':26s} {pre_mb:7.3f}          {'OK' if pre_mb <= budget else 'OVER'} (budget {budget:.0f} MB)")
    print(f"{'all files, all years':26s} {all_mb:7.3f} {gz_mb:7.3f}  {'OK' if all_mb <= budget else 'OVER'}")
    print(f"{'hotspot CSV (separate)':26s} {csv / MB:7.3f}")
    return 0 if pre_mb <= budget else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
