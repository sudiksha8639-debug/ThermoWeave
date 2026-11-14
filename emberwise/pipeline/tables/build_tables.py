"""Build M3's tables from the hand-offs.  Usage: python -m pipeline.tables.build_tables"""
from . import build

if __name__ == "__main__":
    s = build.build()
    print(f"built tables: as of {s['as_of']}, {s['tiles']} tiles, {s['zones']} zones, "
          f"{s['months']} months, mock={s['mock']}; checks run: {', '.join(s['checks_run']) or 'none'}")
