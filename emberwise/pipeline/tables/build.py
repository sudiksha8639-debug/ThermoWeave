"""Build M3's tables from the hand-offs (plan s5): the same code runs on mocks and on real data.

Inputs : data/processed/tiles.parquet, data/processed/tile_day.parquet (M1),
         web/public/data/{regions,coverage,conversion}.json (M6/M1, M1, M2).
Outputs: tile_month_YYYY.json, region_daily.json, climatology.json, periods.json,
         narratives.json, tile_geometry.json, manifest.json in web/public/data.

Rules enforced here: one source of truth per day (VIIRS where it has data,
otherwise MODIS x conversion ratio); MODIS and VIIRS are never added for the
same day; a gap is null, never zero; every value carries a label.
"""
from __future__ import annotations

from pathlib import Path

import h3
import numpy as np
import polars as pl

from . import analytics as A
from . import config as C
from .contracts import CONTRACTS
from .harmonize import convert_modis, harmonize, support_factor, trust_score
from .jsonio import envelope, nan_array, qlist, read_json, sha256, write_json
from .timeutil import day_index, days_in_month, era_of, index_day, month_list, parse, ym_index

AI_USE_NOTE = ("AI tools were used to help write code, documentation and planning for this project. "
               "Every number shown comes from the pipeline code, not from an AI model.")

# -------------------------------------------------------------------- inputs

def load_inputs(data_dir: Path, processed_dir: Path) -> dict:
    """Read the hand-off files and index tiles and zones."""
    tiles = (pl.read_parquet(processed_dir / "tiles.parquet")
             .filter(pl.col("region").is_in(C.BASE_REGIONS)).sort("h3_r6").with_row_index("tile"))
    td = pl.read_parquet(processed_dir / "tile_day.parquet")
    zones = sorted(tiles["zone_r3"].unique().to_list())
    regions = read_json(data_dir / "regions.json")
    return {"tiles": tiles, "td": td, "zones": zones, "regions": regions,
            "coverage": read_json(data_dir / "coverage.json"),
            "conversion": read_json(data_dir / "conversion.json"),
            "zone_of_tile": np.array([zones.index(z) for z in tiles["zone_r3"].to_list()]),
            "region_of_tile": np.array([C.BASE_REGIONS.index(r) for r in tiles["region"].to_list()]),
            "as_of": td["date"].max().isoformat(), "mock": bool(regions["mock"]),
            "generated_at": regions["generated_at"] if regions["mock"] else None}


def day_flags(coverage: dict, n_days: int) -> dict:
    """Per-day source of truth from coverage runs.

    vday: VIIRS (Suomi NPP, then the relay satellite) has data -> use VIIRS.
    mday: no VIIRS but MODIS has data -> use MODIS x ratio.  nrt: the source used is NRT.
    """
    c = coverage["columns"]
    has = {s: np.zeros(n_days, bool) for s in coverage["sensor_sets"]}
    nrt = {s: np.zeros(n_days, bool) for s in coverage["sensor_sets"]}
    for s, p, a, b, ok in zip(c["sensor_set"], c["product"], c["start"], c["end"], c["has_data"]):
        name = coverage["sensor_sets"][s]
        if ok:
            has[name][a:b + 1] = True
            nrt[name][a:b + 1] = coverage["products"][p] == "NRT"
    relay = np.arange(n_days) > day_index(C.SNPP_END)
    vday = np.where(relay, has[C.RELAY_SET], has[C.SNPP_SET])
    modis = has[C.MODIS_SET]
    mday = modis & ~vday
    used_nrt = np.where(vday, np.where(relay, nrt[C.RELAY_SET], nrt[C.SNPP_SET]), nrt[C.MODIS_SET] & mday)
    return {"vday": vday, "mday": mday, "modis": modis, "nrt": used_nrt, "relay": relay}


def ratio_tables(conv: dict, zones: list[str]) -> dict:
    """conversion.json -> {era: {field: array[zone, 12]}} in OUR zone order; missing -> NaN."""
    c = conv["columns"]
    fields = ("ratio", "widened_lo", "widened_hi", "n_support")
    tab = {e: {k: np.full((len(zones), 12), np.nan) for k in fields} for e in ("A", "B")}
    zi = {z: i for i, z in enumerate(zones)}
    for i, z in enumerate(c["zone"]):
        zid = conv["zones"][z]
        if zid in zi:
            for k in fields:
                v = c[k][i]
                tab[c["era"][i]][k][zi[zid], c["month"][i] - 1] = np.nan if v is None else v
    return tab

