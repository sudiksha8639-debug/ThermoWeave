"""Update the size and hash of files listed in manifest.json after hourly.json and drift.json are replaced.

Nothing else in the manifest is touched. Run: python -m pipeline.model.refresh_manifest
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from . import settings as S


def refresh(data_dir: Path | None = None) -> list[str]:
    """Recompute bytes and sha256 for every listed file that exists; return the paths that changed."""
    data_dir = Path(data_dir or S.WEB_DATA_DIR)
    path = data_dir / "manifest.json"
    text = path.read_text(encoding="utf-8")
    manifest = json.loads(text)
    changed = []
    for entry in manifest.get("files", []):
        f = data_dir / entry.get("path", "")
        if not (isinstance(entry, dict) and "sha256" in entry and f.is_file()):
            continue
        raw = f.read_bytes()
        new = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        if any(entry.get(k) != v for k, v in new.items() if k in entry):
            entry.update({k: v for k, v in new.items() if k in entry})
            changed.append(entry["path"])
    if changed:
        compact = "\n" not in text.strip()
        out = json.dumps(manifest, separators=(",", ":")) if compact else json.dumps(manifest, indent=1)
        path.write_text(out + ("\n" if text.endswith("\n") else ""), encoding="utf-8", newline="\n")
    return changed


if __name__ == "__main__":
    print("manifest entries updated:", refresh() or "none")
