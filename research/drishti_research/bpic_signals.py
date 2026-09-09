"""W0.1 — GRIE's five signals, derived from BPI Challenge 2015.

Why this module exists
----------------------
The interpretability study's one real weakness is that its dataset is
constructed by `generator.py`. A reviewer who reads no further than the data
section rejects it. This module builds a **real-data arm** for the same study,
out of the same public log the autonomy-gate work uses.

GRIE scores an org unit on five signals. Every one of them has a structural
analogue in a building-permit log, because a permit office is an org unit
processing citizen-initiated cases under a statutory clock — the same shape as a
municipal complaint desk.

| GRIE signal | BPIC 2015 analogue |
|---|---|
| `slaBreachRate` | share of cases whose throughput time exceeded the WABO statutory term for their procedure |
| `repeatComplaintRate` | share of cases that entered the objections-and-complaints subprocess (`01_BB_*`) |
| `escalationRate` | share of cases that left the routine track for an extended or appeal subprocess (`10_UOV_*`, `12_AP_*`) |
| `openComplaintLoad` | cases started but not finished at the close of the period |
| `avgResolutionDays` | mean throughput time of cases finishing in the period |

These are analogues, not the same measurements, and the paper must say so. What
they preserve is the thing the study is about: five correlated, noisy, positively
oriented workload-and-failure signals over an org unit, scored by a weighted sum
whose weights were chosen rather than fitted.

The unit of analysis, and why not municipality × quarter
--------------------------------------------------------
Five municipalities over roughly twenty quarters is about a hundred rows. That is
too thin to separate two models on a noisy binary outcome, and any gap measured
on it would be a confidence interval wide enough to contain anything.

The unit here is instead **(municipality, case worker, quarter)**. BPIC 2015
records `org:resource` per event; the worker who handled most of a case owns it.
Between 10 and 23 workers per municipality across ~20 quarters gives an order of
magnitude more unit-periods, and it is arguably the more faithful analogue
anyway: GRIE scores the level at which work is actually held, which in NOIDA
Authority is a section, not a zone.

The label, and the circularity that had to be avoided
-----------------------------------------------------
The buildbook's instruction — "label each unit-period with whether the statutory
deadline was breached" — cannot be followed literally: `slaBreachRate` is one of
the five features, so labelling the same period with breach makes the task
trivially solvable by reading one column, and both models would score near 1.0
for reasons that have nothing to do with interpretability.

The label is therefore **forward-looking**: features are measured over quarter
`q`, and the outcome is whether the unit's breach rate in quarter `q+1` lands in
the worst `LABEL_QUANTILE` of the panel. That is a genuine forecasting task, it
is what GRIE is actually for — flagging a unit before it fails, not after — and
it is not circular. Breach rate is autocorrelated, so the current period's breach
rate is legitimately informative; that is signal, not leakage, and both models
get it equally.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .bpic import MUNICIPALITIES, load_log, parse_code

#: Statutory decision terms under the Dutch Wabo, in days. The regular procedure
#: runs eight weeks and the extended procedure twenty-six. Cases whose procedure
#: is not recorded are assumed regular, which is the common case and the
#: conservative one — it makes a breach easier to record, not harder.
STATUTORY_TERM_DAYS = {"Regulier": 56, "Uitgebreid": 182}
DEFAULT_TERM_DAYS = 56

#: Subprocesses standing in for a citizen coming back, and for a case leaving the
#: routine track. Both are read off the documented code scheme, not mined.
OBJECTION_SUBPROCESSES = ("01_BB",)
ESCALATION_SUBPROCESSES = ("10_UOV", "12_AP", "12_AP_UOV")

#: A unit-period is labelled a failure if next quarter's breach rate sits in the
#: worst fifth of the panel.
LABEL_QUANTILE = 0.80

#: Unit-periods thinner than this are dropped: a breach rate over two cases is
#: noise, and keeping them would inflate the apparent difficulty for both models.
MIN_CASES_PER_PERIOD = 5

FEATURE_KEYS = [
    "slaBreachRate",
    "repeatComplaintRate",
    "escalationRate",
    "openComplaintLoad",
    "avgResolutionDays",
]


@dataclass(frozen=True)
class Case:
    """One permit application, reduced to what the five signals need."""

    case_id: str
    owner: str
    started: pd.Timestamp
    ended: pd.Timestamp
    duration_days: float
    term_days: int
    objected: bool
    escalated: bool

    @property
    def breached(self) -> bool:
        return self.duration_days > self.term_days


def case_table(municipality: int) -> pd.DataFrame:
    """Collapse one municipality's event log to one row per case."""
    frame = load_log(municipality)
    frame = frame.assign(subprocess=frame["activity"].map(lambda a: parse_code(a).subprocess))

    grouped = frame.groupby("case_id", sort=False)
    cases = grouped.agg(
        started=("timestamp", "min"),
        ended=("timestamp", "max"),
        events=("activity", "size"),
    )

    # The worker who handled most events owns the case. Ties break on the first
    # such worker, which is arbitrary but stable.
    owners = (
        frame.dropna(subset=["resource"])
        .groupby(["case_id", "resource"], sort=False)
        .size()
        .reset_index(name="n")
        .sort_values(["case_id", "n"], ascending=[True, False], kind="stable")
        .drop_duplicates("case_id")
        .set_index("case_id")["resource"]
    )
    cases["owner"] = owners.reindex(cases.index).astype("string")

    procedures = (
        frame.dropna(subset=["procedure"])
        .drop_duplicates("case_id")
        .set_index("case_id")["procedure"]
        if "procedure" in frame.columns
        else pd.Series(dtype="object")
    )
    cases["procedure"] = procedures.reindex(cases.index)
    cases["term_days"] = (
        cases["procedure"].map(STATUTORY_TERM_DAYS).fillna(DEFAULT_TERM_DAYS).astype(int)
    )

    subprocesses = grouped["subprocess"].apply(set)
    cases["objected"] = subprocesses.map(lambda s: bool(s & set(OBJECTION_SUBPROCESSES)))
    cases["escalated"] = subprocesses.map(lambda s: bool(s & set(ESCALATION_SUBPROCESSES)))

    cases["duration_days"] = (cases["ended"] - cases["started"]).dt.total_seconds() / 86400.0
    cases["breached"] = cases["duration_days"] > cases["term_days"]
    cases["municipality"] = municipality
    # Periods carry no timezone, so drop it explicitly rather than on a warning.
    cases["quarter"] = cases["ended"].dt.tz_convert(None).dt.to_period("Q")
    cases["opened_quarter"] = cases["started"].dt.tz_convert(None).dt.to_period("Q")

    return cases.dropna(subset=["owner"]).reset_index()