# ---------------------------------------------------------------- aggregation

def aggregate(inp: dict, flags: dict, n_days: int, n_months: int) -> dict:
    """Sum tile-days and hotspots into (tile x month) and (day x region x zone) arrays.

    'v' = VIIRS on VIIRS days; 'm_est' = MODIS on MODIS-only days; 'm_all' = MODIS on every day.
    The v and m_est parts never share a day, so their sum is a splice, not an addition of sensors.
    """
    td = (inp["td"].filter(pl.col("region").is_in(C.BASE_REGIONS))
          .join(inp["tiles"].select("tile", "h3_r6"), on="h3_r6", how="inner"))
    t = td["tile"].to_numpy().astype(int)
    d = (td["date"] - parse(C.EPOCH)).dt.total_days().to_numpy().astype(int)
    s = td["sensor_set"].cast(pl.String).to_numpy()
    n, h = td["n_tile_day"].to_numpy().astype(float), td["n_hotspots"].to_numpy().astype(float)
    src = np.where(flags["relay"], C.RELAY_SET, C.SNPP_SET)
    is_v = (s == src[d]) & flags["vday"][d]
    is_m = s == C.MODIS_SET
    is_me = is_m & flags["mday"][d]
    ym = np.array([ym_index(index_day(i)) for i in range(n_days)])[d]
    nt, nz = len(inp["tiles"]), len(inp["zones"])
    rz = inp["region_of_tile"][t] * nz + inp["zone_of_tile"][t]
    out = {}
    for key, sel in (("v", is_v), ("m_est", is_me), ("m_all", is_m)):
        for unit, w in (("td", n), ("hs", h)):
            month = np.zeros((nt, n_months))
            np.add.at(month, (t[sel], ym[sel]), w[sel])
            daily = np.zeros((n_days, len(C.BASE_REGIONS) * nz))
            np.add.at(daily, (d[sel], rz[sel]), w[sel])
            out[f"{key}_{unit}_month"] = month
            out[f"{key}_{unit}_day"] = daily.reshape(n_days, len(C.BASE_REGIONS), nz)
    return out

# ---------------------------------------------------------------- tile_month

def month_label(ym: str, flags: dict, as_of: str) -> str:
    """Provisional if any NRT day; Measured if every day with data is a VIIRS day; else the era label."""
    a = day_index(ym + "-01")
    days = slice(a, a + days_in_month(ym, as_of))
    if flags["nrt"][days].any():
        return "Provisional"
    if flags["vday"][days].any() and not flags["mday"][days].any():
        return "Measured"
    return "Indicative" if era_of(ym) == "A" else "Estimated"


def tile_month_file(year: int, agg: dict, inp: dict, flags: dict, tab: dict, months: list[str]) -> dict:
    """tile_month_YYYY.json: sparse rows in month blocks with value, range, trust."""
    names = ("tile", "raw_hotspots", "raw_tile_days", "raw_modis", "raw_viirs", "harm", "lo", "hi",
             "trust", "frac_burning")
    cols = {k: [] for k in names}
    blocks = {"ym": [], "label": [], "start": [0]}
    z = inp["zone_of_tile"]
    for j, ym in enumerate(months):
        if int(ym[:4]) != year:
            continue
        era, cm, dim = ("A" if era_of(ym) == "A" else "B"), int(ym[5:7]) - 1, days_in_month(ym, inp["as_of"])
        a = day_index(ym + "-01")
        v, me, ma = agg["v_td_month"][:, j], agg["m_est_td_month"][:, j], agg["m_all_td_month"][:, j]
        harm, lo, hi = harmonize(v, me, tab[era]["ratio"][z, cm], tab[era]["widened_lo"][z, cm],
                                 tab[era]["widened_hi"][z, cm], dim)
        estimated = me > 0
        trust = trust_score(harm, lo, hi,
                            np.where(estimated, support_factor(tab[era]["n_support"][z, cm]), 1.0),
                            np.where(estimated, C.ERA_TRUST_FACTOR[era], 1.0))
        keep = (ma > 0) | (v > 0)
        none = np.full(int(keep.sum()), np.nan)
        blocks["ym"].append(j)
        blocks["label"].append(C.LABELS.index(month_label(ym, flags, inp["as_of"])))
        blocks["start"].append(blocks["start"][-1] + int(keep.sum()))
        cols["tile"] += np.flatnonzero(keep).tolist()
        cols["raw_hotspots"] += qlist((agg["v_hs_month"][:, j] + agg["m_est_hs_month"][:, j])[keep])
        cols["raw_tile_days"] += qlist((v + me)[keep])
        cols["raw_modis"] += qlist(ma[keep] if flags["modis"][a:a + dim].any() else none)
        cols["raw_viirs"] += qlist(v[keep] if flags["vday"][a:a + dim].any() else none)
        cols["harm"] += qlist(harm[keep], C.Q_VALUE)
        cols["lo"] += qlist(lo[keep], C.Q_VALUE)
        cols["hi"] += qlist(hi[keep], C.Q_VALUE)
        cols["trust"] += qlist(trust[keep])
        cols["frac_burning"] += qlist(harm[keep] / dim, C.Q_FRAC_TILE)
    return {"year": year, "label_codes": C.LABELS, "blocks": blocks, "columns": cols}

