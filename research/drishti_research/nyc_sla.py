"""I3 — the SLA table, and the fact that NYC does not give us one.

    python -m drishti_research.nyc_sla

What V1 found
-------------
``due_date`` is populated in the 311 dataset — Graffiti requests carry one — and
it is **empty for every one of the 355,430 requests in our slice**. Not sparse,
not partial: zero of six complaint types across DOT, DSNY and DEP publish a
deadline. F-10 asked whether GRIE's heaviest factor had a source column on this
corpus, and the answer is no.

Gate 0 anticipated this and does not treat it as a blocker. The fallback it
prescribes is to derive an SLA per type from observed closure times and
**declare it as derived**. This module is that derivation, and this docstring is
the declaration.

The derivation
--------------
For each complaint type, the SLA is the 75th percentile of time-to-close over
closed requests in the corpus. Three choices in that sentence are worth
defending, because the whole point of doing it here rather than picking round
numbers is that each one can be argued with.

**p75, not the median.** An SLA that half of all requests miss is not a service
level. p75 puts three quarters of the citywide record inside the promise, which
is roughly where a real target sits, and it makes the resulting breach rate a
quantity with headroom in both directions rather than one pinned near 50%.

**Per complaint type, not one global number.** The types differ by two orders of
magnitude — Sewer closes in a median 3.4 hours, Street Light Condition in 139.
A single SLA would make ``slaBreachRate`` a proxy for "how many streetlights does
this board have", which is volume again, and volume is what F-01 was about.

**Over the whole corpus, not per unit.** The threshold has to be one fixed
standard or a unit cannot deviate from it: an SLA fitted per board would define
every board as breaching 25% of the time and the signal would carry no
information at all.

What this measurement is, and is not
------------------------------------
``slaBreachRate`` on this corpus therefore means *the share of a unit's requests
that closed slower than the citywide 75th percentile for their type*. It is a
relative-performance measure, not a promise the City of New York made and broke.
Every use of it — in the paper, in the risk register, in any sentence shown to a
user — must say so. Calling a derived quantity an SLA breach without that
qualification is precisely the move that made the old ``calibration.py`` and its
17 assumed constants indefensible.

Open requests
-------------
A request still open past its derived deadline counts as breached, exactly as
``riskSignals.ts`` does in production. "Past" is measured against the close of
the period being scored, never against wall-clock time — that is F-04/I4, and on
a corpus that ends in 2025 the wall-clock version would mark essentially
everything breached.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd

from .nyc import DATA

#: The quantile the derived SLA sits at. See the module docstring.
SLA_QUANTILE = 0.75

#: How the resulting number is described everywhere it is shown. Kept as a
#: constant so the qualification travels with the value instead of depending on
#: whoever writes the next caption.
PROVENANCE = (
    f"derived: p{int(SLA_QUANTILE * 100)} of observed time-to-close per complaint type, "
    "NYC 311 Brooklyn 2022-2025. NYC publishes no due_date for these types."
)

TABLE = DATA / "sla-table.csv"
MANIFEST = DATA / "sla-table.meta.json"


def derive(corpus: pd.DataFrame) -> pd.DataFrame:
    """One SLA per complaint type, with the evidence that produced it.

    Returns the quantiles either side of the chosen one as well. A type whose
    p50 and p90 bracket the p75 tightly has a genuine service rhythm; one where
    they span days is a type whose "deadline" is mostly noise, and the paper
    should be able to see which is which rather than being handed one number.
    """
    closed = corpus[corpus["resolution_hours"].notna()]
    grouped = closed.groupby("complaint_type")["resolution_hours"]

    table = pd.DataFrame(
        {
            "closed_requests": grouped.size(),
            "p50_hours": grouped.quantile(0.50),
            "sla_hours": grouped.quantile(SLA_QUANTILE),
            "p90_hours": grouped.quantile(0.90),
        }
    )
    table["agency"] = corpus.groupby("complaint_type")["agency"].agg(
        lambda s: s.mode().iat[0] if not s.mode().empty else pd.NA
    )
    table["requests"] = corpus.groupby("complaint_type").size()
    table["closed_share"] = table["closed_requests"] / table["requests"]
    table["provenance"] = PROVENANCE

    return table.reset_index()[
        [
            "complaint_type",
            "agency",
            "requests",
            "closed_requests",
            "closed_share",
            "p50_hours",
            "sla_hours",
            "p90_hours",
            "provenance",
        ]
    ].sort_values("sla_hours")


def sla_hours(corpus: pd.DataFrame) -> dict[str, float]:
    """The derived SLA as a lookup, for callers that only want the number."""
    table = derive(corpus)
    return dict(zip(table["complaint_type"], table["sla_hours"].astype(float), strict=True))


def deadlines(corpus: pd.DataFrame, hours: dict[str, float] | None = None) -> pd.Series:
    """Each request's derived deadline: intake plus its type's SLA."""
    hours = hours if hours is not None else sla_hours(corpus)
    created = pd.to_datetime(corpus["created_date"], errors="coerce")
    offsets = corpus["complaint_type"].map(hours)
    # To the millisecond, as the product stores it. In nanoseconds, Water
    # System's 47.6333... hours comes out one nanosecond short of 47h38m, and a
    # request closed on the deadline second read as late here and on time in the
    # backend: four unit-months disagreed by one request each (F-47).
    return created + pd.to_timedelta((offsets * 3_600_000).round(), unit="ms")


def run() -> pd.DataFrame:
    corpus = pd.read_csv(
        DATA / "brooklyn.csv", dtype={"unique_key": str, "incident_zip": str}, low_memory=False
    )
    table = derive(corpus)
    TABLE.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(TABLE, index=False)

    print("I3 - derived SLA per complaint type")
    print(f"{PROVENANCE}\n")
    print(
        table[
            [
                "complaint_type",
                "agency",
                "requests",
                "closed_share",
                "p50_hours",
                "sla_hours",
                "p90_hours",
            ]
        ].to_string(index=False, float_format=lambda v: f"{v:,.1f}")
    )

    MANIFEST.write_text(
        json.dumps(
            {
                "derived_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "quantile": SLA_QUANTILE,
                "provenance": PROVENANCE,
                "sla_hours": {
                    row["complaint_type"]: round(float(row["sla_hours"]), 2)
                    for _, row in table.iterrows()
                },
            },
            indent=2,
        )
        + "\n"
    )
    print(f"\nwritten to {TABLE.name} and {MANIFEST.name}")
    return table


if __name__ == "__main__":
    run()
