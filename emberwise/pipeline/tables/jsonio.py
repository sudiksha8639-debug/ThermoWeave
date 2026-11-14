"""JSON read/write with the project conventions (compact, no NaN, fixed envelope)."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import config as C


def envelope(mock: bool, generated_at: str | None = None) -> dict:
    """Fields every contract file starts with."""
    ts = generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"schema_version": C.SCHEMA_VERSION, "generated_at": ts, "mock": mock}


def qlist(a, decimals: int | None = None) -> list:
    """Array -> plain list. NaN becomes null (never zero); decimals=None means integers."""
    out = []
    for v in np.asarray(a, dtype=float).tolist():
        if v != v:
            out.append(None)
        elif decimals is None:
            out.append(int(round(v)))
        else:
            r = round(v, decimals)
            out.append(int(r) if r == int(r) else r)
    return out


def nan_array(values: list) -> np.ndarray:
    """JSON list with nulls -> float array with NaN."""
    return np.array([np.nan if v is None else v for v in values], dtype=float)


def write_json(path: Path, obj: dict) -> int:
    """Write compact JSON; return bytes written. NaN/Infinity raise an error."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"), allow_nan=False, ensure_ascii=False)
    path.write_text(text, encoding="utf-8", newline="\n")
    return len(text.encode("utf-8"))


def read_json(path: Path) -> dict:
    """Read a JSON file."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    """Hex SHA-256 of a file."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