# -------------------------------------------------------------- region_daily

def day_ratios(tab: dict, cal: dict, n_zones: int) -> dict:
    """{field: array[day, zone]} of the ratio that applies to each day (era A before Jul 2002, else B)."""
    era_a = np.array([era_of(d) == "A" for d in cal["date"]])
    out = {}
    for k in ("ratio", "widened_lo", "widened_hi"):
        r = np.empty((len(era_a), n_zones))
        for era, sel in (("A", era_a), ("B", ~era_a)):
            r[sel] = tab[era][k][:, cal["month"][sel] - 1].T
        out[k] = r
    return out


def day_labels(flags: dict, cal: dict) -> list[str]:
    """Label per day: Provisional (NRT) > Measured (VIIRS day) > Estimated/Indicative (MODIS day)."""
    out = []
    for i, d in enumerate(cal["date"]):
        era = era_of(d)
        if flags["nrt"][i]:
            out.append("Provisional")
        elif flags["vday"][i]:
            out.append("Measured")
        elif flags["mday"][i]:
            out.append("Indicative" if era == "A" else "Estimated")
        else:
            out.append(C.ERA_LABEL[era])
    return out


def region_daily(agg: dict, inp: dict, flags: dict, tab: dict, cal: dict) -> dict:
    """region_daily.json for the three presets."""
    n = len(cal["date"])
    ratios = day_ratios(tab, cal, len(inp["zones"]))
    labels = day_labels(flags, cal)
    gap = lambda x, ok: np.where(ok, x, np.nan)          # noqa: E731  a gap is null, never zero
    presets = {}
    for p in C.PRESETS:
        parts = [C.BASE_REGIONS.index(r) for r in p["parts"]]
        count = int(np.isin(inp["region_of_tile"], parts).sum())
        pick = lambda key: agg[key][:, parts].sum(axis=1)   # noqa: E731  -> [day, zone]
        v, m = pick("v_td_day").sum(axis=1), pick("m_all_td_day")
        est = {k: convert_modis(m, r).sum(axis=1) for k, r in ratios.items()}
        series = {}
        for out, k in (("harm", "ratio"), ("lo", "widened_lo"), ("hi", "widened_hi")):
            x = np.where(flags["vday"], v, np.where(flags["mday"], np.minimum(est[k], count), np.nan))
            series[out] = x
        presets[p["id"]] = {
            "tile_count": count,
            "modis_td": qlist(gap(m.sum(axis=1), flags["modis"])),
            "viirs_td": qlist(gap(v, flags["vday"])),
            "modis_hotspots": qlist(gap(pick("m_all_hs_day").sum(axis=1), flags["modis"])),
            "viirs_hotspots": qlist(gap(pick("v_hs_day").sum(axis=1), flags["vday"])),
            "harm": qlist(series["harm"], C.Q_VALUE), "lo": qlist(series["lo"], C.Q_VALUE),
            "hi": qlist(series["hi"], C.Q_VALUE),
            "frac_burning": qlist(series["harm"] / count, C.Q_FRAC),
            "pct_rank": qlist(A.pct_rank(series["harm"], cal["doy"]), 1),
            "label": [C.LABELS.index(x) for x in labels],
        }
    return {"epoch": C.EPOCH, "n_days": n, "label_codes": C.LABELS, "presets": presets}

# --------------------------------------------------------- derived chart files

