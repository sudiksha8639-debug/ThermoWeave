"""Reads M6's Survey of India boundary files (EPSG:7755, metres), reprojects to lat/lon (EPSG:4326) and writes
small files for the pipeline. Put the unzipped files in data/boundary_raw/, then run from the repo root:
    python pipeline/prepare_boundary.py
Needs: pip install pyproj shapely"""
import json
import os
import warnings

from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform

warnings.filterwarnings("ignore", category=DeprecationWarning)

RAW = "data/boundary_raw"
OUT = "data/boundary"
STATE_FILE = f"{RAW}/state_NWIC.GeoJSON"
DISTRICT_FILE = f"{RAW}/district_nwic.GeoJSON"
SIMPLIFY_DEG = 0.002   # about 200 m; tiles are 6 km, so this does not change which tiles are in scope
os.makedirs(OUT, exist_ok=True)

tr = Transformer.from_crs("EPSG:7755", "EPSG:4326", always_xy=True)


def to_latlon(geom):
    return transform(tr.transform, geom)


def write(path, feats):
    json.dump({"type": "FeatureCollection", "features": feats}, open(path, "w", encoding="utf-8"))
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


gj = json.load(open(STATE_FILE, encoding="utf-8"))
feats = []
for ft in gj["features"]:
    name = ft["properties"]["state_name"]
    if name in ("Punjab", "Haryana"):
        g = to_latlon(shape(ft["geometry"])).simplify(SIMPLIFY_DEG, preserve_topology=True)
        print(name, "bounds (W,S,E,N):", [round(x, 2) for x in g.bounds])
        feats.append({"type": "Feature", "properties": {"state_name": name, "source": "Survey of India (SOI) state boundary"},
                      "geometry": mapping(g)})
assert len(feats) == 2, "expected Punjab and Haryana"
write(f"{OUT}/india_adm1.geojson", feats)
del gj

dj = json.load(open(DISTRICT_FILE, encoding="utf-8"))
ctl = []
for ft in dj["features"]:
    if ft["properties"]["district"].strip().lower() in ("lahul and spiti", "lahaul and spiti", "lahul & spiti"):
        g = to_latlon(shape(ft["geometry"])).simplify(SIMPLIFY_DEG, preserve_topology=True)
        print("control district bounds (W,S,E,N):", [round(x, 2) for x in g.bounds])
        ctl.append({"type": "Feature", "properties": {"district": ft["properties"]["district"], "state_name": ft["properties"]["state_name"],
                    "source": "Survey of India (SOI) district boundary"}, "geometry": mapping(g)})
assert len(ctl) == 1, "Lahul and Spiti not found"
write(f"{OUT}/control_district.geojson", ctl)
print("done")