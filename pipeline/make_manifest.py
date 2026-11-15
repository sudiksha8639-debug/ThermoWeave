"""Builds docs/manifest.json from docs/RAW_FILES.csv and docs/ROW_AUDIT.csv.
Run after log_raw_files.py, from the repo root:  python pipeline\\make_manifest.py"""
import csv
import json
from datetime import datetime, timezone


def read(path):
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh))


raw = read("docs/RAW_FILES.csv")
audit = read("docs/ROW_AUDIT.csv")

manifest = {
    "manifest_version": "1.0",
    "project": "EMBERWISE",
    "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "provider": "NASA FIRMS (Fire Information for Resource Management System), NASA EOSDIS / LANCE",
    "raw_files": [
        {
            "file": r["file"],
            "request_id": r["request_id"],
            "source": r["source"],
            "kind": r["kind"],
            "requested_window": r["requested_window"],
            "bbox": r["bbox"],
            "request_time_as_shown_by_firms": r["request_time_as_shown_by_FIRMS"],
            "rows": int(r["rows"]),
            "first_acq_date": r["first_acq_date"],
            "last_acq_date": r["last_acq_date"],
            "sha256": r["sha256"],
        }
        for r in raw
    ],
    "processing": {
        "cleaning": [
            "SP files: keep type 0 (presumed vegetation fire); NRT files have no type column",
            "VIIRS: keep nominal (n) and high (h) confidence; MODIS: confidence 30 or above",
            "drop exact duplicates",
            "static-source mask built from SP history and applied to all eras",
            "clip to Punjab and Haryana state polygons (centroid inside)",
        ],
        "local_solar_time": "local_hours = UTC hours + longitude/15; local_date = UTC date + floor(local_hours/24)",
        "tile": "H3 resolution 6 (sensitivity at 5 and 7), zone at resolution 3",
        "conversion_learning_window": "2012-2019",
    },
    "boundary_source": "Survey of India state boundaries (Punjab, Haryana); district file for Lahul and Spiti; terms in docs/DATA_SOURCES.md",
    "row_audit": [{"stage": a["stage"], "key": a["key"], "rows": a["rows"]} for a in audit],
    "ai_use_note": "AI assistants (Claude, by Anthropic) were used by team members for code assistance, debugging, checking analysis and drafting documentation; team members ran the code and are responsible for all outputs.",
}

with open("docs/manifest.json", "w") as out:
    json.dump(manifest, out, indent=2)

print("wrote docs/manifest.json with", len(manifest["raw_files"]), "raw files")