def climatology(rd: dict, cal: dict) -> tuple[dict, dict]:
    """climatology.json plus the weekly matrices (kept for Local Normal)."""
    presets, mats = {}, {}
    for pid in C.PRESET_IDS:
        presets[pid] = {}
        for s in ("modis", "viirs"):
            mat, _ = A.weekly_matrix(nan_array(rd["presets"][pid][f"{s}_td"]), cal)
            pc = A.weekly_percentiles(mat)
            mats[pid, s] = (mat, pc)
            presets[pid][s] = {**{k: qlist(x, C.Q_VALUE) for k, x in pc.items() if k != "n_years"},
                               "n_years": pc["n_years"]}
    return ({"weeks": C.CLIM_WEEKS, "window_weeks": C.CLIM_WINDOW_WEEKS,
             "unit": "tile-days per week, per sensor, never combined", "presets": presets}, mats)


def periods(rd: dict, cal: dict) -> dict:
    """periods.json: critical periods per preset."""
    out = {}
    for p in C.PRESETS:
        s = rd["presets"][p["id"]]
        out[p["id"]] = A.critical_periods(nan_array(s["harm"]), nan_array(s["lo"]), s["tile_count"], cal,
                                          [C.LABELS[i] for i in s["label"]], p["sentence"])
    return {"method": {"roll_days": C.PERIOD_ROLL_DAYS, "percentile": C.PERIOD_PERCENTILE,
                       "doy_window": C.PERIOD_DOY_WINDOW, "max_gap": C.PERIOD_MAX_GAP,
                       "min_days": C.PERIOD_MIN_DAYS}, "presets": out}


def local_normal(pid: str, mats: dict, cal: dict, day_label: str) -> dict:
    """Local Normal badge for the latest week in which both sensors have a complete week."""
    (mm, mp), (vm, vp) = mats[pid, "modis"], mats[pid, "viirs"]
    year = int(cal["year"][-1])
    ok = np.flatnonzero(~np.isnan(mm[-1]) & ~np.isnan(vm[-1]))
    if not len(ok):
        return {"week_start": cal["date"][-1].isoformat(), "flag": None, "label": day_label,
                "sentence": A.local_normal_sentence(None)}
    w = int(ok[-1])
    flag = A.local_normal_flag(mm[-1, w], vm[-1, w], mp["p90"][w], vp["p90"][w])
    start = cal["date"][int(np.flatnonzero((cal["year"] == year) & (cal["week"] == w))[0])]
    return {"week_start": start.isoformat(), "flag": flag,
            "label": A.local_normal_label(flag, year, day_label), "sentence": A.local_normal_sentence(flag)}


def narratives(rd: dict, mats: dict, cal: dict, as_of: str) -> dict:
    """narratives.json: this-month card, Local Normal badge and fixed wording."""
    a, out = parse(as_of), {}
    for p in C.PRESETS:
        s = rd["presets"][p["id"]]
        label = C.LABELS[s["label"][day_index(a)]]
        stats = A.this_month(nan_array(s["harm"]), nan_array(s["frac_burning"]), cal, a)
        variant, sentence = A.month_sentence(stats, p["sentence"], label)
        basis = "VIIRS tile-days" if label in ("Measured", "Provisional") else "MODIS tile-days x conversion ratio"
        out[p["id"]] = {"this_month": {**stats, "basis": basis, "label": label, "variant": variant,
                                       "sentence": sentence},
                        "local_normal": local_normal(p["id"], mats, cal, label)}
    return {"as_of": as_of, "templates": A.TEMPLATES,
            "local_normal_explanations": A.LOCAL_NORMAL_EXPLANATIONS, "presets": out}

# ------------------------------------------------------------------ geometry

def _verts(cell: str) -> list[float]:
    """Six vertices of a cell as a flat [lng, lat, ...] list."""
    return [round(x, C.Q_COORD) for lat, lng in h3.cell_to_boundary(cell) for x in (lng, lat)]


def tile_geometry(inp: dict) -> dict:
    """tile_geometry.json: res-6 hexagons plus the res-5 fallback."""
    cells = inp["tiles"]["h3_r6"].to_list()
    ll = np.array([h3.cell_to_latlng(c) for c in cells])
    parents = sorted({h3.cell_to_parent(c, C.H3_FALLBACK_RES) for c in cells})
    pidx = {p: i for i, p in enumerate(parents)}
    return {"res": C.H3_RES, "tiles": cells, "lng": qlist(ll[:, 1], C.Q_COORD), "lat": qlist(ll[:, 0], C.Q_COORD),
            "verts": [x for c in cells for x in _verts(c)],
            "regions": C.BASE_REGIONS, "region": inp["region_of_tile"].tolist(),
            "zones": inp["zones"], "zone": inp["zone_of_tile"].tolist(),
            "fallback": {"res": C.H3_FALLBACK_RES, "tiles": parents,
                         "verts": [x for p in parents for x in _verts(p)],
                         "parent": [pidx[h3.cell_to_parent(c, C.H3_FALLBACK_RES)] for c in cells]}}

