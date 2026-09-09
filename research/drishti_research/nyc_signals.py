"""V3 — GRIE's five signals, derived from NYC 311.

    python -m drishti_research.nyc_signals

This is the third panel the study has been run on, after a constructed one and
two BPI Challenge event logs, and it is the first that is actually a municipal
complaint desk. The signal definitions therefore track ``riskSignals.ts`` — the
production implementation — far more closely than the BPIC analogues could, and
where they deviate the deviation is named below.

The unit of analysis
--------------------
**(agency, community board, month).** Three agencies appear in our six complaint
types — DOT, DSNY, DEP; DPR does not, because NYC has no public-toilet analogue
— across 18 Brooklyn community boards and 48 months. That is up to 2,592
unit-periods, an order of magnitude more than the 268 the BPIC 2015 arm had and
roughly ten times the BPIC 2018 arm.

That number is the entire point of this arm. N3 in the build plan records that
BPIC 2018's minimum detectable gap was 0.0655 against an effect of 0.0553: it
could not have detected the result it was testing for, and reporting it as a
non-replication was reporting the sample size. A panel this size can.

The five signals, and where each one deviates from production
-------------------------------------------------------------
``slaBreachRate`` — share of requests that closed after their deadline, or are
still open past it at the close of the period. **Deviation: the deadline is
derived, not published.** NYC publishes no ``due_date`` for any of our six types
(V1: zero of 355,430). ``nyc_sla`` derives one per type from the citywide p75 of
observed closure times, so this signal reads "slower than the citywide norm for
this type", not "broke a promise". See that module for the full declaration.

``repeatComplaintRate`` — share of requests filed at a location where an earlier
request of the same type had **already been closed**. That is production's
definition of a repeat: not "this area has seen this before", which measures
volume, but "it was fixed and it came back", which measures the repair not
holding. F-01 is the record of getting this wrong once.

**Deviation: the key is the location, not the unit.** Production keys on
(category, org unit) because a NOIDA sector carries a handful of complaints a
month. A Brooklyn community board carries hundreds, so at that key essentially
every request has some earlier closed request of its type somewhere in the
board and the rate saturates near 1.0 — F-01 again, wearing a different hat. The
key here is the incident address, which is what "the repair did not hold"
actually means, and which does not saturate.

``escalationRate`` — share of requests that left the receiving agency's routine
track. NYC records no escalation (F-12), so this is an analogue, read off the
agency's own resolution text: either the case was **referred out of
jurisdiction** to another agency, or it was closed by **issuing a violation,
summons or corrective action** rather than by fixing the thing. Both mean the
agency could not simply resolve it, which is what an escalation is evidence of.
Structurally this is the same move BPIC 2015 made with its extended and appeal
subprocesses.

``openComplaintLoad`` — requests started before the close of the period and not
finished by it. Identical to production.

``avgResolutionDays`` — mean time-to-close of requests closing in the period.
Identical to production.

The label, and the circularity that has to be avoided
-----------------------------------------------------
Same as every other arm, and for the same reason. Labelling a period with its own
breach rate makes the task solvable by reading one feature column, so the label
is **forward-looking**: features over month ``m``, outcome is whether the unit's
breach rate in month ``m+1`` lands in the worst ``LABEL_QUANTILE`` of the panel.
Breach rate is autocorrelated and the current month's rate is legitimately
informative about the next one; that is signal, and every model gets it equally.

Only consecutive months count. A gap means the unit went quiet, and the next
observation is a different situation.

Time, and why ``Date.now()`` never appears here
-----------------------------------------------
Every "is this open" and "is this past due" question is asked against the close
of the period being scored. The corpus ends in 2025; asking against wall-clock
time would mark every open request breached and every load figure identical.
That is F-04, and I4 exists because the same mistake is waiting in the backend.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .nyc import DATA
from .nyc_sla import deadlines, sla_hours

#: A unit-period thinner than this is dropped. A breach rate over a handful of
#: requests is noise, and keeping those rows would make the panel look larger
#: while making the task harder for every model equally.
MIN_REQUESTS_PER_PERIOD = 20

#: The worst fifth of next-month breach rates is a failure. Matches the BPIC
#: arms, so the three panels' positive rates are comparable.
LABEL_QUANTILE = 0.80

#: A repeat has to be a genuine return visit, not the same wave of reports. Two
#: neighbours reporting one pothole on Tuesday and Thursday is corroboration.
#: Production draws this line with an explicit duplicate flag; NYC's duplicates
#: are only ever stated in the resolution text, so the line here is drawn on the
#: closure instead — the earlier request must have been *closed* before the later
#: one was filed.
FEATURE_KEYS = [
    "slaBreachRate",
    "repeatComplaintRate",
    "escalationRate",
    "openComplaintLoad",
    "avgResolutionDays",
]

#: Phrases in the agency's own resolution text that mean the case left the
#: routine track. Referral first, then enforcement. Read off the corpus rather
#: than guessed: every one of these appears verbatim in NYC's canned resolution
#: descriptions, which is why they can be matched as substrings at all.
REFERRAL_MARKERS = (
    "has requested the department of",
    "referred it to the department",
    "referred to the department",
    "not to be under",
    "out of jurisdiction",
    "is not under the jurisdiction",
    "jurisdiction of the",
)
ENFORCEMENT_MARKERS = (
    "notice of violation",
    "issued a summons",
    "corrective action repair",
    "issued a violation",
)

#: Text that means NYC itself considered the request a duplicate of another. Such
#: requests are excluded from the recurrence denominator, matching production's
#: exclusion of `duplicateOfId` — corroboration is not recurrence.
DUPLICATE_MARKERS = (
    "is a duplicate of a previously filed complaint",
    "open service request already exists for the same location",
)


def _contains_any(text: pd.Series, markers: tuple[str, ...]) -> pd.Series:
    lowered = text.fillna("").str.lower()
    hit = pd.Series(False, index=text.index)
    for marker in markers:
        hit |= lowered.str.contains(marker, regex=False)
    return hit


def load_corpus() -> pd.DataFrame:
    """The frozen slice, typed and annotated with everything the signals need."""
    frame = pd.read_csv(
        DATA / "brooklyn.csv",
        dtype={"unique_key": str, "incident_zip": str},
        low_memory=False,
    )
    frame["created_date"] = pd.to_datetime(frame["created_date"], errors="coerce")
    frame["closed_date"] = pd.to_datetime(frame["closed_date"], errors="coerce")

    # A request we cannot place in a board cannot be attributed to a unit.
    frame = frame[frame["board"].notna() & frame["agency"].notna()].copy()
    frame["board"] = frame["board"].astype(int)
    frame["month"] = frame["created_date"].dt.to_period("M")
    frame["closed_month"] = frame["closed_date"].dt.to_period("M")

    frame["deadline"] = deadlines(frame, sla_hours(frame))
    frame["referred"] = _contains_any(frame["resolution_description"], REFERRAL_MARKERS)
    frame["enforced"] = _contains_any(frame["resolution_description"], ENFORCEMENT_MARKERS)
    frame["escalated"] = frame["referred"] | frame["enforced"]
    frame["is_duplicate"] = _contains_any(frame["resolution_description"], DUPLICATE_MARKERS)

    # The recurrence key: one physical place. Address where NYC gives one, the
    # rounded coordinate pair otherwise — five decimal places is about a metre,
    # which is the same pothole rather than the same block.
    address = frame["incident_address"].fillna("").str.strip().str.upper()
    fallback = (
        frame["latitude"].round(5).astype("string") + "," + frame["longitude"].round(5).astype("string")
    )
    frame["place"] = address.where(address != "", fallback).fillna("")

    return frame


def _mark_repeats(frame: pd.DataFrame) -> pd.Series:
    """True where an earlier request of the same type at this place had closed.

    The question per request is "did anything of this type at this address close
    before I was filed", and the cheapest exact answer is the running minimum of
    the closure times of all strictly earlier requests in the group: if any
    earlier one closed in time, the earliest one did.

    Done as a grouped shift and cumulative minimum rather than a self-join or a
    Python loop over groups. At 350k requests the group key has six figures of
    distinct values, and iterating them in Python costs minutes for work pandas
    does in one vectorised pass.

    Times are carried as float nanoseconds so that a request still open reads as
    NaN and propagates correctly: ``skipna`` leaves it out of the running
    minimum, and ``NaN < filed`` is False, which is exactly right — a request
    that never closed cannot be evidence that a repair did not hold.
    """
    keyed = frame[frame["place"] != ""].sort_values(
        ["place", "complaint_type", "created_date"], kind="stable"
    )
    closed_ns = keyed["closed_date"].astype("int64").where(keyed["closed_date"].notna()).astype(
        float
    )
    grouped = closed_ns.groupby([keyed["place"], keyed["complaint_type"]], sort=False)
    earliest_prior_close = grouped.shift(1).groupby(
        [keyed["place"], keyed["complaint_type"]], sort=False
    ).cummin()

    filed_ns = keyed["created_date"].astype("int64").astype(float)
    hit = (earliest_prior_close < filed_ns).to_numpy()

    repeats = pd.Series(False, index=frame.index)
    repeats.loc[keyed.index] = hit
    return repeats


def _open_load(frame: pd.DataFrame, periods: pd.PeriodIndex) -> pd.Series:
    """Requests open at the close of each (agency, board, month).

    Open means filed on or before the period close and not closed by it — the
    period close, never wall-clock time. See the module docstring on F-04.
    """
    rows = []
    closes = {period: period.end_time for period in periods}
    for unit, unit_rows in frame.groupby(["agency", "board"], sort=False):
        filed = unit_rows["created_date"].to_numpy()
        # An unclosed request is open forever, so it is closed at +infinity.
        closed = unit_rows["closed_date"].fillna(pd.Timestamp.max).to_numpy()
        for period, close in closes.items():
            stamp = np.datetime64(close)
            rows.append((*unit, period, int(((filed <= stamp) & (closed > stamp)).sum())))
    return pd.DataFrame(
        rows, columns=["agency", "board", "month", "openComplaintLoad"]
    ).set_index(["agency", "board", "month"])["openComplaintLoad"]


def build_panel() -> pd.DataFrame:
    """The unit-period panel: five GRIE signals plus a forward-looking label."""
    frame = load_corpus()
    frame["is_repeat"] = _mark_repeats(frame)

    # Breach is judged at the close of the month the request was filed in, so a
    # request filed on the 30th is not marked breached for being unfinished on
    # the 31st when its type's SLA is five days. Its deadline decides.
    period_close = frame["month"].map(lambda p: p.end_time)
    resolved_late = frame["closed_date"].notna() & (frame["closed_date"] > frame["deadline"])
    still_open_late = frame["closed_date"].isna() & (period_close > frame["deadline"])
    frame["breached"] = resolved_late | still_open_late

    frame["resolution_days"] = (
        frame["closed_date"] - frame["created_date"]
    ).dt.total_seconds() / 86400.0

    by_period = frame.groupby(["agency", "board", "month"], observed=True)
    panel = by_period.agg(
        requests=("unique_key", "size"),
        slaBreachRate=("breached", "mean"),
        escalationRate=("escalated", "mean"),
        referralRate=("referred", "mean"),
    )

    # Recurrence excludes NYC's own declared duplicates from both sides.
    candidates = frame[~frame["is_duplicate"]]
    panel["repeatComplaintRate"] = (
        candidates.groupby(["agency", "board", "month"], observed=True)["is_repeat"]
        .mean()
        .reindex(panel.index)
        .fillna(0.0)
    )

    # Resolution speed is measured over requests *closing* in the period, which
    # is what an officer sees on their desk that month. Requests filed this month
    # and closed next month belong to next month's average.
    closed = frame[frame["closed_month"].notna()]
    panel["avgResolutionDays"] = (
        closed.groupby(["agency", "board", "closed_month"], observed=True)["resolution_days"]
        .mean()
        .rename_axis(["agency", "board", "month"])
        .reindex(panel.index)
        .fillna(0.0)
    )

    periods = pd.PeriodIndex(sorted(frame["month"].dropna().unique()), freq="M")
    panel["openComplaintLoad"] = _open_load(frame, periods).reindex(panel.index).fillna(0.0)

    panel = panel.reset_index()
    panel = panel[panel["requests"] >= MIN_REQUESTS_PER_PERIOD].copy()

    panel = panel.sort_values(["agency", "board", "month"], kind="stable")
    grouped = panel.groupby(["agency", "board"], observed=True)
    panel["nextBreachRate"] = grouped["slaBreachRate"].shift(-1)
    panel["nextMonth"] = grouped["month"].shift(-1)

    consecutive = panel["nextMonth"].notna() & (
        panel["nextMonth"].map(lambda p: p.ordinal if pd.notna(p) else np.nan)
        - panel["month"].map(lambda p: p.ordinal)
        == 1
    )
    panel = panel[consecutive].copy()

    cutoff = panel["nextBreachRate"].quantile(LABEL_QUANTILE)
    panel["failed"] = (panel["nextBreachRate"] >= cutoff).astype(int)
    panel.attrs["label_cutoff"] = float(cutoff)
    panel.attrs["label_quantile"] = LABEL_QUANTILE

    return panel.reset_index(drop=True)


def feature_matrix(panel: pd.DataFrame) -> pd.DataFrame:
    return panel[FEATURE_KEYS].astype(float)


if __name__ == "__main__":
    panel = build_panel()
    units = panel.groupby(["agency", "board"]).ngroups
    print(
        f"{len(panel)} unit-months across {units} units "
        f"({panel['agency'].nunique()} agencies x {panel['board'].nunique()} boards), "
        f"months {panel['month'].min()} to {panel['month'].max()}"
    )
    print(
        f"label: next-month breach rate >= {panel.attrs['label_cutoff']:.3f} "
        f"({LABEL_QUANTILE:.0%} quantile) - positive rate {panel['failed'].mean():.1%}"
    )
    print()
    print(panel[FEATURE_KEYS].describe().T.to_string(float_format=lambda v: f"{v:,.3f}"))
    print()
    print("correlation with the label:")
    print(panel[[*FEATURE_KEYS, "failed"]].corr()["failed"].drop("failed").to_string())
    print()
    print("requests per unit-month:")
    print(panel["requests"].describe().to_string(float_format=lambda v: f"{v:,.1f}"))
