"""Harmonized value, range and trust score (plan s6).

Harmonized value = relative burning activity at VIIRS scale, in tile-days.
It is NOT fire size, burned area or total fires. MODIS and VIIRS are never
added for the same day: each day has one source of truth. A VIIRS day uses
VIIRS tile-days; any other day uses MODIS tile-days x conversion ratio.
"""
from __future__ import annotations

import numpy as np

from . import config as C


def convert_modis(modis_td, ratio):
    """MODIS tile-days x ratio. Zero stays zero; a missing (NaN) ratio gives NaN, never zero."""
    m = np.asarray(modis_td, dtype=float)
    return np.where(m == 0, 0.0, m * ratio)


def harmonize(viirs_td, modis_td, ratio, widened_lo, widened_hi, cap):
    """(harm, lo, hi) from the VIIRS-day part plus the converted MODIS-day part, capped.

    viirs_td: tile-days on days where VIIRS is the source of truth.
    modis_td: MODIS tile-days on the other days (never the same days).
    cap: in-scope tile count (region-day) or days in month (tile-month).
    """
    v = np.asarray(viirs_td, dtype=float)
    return tuple(np.minimum(v + convert_modis(modis_td, r), cap) for r in (ratio, widened_lo, widened_hi))


def support_factor(n_support, k: float = C.K_SUPPORT):
    """f_support in [0, 1): falls when few tile-days support the zone-month ratio."""
    n = np.asarray(n_support, dtype=float)
    return n / (n + k)


def trust_score(harm, lo, hi, f_support, f_era):
    """Trust 0-100 = 100 x (1 - range width / value) x f_support x f_era, floored at 0.

    Returns NaN (shown as n/a, no activity) where the value is 0 or missing.
    """
    harm = np.asarray(harm, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = 100.0 * (1.0 - (np.asarray(hi) - np.asarray(lo)) / harm) * f_support * f_era
    return np.where((harm > 0) & np.isfinite(harm), np.maximum(t, 0.0), np.nan)