# ------------------------------------------------------------------ manifest

def contract_of(rel: str) -> str:
    """Contract name for a path relative to web/public/data."""
    if rel.startswith("hotspots/"):
        return "hotspots_csv"
    return next(n for n, (_, pat) in CONTRACTS.items() if Path(rel).match(pat))


def precache_list(years: list[int]) -> list[str]:
    """Plan s5 precache list: core files plus tile_month for the last five years."""
    return ([f"{n}.json" for n in C.PRECACHE]
            + [f"tile_month_{y}.json" for y in years[-C.PRECACHE_TILE_MONTH_YEARS:]])


def manifest(inp: dict, months: list[str], labels_by_ym: list[str], data_dir: Path) -> dict:
    """manifest.json: hashes, provenance placeholders for M1/M2, shared lookups."""
    rel = lambda p: p.relative_to(data_dir).as_posix()      # noqa: E731  forward slashes on every OS
    files = [{"path": rel(p), "contract": contract_of(rel(p)), "bytes": p.stat().st_size, "sha256": sha256(p)}
             for p in sorted(data_dir.rglob("*")) if p.is_file() and p.name != "manifest.json"]
    prov = [ym for ym, lab in zip(months, labels_by_ym) if lab == "Provisional"]
    years = sorted({int(m[:4]) for m in months})
    return {"as_of": inp["as_of"], "months": months, "provisional_from": prov[0] if prov else None,
            "eras": [{"id": e, "start": s, "end": x, "label": C.ERA_LABEL[e],
                      "trust_factor": C.ERA_TRUST_FACTOR[e]} for e, s, x in C.ERAS],
            "labels": C.LABELS, "presets": C.PRESET_IDS, "default_preset": C.DEFAULT_PRESET,
            "control_region": C.CONTROL_REGION["id"], "tile_count": len(inp["tiles"]),
            "relay_satellite": C.RELAY_SET, "firms_download_dates": {}, "product_versions": {},
            "model_version": None,
            "boundary": {"source": inp["regions"]["regions"][0]["boundary_source"], "licence": None},
            "ai_use_note": AI_USE_NOTE, "safety_disclaimer": C.SAFETY_DISCLAIMER,
            "budget_mb": C.SIZE_BUDGET_MB, "precache": precache_list(years), "files": files}

# -------------------------------------------------------------------- driver

def build(data_dir: Path = C.DATA_DIR, processed_dir: Path = C.PROCESSED_DIR) -> dict:
    """Build every M3 table. Returns a short summary."""
    inp = load_inputs(data_dir, processed_dir)
    months = month_list(inp["as_of"])
    n_days = day_index(inp["as_of"]) + 1
    cal = A.day_calendar(n_days)
    flags = day_flags(inp["coverage"], n_days)
    tab = ratio_tables(inp["conversion"], inp["zones"])
    agg = aggregate(inp, flags, n_days, len(months))
    env = envelope(inp["mock"], inp["generated_at"])

    def put(name: str, obj: dict) -> None:
        write_json(data_dir / name, {**env, **obj})

    for old in data_dir.glob("tile_month_*.json"):
        old.unlink()
    for year in sorted({int(m[:4]) for m in months}):
        put(f"tile_month_{year}.json", tile_month_file(year, agg, inp, flags, tab, months))
    rd = region_daily(agg, inp, flags, tab, cal)
    clim, mats = climatology(rd, cal)
    put("region_daily.json", rd)
    put("climatology.json", clim)
    put("periods.json", periods(rd, cal))
    put("narratives.json", narratives(rd, mats, cal, inp["as_of"]))
    put("tile_geometry.json", tile_geometry(inp))
    labels_by_ym = [month_label(ym, flags, inp["as_of"]) for ym in months]
    put("manifest.json", manifest(inp, months, labels_by_ym, data_dir))
    return {"as_of": inp["as_of"], "tiles": len(inp["tiles"]), "zones": len(inp["zones"]),
            "months": len(months), "mock": inp["mock"]}
