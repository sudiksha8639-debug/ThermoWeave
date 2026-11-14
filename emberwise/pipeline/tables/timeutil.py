"""Small date helpers shared by mocks, tables and checks."""
from __future__ import annotations

import calendar
from datetime import date, timedelta

from . import config as C


def parse(d: str) -> date:
    """Parse an ISO date string (YYYY-MM-DD)."""
    return date.fromisoformat(d)


def day_index(d: date | str) -> int:
    """Days since config.EPOCH."""
    d = parse(d) if isinstance(d, str) else d
    return (d - parse(C.EPOCH)).days


def index_day(i: int) -> date:
    """Inverse of day_index."""
    return parse(C.EPOCH) + timedelta(days=int(i))


def month_list(as_of: str) -> list[str]:
    """All months 'YYYY-MM' from the epoch month to the month of as_of, inclusive."""
    y, m = parse(C.EPOCH).year, parse(C.EPOCH).month
    end = parse(as_of)
    out = []
    while (y, m) <= (end.year, end.month):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def ym_index(d: date) -> int:
    """Index of d's month in month_list()."""
    e = parse(C.EPOCH)
    return (d.year - e.year) * 12 + (d.month - e.month)


def days_in_month(ym: str, as_of: str | None = None) -> int:
    """Days in month ym; for the month containing as_of, only the days elapsed."""
    y, m = int(ym[:4]), int(ym[5:7])
    if as_of and as_of[:7] == ym:
        return parse(as_of).day
    return calendar.monthrange(y, m)[1]


def era_of(d: date | str) -> str:
    """Era id (A-D) for a date; a 'YYYY-MM' string means the first of that month."""
    s = d.isoformat() if isinstance(d, date) else (d + "-01" if len(d) == 7 else d)
    for era, start, end in C.ERAS:
        if s >= start and (end is None or s <= end):
            return era
    raise ValueError(f"{s} is before the record starts")


def week_of_year(d: date) -> int:
    """Week index 0..51; the last week absorbs day 365/366."""
    return min((d.timetuple().tm_yday - 1) // 7, C.CLIM_WEEKS - 1)
