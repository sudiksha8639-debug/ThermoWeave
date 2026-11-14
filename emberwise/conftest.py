"""Test setup: build a private MOCK data tree in a temp folder and point the config at it.

Tests never read or write web/public/data or data/processed, so they give the same result
whether those hold mocks or M1's real hand-off.
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline.tables import config as C  # noqa: E402

_TMP = Path(tempfile.mkdtemp(prefix="emberwise_tests_"))
C.DATA_DIR = _TMP / "web" / "public" / "data"
C.CSV_DIR = C.DATA_DIR / "hotspots"
C.MOCK_PROCESSED_DIR = C.PROCESSED_DIR = _TMP / "data" / "processed"
C.EXTERNAL_FILE = _TMP / "data" / "external" / "external_series.csv"

from pipeline.tables import build, mocks  # noqa: E402  (imported after the paths are patched)

mocks.generate(data_dir=C.DATA_DIR, processed_dir=C.PROCESSED_DIR)
build.build(data_dir=C.DATA_DIR, processed_dir=C.PROCESSED_DIR)
