"""Regenerate docs/schema.md from contracts.py (never edit schema.md by hand).

Usage: python -m pipeline.tables.gen_schema_md
"""
from . import config as C
from .contracts import CONTRACTS, PARQUET

HEADER = f"""# EMBERWISE data contract (schema_version {C.SCHEMA_VERSION})

Generated from `pipeline/tables/contracts.py`. Do not edit by hand.
Owner: M3. Deputy: M6 (additive changes only). Protocol: `CHANGELOG.md`.
Source: Build Plan v4, Section 5.

## Rules that apply to every file

- Every JSON file starts with `schema_version`, `generated_at`, `mock`. `mock: true` data is synthetic and must never be quoted as real.
- Every object is closed: a missing field or an extra field fails `check_contract`.
- **Missing data is a gap (`null`), never `0`.** Empty or failed files show up in `coverage`.
- **Never add MODIS and VIIRS.** One source of truth per day: VIIRS where it has data, otherwise MODIS x conversion ratio.
- Every number has a label: {", ".join(C.LABELS)}. Era A = Indicative, era B = Estimated, eras C and D = Measured; any month using NRT is Provisional.
- The headline value (`harm`) is relative burning activity at VIIRS scale. It is not fire size, burned area or total fires.
- The range is "{C.RANGE_NOTE}"
- Banned wording lives in `config.BANNED_PHRASES`; the checker scans every file for it.
- Columnar layout: an object named `columns` holds equal-length arrays; row i is element i of each array.
- Indexes: `tile` -> `tile_geometry.tiles`; `ym` -> `manifest.months`; day or `date` -> days since `{C.EPOCH}` (local solar date); `region` -> `manifest.presets`; label code -> `label_codes`.
- Safety line for every screen: "{C.SAFETY_DISCLAIMER}"
"""


def type_of(s: dict) -> str:
    """Short type string for a schema node."""
    if "const" in s:
        return f'const "{s["const"]}"'
    t = s.get("type", "")
    if t == "array":
        n = f" x{s['minItems']}" if s.get("minItems") and s.get("minItems") == s.get("maxItems") else ""
        return f"array[{type_of(s.get('items', {}))}]{n}"
    t = " | ".join(t) if isinstance(t, list) else t
    if "enum" in s:
        return t + " (" + ", ".join(str(e) for e in s["enum"] if e is not None) + ")"
    return t


def rows(s: dict, prefix: str = "") -> list[tuple[str, str, str]]:
    """Flatten a schema into (path, type, description) rows."""
    out = []
    for name, sub in s.get("properties", {}).items():
        path = f"{prefix}{name}"
        out.append((path, type_of(sub), sub.get("description", "")))
        if "properties" in sub:
            out += rows(sub, path + ".")
        elif sub.get("type") == "array" and "properties" in sub.get("items", {}):
            out += rows(sub["items"], path + "[].")
    return out


def main() -> None:
    parts = [HEADER, "## Web files (`web/public/data/`)\n"]
    first = f"presets.{C.PRESET_IDS[0]}"
    for name, (schema, pattern) in CONTRACTS.items():
        parts.append(f"### {name}: `{pattern}`\n\n{schema.get('description', '')}\n")
        parts.append("| field | type | meaning |\n|---|---|---|")
        for path, typ, desc in rows(schema):
            if path.startswith("presets.") and not (path == first or path.startswith(first + ".") or path.startswith(first + "[")):
                continue                                   # show one preset, not three copies
            parts.append(f"| `{path.replace(first, 'presets.<preset>', 1)}` | {typ} | {desc} |")
        parts.append("")
    parts.append("### hotspots_csv: `hotspots/hotspots_<preset>_<year>.csv`\n\n"
                 "M1 -> M4. Fetched only on download click; budgeted separately. Header:\n\n"
                 f"`{','.join(C.HOTSPOT_COLUMNS)}`\n")
    parts.append("## Pipeline hand-offs (repo-root `data/processed/`, git-ignored)\n")
    for name, (fname, cols, desc) in PARQUET.items():
        parts.append(f"### {name}: `{fname}`\n\n{desc}\n\n| column | kind |\n|---|---|")
        parts += [f"| `{c}` | {k} |" for c, k in cols.items()]
        parts.append("")
    parts.append(f"`sensor_set` values: {', '.join(C.SENSOR_SETS)}. `product` values: {', '.join(C.PRODUCTS)}.\n")
    C.DOCS_DIR.mkdir(exist_ok=True)
    (C.DOCS_DIR / "schema.md").write_text("\n".join(parts), encoding="utf-8", newline="\n")
    print(f"wrote {C.DOCS_DIR / 'schema.md'}")


if __name__ == "__main__":
    main()
