"""V1 — does NYC 311 actually publish a deadline we can score against?

    python -m drishti_research.nyc_coverage

The question, and why it is the first thing we do
-------------------------------------------------
``slaBreachRate`` carries GRIE's heaviest factor weight. Every other signal is
derived from counts we know exist. This one is derived from ``due_date``, and
F-10 recorded a Street Light request that came back from Socrata with no
``due_date`` key at all. If that generalises — if DOT simply does not publish
deadlines — then GRIE's top factor has no source column on this corpus and the
whole plan needs a different SLA definition before a single row is imported.

So this module answers one question per (agency, complaint type): out of the
requests in our slice, how many carry a ``due_date``? Gate 0 reads the answer at
60%. Above that we use the published deadline directly; below it we derive an SLA
per type from the observed closure distribution and **declare it as derived**,
which is a documented weakness rather than a hidden constant — exactly the trap
that the 17 assumed constants in the old ``calibration.py`` fell into.

Why this scans instead of aggregating
-------------------------------------
The obvious query is ``$select=agency, complaint_type, count(1), count(due_date)
&$group=agency, complaint_type``. It times out at 180 seconds even filtered to
Brooklyn and six complaint types — F-11, reproduced deliberately before writing
this module. So we page the slice down over six narrow columns and count locally.
Six columns rather than the full twenty-two keeps this materially cheaper than
the V2 pull it precedes, which matters because its job is partly to prove the
paging works before we commit to the long one.

What else this run gets for free
--------------------------------
The same scan carries ``created_date`` and ``closed_date``, so it also produces
the observed time-to-close quantiles per type. Those are I3's fallback SLA table
if the coverage answer comes back low, and they are worth having either way as
the fidelity target Gate 2 checks our replica against.
"""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd

from .nyc import COMPLAINT_TYPES, DATA, fetch, slice_where

#: Just enough to answer the coverage question and derive fallback SLAs.
SCAN_COLUMNS = (
    "unique_key",
    "agency",
    "complaint_type",
    "created_date",
    "closed_date",
    "due_date",
    "status",
)

#: Gate 0's threshold. Above it, ``due_date`` is the SLA; below it, the SLA is
#: derived from observed closures and labelled as such.
COVERAGE_THRESHOLD = 0.60

#: The quantile the derived SLA would use. p75 rather than the median because an
#: SLA that half of all requests miss is not a service level, it is a coin toss.
SLA_QUANTILE = 0.75

OUTPUT = DATA / "due-date-coverage.csv"


def scan() -> pd.DataFrame:
    """The slice, over the coverage columns only, typed for arithmetic."""
    frame = fetch(slice_where(), select=SCAN_COLUMNS)
    for column in ("created_date", "closed_date", "due_date"):
        frame[column] = pd.to_datetime(frame[column], errors="coerce")
    return frame


def coverage(frame: pd.DataFrame) -> pd.DataFrame:
    """One row per (agency, complaint type): coverage, closure and observed SLA.

    ``resolution_hours`` is measured on closed requests only. Including open ones
    as censored-at-now would understate every duration, and treating them as
    missing is the honest reading: we do not yet know how long they will take.
    """
    frame = frame.copy()
    frame["has_due"] = frame["due_date"].notna()
    frame["is_closed"] = frame["closed_date"].notna()
    frame["resolution_hours"] = (
        frame["closed_date"] - frame["created_date"]
    ).dt.total_seconds() / 3600.0
    # A closure stamped before the intake is a data error, not a fast fix.
    frame.loc[frame["resolution_hours"] < 0, "resolution_hours"] = pd.NA

    grouped = frame.groupby(["agency", "complaint_type"], dropna=False)
    table = grouped.agg(
        requests=("unique_key", "size"),
        with_due_date=("has_due", "sum"),
        closed=("is_closed", "sum"),
        median_hours=("resolution_hours", "median"),
    )
    table["p75_hours"] = grouped["resolution_hours"].quantile(SLA_QUANTILE)
    table["due_date_coverage"] = table["with_due_date"] / table["requests"]
    table["closed_share"] = table["closed"] / table["requests"]

    # Where the deadline is published, is it just intake plus a fixed term? If
    # so the fallback is not a poor substitute for it but a reconstruction of the
    # same rule, and that is worth knowing before Gate 0 is argued either way.
    published = frame[frame["has_due"]].copy()
    published["due_hours"] = (
        published["due_date"] - published["created_date"]
    ).dt.total_seconds() / 3600.0
    table["published_sla_hours"] = published.groupby(["agency", "complaint_type"])[
        "due_hours"
    ].median()

    return table.reset_index().sort_values("requests", ascending=False)


def run() -> pd.DataFrame:
    started = time.time()
    print("V1 - due_date coverage over the Brooklyn slice")
    print(f"scanning {len(COMPLAINT_TYPES)} complaint types, {len(SCAN_COLUMNS)} columns")
    frame = scan()
    print(f"scanned {len(frame):,} requests in {time.time() - started:.1f}s\n")

    table = coverage(frame)
    Path(OUTPUT).parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(OUTPUT, index=False)

    display = table.assign(
        coverage=lambda d: (d["due_date_coverage"] * 100).map("{:.1f}%".format),
        closed=lambda d: (d["closed_share"] * 100).map("{:.1f}%".format),
    )[
        [
            "agency",
            "complaint_type",
            "requests",
            "coverage",
            "closed",
            "median_hours",
            "p75_hours",
            "published_sla_hours",
        ]
    ]
    print(display.to_string(index=False, float_format=lambda v: f"{v:,.1f}"))

    overall = table["with_due_date"].sum() / table["requests"].sum()
    print(f"\noverall coverage: {overall:.1%} of {table['requests'].sum():,} requests")

    print("\nper agency")
    by_agency = table.groupby("agency").agg(
        requests=("requests", "sum"), with_due_date=("with_due_date", "sum")
    )
    by_agency["coverage"] = by_agency["with_due_date"] / by_agency["requests"]
    for agency, row in by_agency.iterrows():
        verdict = "published" if row["coverage"] >= COVERAGE_THRESHOLD else "DERIVE SLA"
        print(f"  {agency:<6}{row['requests']:>9,}{row['coverage']:>9.1%}   {verdict}")

    print(
        f"\nGate 0 - due_date coverage >= {COVERAGE_THRESHOLD:.0%}: "
        f"{'PASS, use published deadlines' if overall >= COVERAGE_THRESHOLD else 'derive SLA per type from observed p75 and declare it'}"
    )
    print(f"written to {OUTPUT.relative_to(OUTPUT.parents[3])}")
    return table


if __name__ == "__main__":
    run()
