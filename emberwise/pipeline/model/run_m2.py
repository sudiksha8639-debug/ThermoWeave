"""Run every model check and write docs/M2_RESULTS.json. Run: python -m pipeline.model.run_m2"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import polars as pl

from . import nrt_seam, relay, saturation
from . import settings as S


def run(processed_dir: Path | None = None, web_dir: Path | None = None) -> dict:
    """Load M1's hand-off and the Clock Ledger, run the checks, return the results."""
    processed_dir, web_dir = Path(processed_dir or S.PROCESSED_DIR), Path(web_dir or S.WEB_DATA_DIR)
    td = pl.read_parquet(processed_dir / "tile_day.parquet")
    tiles = pl.read_parquet(processed_dir / "tiles.parquet")
    drift = json.loads((web_dir / "drift.json").read_text(encoding="utf-8"))
    return {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "clock_ledger_is_mock": bool(drift.get("mock")),
            "relay": relay.run(td, drift), "saturation": saturation.run(td, tiles),
            "nrt_seam": nrt_seam.run(td, processed_dir)}


def main() -> None:
    res = run()
    out = S.DOCS_DIR / "M2_RESULTS.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=1, default=str) + "\n", encoding="utf-8", newline="\n")
    c = res["relay"]["chosen"]
    print(f"relay: {c['satellite']} ({'provisional' if c['provisional'] else 'final'}) - {c['reason']}")
    for t in res["relay"]["sensor_loss_tests"]:
        print(f"  season {t['season']}: {t['pct_diff']:+.1f}% vs Suomi NPP, daily rho {t['daily_rho_deseasonalized']}")
    print("nrt seam tested:", res["nrt_seam"]["tested"])
    print("wrote", out)


if __name__ == "__main__":
    main()
