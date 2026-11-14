"""Validate every data file against the contract. Exits 1 and prints loudly on any problem.

Usage: python -m pipeline.tables.check_contract [web_data_dir] [processed_dir]
Fails on: missing file, extra file, missing field, extra field, wrong type, unequal column
lengths, a banned phrase, VIIRS values before VIIRS existed, an owner reviewing their own
check, or a manifest that does not match the files on disk.
"""
import sys
from pathlib import Path

from . import config as C
from .contracts import validate_tree


def main(argv: list[str]) -> int:
    data_dir = Path(argv[1]) if len(argv) > 1 else C.DATA_DIR
    processed = Path(argv[2]) if len(argv) > 2 else C.PROCESSED_DIR
    report = validate_tree(data_dir, processed)
    bad = {k: v for k, v in report.items() if v}
    for name in sorted(report):
        print(f"{'FAIL' if report[name] else 'ok  '}  {name}")
        for e in report[name]:
            print(f"        - {e}")
    if bad:
        print(f"\n*** CONTRACT CHECK FAILED: {len(bad)} of {len(report)} files (schema {C.SCHEMA_VERSION}) ***")
        return 1
    print(f"\nContract check passed: {len(report)} files, schema {C.SCHEMA_VERSION}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
