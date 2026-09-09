"""GRIE's five signals, derived from BPI Challenge 2018.

    python -m drishti_research.bpic2018_signals

Why a second panel
------------------
Every number in the interpretability study's real-data arm comes from BPIC 2015:
five Dutch municipalities sharing one code scheme, one regulator and one process
design. A reviewer will say that a finding holding across five instances of the
same system is one finding, not five, and they will be right. The transfer
experiment inherits the same limitation — it demonstrates transfer between
*offices of the same system*, not between systems.

This module answers both. BPIC 2018 is a different country, agency, domain and
decade of software: EU direct-payment applications from German farmers, handled
by federal and local departments, 43,809 cases and 2.5 million events. Nothing
about it shares a designer with a Dutch building-permit desk.

The analogues
-------------
| GRIE signal | BPIC 2018 analogue |
|---|---|
| `slaBreachRate` | share of cases that incurred at least one penalty |
| `repeatComplaintRate` | share of cases that entered the `Objection` subprocess |
| `escalationRate` | share of cases routed to on-site or remote inspection |
| `openComplaintLoad` | cases started but not finished at the close of the period |
| `avgResolutionDays` | mean throughput time of cases finishing in the period |

Three of these deserve their reasoning stated, because the obvious choice was
wrong in every case.

**Lateness cannot be the failure measure here, and this is the important one.**
The natural analogue is the statutory payment deadline: under Regulation (EU)
1306/2013 Art. 75 the window for application year *Y* closes on 30 June of *Y+1*.
It is unusable, because EU direct payments are an **annual batch cycle** rather
than a continuous stream. Every case in a cohort moves together, so whether a
unit-quarter breaches is decided by which quarter it is: five of eight quarters
have *zero* within-quarter variance (2016Q1 = 0.000, 2016Q3 = 1.000, both with
sd 0.000). A model handed that column learns the calendar.

Nor is it an artefact of the calendar date. Every duration-based rule tested
behaves the same way — the share of unit-level variance explained by quarter
alone:

| candidate failure measure | rate | variance from quarter |
|---|---|---|
| missed statutory deadline (30 Jun Y+1) | 0.283 | **0.87** |
| throughput > 365 / 425 / 500 days | 0.31 / 0.28 / 0.22 | 0.87 / 0.87 / 0.81 |
| slower than cohort p75 / p80 / p90 | 0.25 / 0.20 / 0.10 | 0.96 / 0.98 / 0.93 |
| **at least one penalty** | **0.435** | **0.24** |

Penalty incidence is the only measure that varies between units *within* the
same period (mean within-quarter sd 0.198 against 0.073 for the deadline). It is
also the better governance analogue on its own merits: the dozen `penalty_*`
flags are the process's own recorded judgement that something went wrong with an
application, rather than a quantity this study derived.

So `slaBreachRate` maps to penalty incidence. GRIE's factor means "this unit
failed to deliver what it promised"; in a Dutch permit office that failure is
recorded as lateness, and in a German payment agency it is recorded as a
penalty. The name is kept so the shipped weight vector applies unchanged; the
paper states the substitution rather than burying it.

**This selection was made before any model was fitted.** The table above is a
variance decomposition of the raw signals — no AUC, and no model of any kind,
was computed until the measure was fixed. Choosing an outcome by which one makes
a model look good would be indefensible; choosing one by whether it varies
between the units being scored is a prerequisite for the panel meaning anything.

**Recurrence.** The log carries a `revoke decision` activity, which reads like a
perfect match for GRIE's corrected recurrence factor: a completed decision
undone is exactly "the repair did not hold". It is unusable for the same family
of reason. Its rate by application year is 41%, **99.4%**, 1.7% — a process
regime change, almost certainly a mass recalculation in 2016, not a property of
any handling unit. The `Objection` subprocess is the honest choice: it is the
direct analogue of BPIC 2015's `01_BB` track, and it is rare (2%) rather than
convenient.

**Escalation.** A case routed to physical or remote inspection has left the
routine desk track and pulled in a resource beyond the handling officer, which
is the structural role escalation plays in DRISHTI-G. It runs at 7.1%, 6.8%,
7.0% across the three years — stable enough that it is measuring units rather
than eras.

Right-censoring, and why a third of the log is discarded
--------------------------------------------------------
The log ends 19 January 2018, so application-year-2017 cases are still in
progress: their traces are truncated and their penalty flags are lower bounds
rather than final counts. 2017 is therefore dropped in full, costing 14,507
cases and leaving 29,302.

That is the conservative call and it is not free — including 2017 would roughly
double the panel. A larger panel built on an outcome known to be under-recorded
is worse than a smaller clean one, so the trade is taken deliberately and stated
here.

Unit of analysis and label
--------------------------
Both follow the BPIC 2015 arm exactly, so the two panels are comparable: one row
per (department, case worker, quarter), and a **forward-looking** label — the
features describe quarter `q`, the outcome is whether the unit's breach rate in
`q+1` falls in the worst fifth of the panel. Labelling a period with its own
breach rate would be circular, since that rate is one of the five features.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .bpic2018 import load

#: Application years whose statutory deadline falls inside the log.
#:
#: Under Regulation (EU) 1306/2013 Art. 75 the payment window for year Y closes
#: on 30 June of Y+1. The log ends 19 January 2018, so 2017 is unobservable.
OBSERVABLE_YEARS = (2015, 2016)

#: The statutory payment deadline, as a month-day in the following year.
DEADLINE_MONTH_DAY = "06-30"

#: Matches the BPIC 2015 arm so the two panels are directly comparable.
LABEL_QUANTILE = 0.80
MIN_CASES_PER_PERIOD = 5

FEATURE_KEYS = [
    "slaBreachRate",
    "repeatComplaintRate",
    "escalationRate",
    "openComplaintLoad",
    "avgResolutionDays",
]


def case_table() -> pd.DataFrame:
    """One row per case, restricted to years whose deadline the log can observe."""
    frame = load()

    frame["started"] = pd.to_datetime(frame["started"], utc=True, format="ISO8601")
    frame["finished"] = pd.to_datetime(frame["finished"], utc=True, format="ISO8601")
    frame["year"] = pd.to_numeric(frame["year"], errors="coerce")

    frame = frame[frame["year"].isin(OBSERVABLE_YEARS)].copy()
    frame = frame.dropna(subset=["resource", "department"])

    # The failure measure is penalty incidence, not lateness — see the module
    # docstring for the variance decomposition that ruled lateness out.
    frame["penalised"] = frame["penalties"] > 0

    # Kept only so the deadline rule stays inspectable alongside the one used.
    deadline = pd.to_datetime(
        (frame["year"] + 1).astype(int).astype(str) + f"-{DEADLINE_MONTH_DAY}", utc=True
    )
    frame["breached"] = frame["finished"] > deadline

    frame["quarter"] = frame["finished"].dt.tz_convert(None).dt.to_period("Q")
    frame["opened_quarter"] = frame["started"].dt.tz_convert(None).dt.to_period("Q")
    return frame.reset_index(drop=True)


def _open_load(cases: pd.DataFrame) -> pd.Series:
    """Cases open at the close of each (unit, quarter): started before, ended after.

    Written the same way as the BPIC 2015 arm, deliberately — a difference in how
    the load factor is computed would be a difference between the two panels that
    had nothing to do with the organisations they describe.
    """
    quarters = sorted(set(cases["quarter"]) | set(cases["opened_quarter"]))
    closes = {q: q.end_time.value for q in quarters}
    rows = []
    for unit, unit_cases in cases.groupby(["department", "resource"], sort=False):
        starts = unit_cases["started"].astype("int64").to_numpy()
        ends = unit_cases["finished"].astype("int64").to_numpy()
        for quarter in quarters:
            close = closes[quarter]
            rows.append((*unit, quarter, int(((starts <= close) & (ends > close)).sum())))
    return pd.DataFrame(
        rows, columns=["department", "resource", "quarter", "openComplaintLoad"]
    ).set_index(["department", "resource", "quarter"])["openComplaintLoad"]


def build_panel() -> pd.DataFrame:
    """The unit-period panel: five GRIE signals plus a forward-looking label."""
    cases = case_table()

    by_period = cases.groupby(["department", "resource", "quarter"], observed=True)
    panel = by_period.agg(
        cases_closed=("application", "size"),
        slaBreachRate=("penalised", "mean"),
        repeatComplaintRate=("objected", "mean"),
        escalationRate=("inspected", "mean"),
        avgResolutionDays=("days", "mean"),
    )
    panel["openComplaintLoad"] = _open_load(cases).reindex(panel.index).fillna(0.0)
    panel = panel.reset_index()

    panel = panel[panel["cases_closed"] >= MIN_CASES_PER_PERIOD].copy()

    panel = panel.sort_values(["department", "resource", "quarter"], kind="stable")
    grouped = panel.groupby(["department", "resource"], observed=True)
    panel["nextBreachRate"] = grouped["slaBreachRate"].shift(-1)
    panel["nextQuarter"] = grouped["quarter"].shift(-1)

    # Only consecutive quarters count: a gap means the unit went quiet, and the
    # "next" observation describes a different situation entirely.
    consecutive = panel["nextQuarter"].notna() & (
        panel["nextQuarter"].map(lambda q: q.ordinal if pd.notna(q) else np.nan)
        - panel["quarter"].map(lambda q: q.ordinal)
        == 1
    )
    panel = panel[consecutive].copy()

    cutoff = panel["nextBreachRate"].quantile(LABEL_QUANTILE)
    panel["failed"] = (panel["nextBreachRate"] >= cutoff).astype(int)
    panel.attrs["label_cutoff"] = float(cutoff)

    # The study's grouped cross-validation splits on this, so no worker's
    # quarters can straddle a fold.
    panel["unit"] = panel["department"].astype(str) + "/" + panel["resource"].astype(str)
    return panel.reset_index(drop=True)


def feature_matrix(panel: pd.DataFrame) -> pd.DataFrame:
    return panel[FEATURE_KEYS].astype(float)


def main() -> None:
    panel = build_panel()

    print(f"--- BPIC 2018 unit-period panel --- {len(panel)} rows")
    print(f"    {panel.unit.nunique()} units, {panel.quarter.nunique()} quarters, "
          f"{panel.department.nunique()} departments")
    print(f"    label: next-quarter breach rate >= {panel.attrs['label_cutoff']:.3f} "
          f"(worst {1 - LABEL_QUANTILE:.0%})")
    print(f"    positive rate {panel.failed.mean():.1%}\n")

    print("  feature summary:")
    print(panel[FEATURE_KEYS].describe().T[["mean", "std", "min", "max"]].round(3).to_string())

    print("\n  correlation with the label:")
    for key in FEATURE_KEYS:
        print(f"    {key:<22}{panel[key].corr(panel.failed):+.3f}")

    print("\n  rows per department:")
    print(panel.department.value_counts().to_string())


if __name__ == "__main__":
    main()