def _open_load(cases: pd.DataFrame) -> pd.Series:
    """Cases open at the close of each (unit, quarter): started before, ended after."""
    quarters = sorted(set(cases["quarter"]) | set(cases["opened_quarter"]))
    closes = {q: q.end_time.value for q in quarters}  # nanoseconds, comparison-safe
    rows = []
    for unit, unit_cases in cases.groupby(["municipality", "owner"], sort=False):
        starts = unit_cases["started"].astype("int64").to_numpy()
        ends = unit_cases["ended"].astype("int64").to_numpy()
        for quarter in quarters:
            close = closes[quarter]
            rows.append((*unit, quarter, int(((starts <= close) & (ends > close)).sum())))
    return pd.DataFrame(
        rows, columns=["municipality", "owner", "quarter", "openComplaintLoad"]
    ).set_index(["municipality", "owner", "quarter"])["openComplaintLoad"]


def build_panel(municipalities: tuple[int, ...] = MUNICIPALITIES) -> pd.DataFrame:
    """The unit-period panel: five GRIE signals plus a forward-looking label.

    One row per (municipality, case worker, quarter) with at least
    `MIN_CASES_PER_PERIOD` cases completed, and a next-quarter row to label from.
    """
    cases = pd.concat([case_table(m) for m in municipalities], ignore_index=True)

    by_period = cases.groupby(["municipality", "owner", "quarter"], observed=True)
    panel = by_period.agg(
        cases_closed=("case_id", "size"),
        slaBreachRate=("breached", "mean"),
        repeatComplaintRate=("objected", "mean"),
        escalationRate=("escalated", "mean"),
        avgResolutionDays=("duration_days", "mean"),
    )
    panel["openComplaintLoad"] = _open_load(cases).reindex(panel.index).fillna(0.0)
    panel = panel.reset_index()

    panel = panel[panel["cases_closed"] >= MIN_CASES_PER_PERIOD].copy()

    # The label: next quarter's breach rate, in the worst fifth of the panel.
    panel = panel.sort_values(["municipality", "owner", "quarter"], kind="stable")
    panel["nextBreachRate"] = panel.groupby(["municipality", "owner"], observed=True)[
        "slaBreachRate"
    ].shift(-1)
    panel["nextQuarter"] = panel.groupby(["municipality", "owner"], observed=True)["quarter"].shift(
        -1
    )

    # Only consecutive quarters count — a gap means the unit went quiet, and the
    # "next" observation is a different situation entirely.
    consecutive = panel["nextQuarter"].notna() & (
        panel["nextQuarter"].map(lambda q: q.ordinal if pd.notna(q) else np.nan)
        - panel["quarter"].map(lambda q: q.ordinal)
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
    frame = build_panel()
    print(f"{len(frame)} unit-periods across {frame['municipality'].nunique()} municipalities")
    print(
        f"{frame.groupby(['municipality', 'owner']).ngroups} distinct case workers, "
        f"quarters {frame['quarter'].min()} to {frame['quarter'].max()}"
    )
    print(
        f"label: next-quarter breach rate >= {frame.attrs['label_cutoff']:.3f} "
        f"({LABEL_QUANTILE:.0%} quantile) — positive rate {frame['failed'].mean():.1%}"
    )
    print()
    print(frame[FEATURE_KEYS].describe().T.to_string())
    print()
    print("correlation with the label:")
    print(frame[[*FEATURE_KEYS, "failed"]].corr()["failed"].drop("failed").to_string())
