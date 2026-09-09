"""V4 — the kill switch: does the NYC target persist enough to be forecastable?

    python -m drishti_research.nyc_persistence

Why this is a gate and not a diagnostic
---------------------------------------
The persistence work established a scope condition the hard way. BPIC 2015's
target has a lag-1 autocorrelation of +0.702 and every model on it clears chance
comfortably. BPIC 2018's is +0.141 and nothing does: that arm was written up as a
non-replication, and it stayed a non-replication after the panel was rebuilt
twice. Pooling both panels' units on one persistence axis turned the pairing into
a relationship rather than two anecdotes, and put the feasibility floor at
roughly **AR(1) = +0.30** — below it, unit performance is close enough to
memoryless that there is nothing for any model to find, interpretable or not.

So this number decides whether the rest of the build plan is worth executing. A
Brooklyn panel of 2,600 unit-months fixes BPIC 2018's statistical power problem
(N3), but power buys nothing if the target is genuinely unpredictable. Better to
learn that in an afternoon than after six weeks of application code.

What is measured
----------------
Each unit's own lag-1 autocorrelation of its breach rate, over consecutive months
only, for units with at least ``MIN_PERIODS`` observations. Reported as the
distribution and its pooled centre, not as a single panel-wide correlation over
stacked rows — that version mixes between-unit variation into a within-unit
question and reads systematically high.

The pooled figure is also computed the way the persistence study computed it, by
stacking every unit's consecutive (m, m+1) pairs and correlating once. Both are
printed. If they disagree materially, the panel has a few very long-lived units
dominating the average and that is worth knowing before the number is quoted.

If it fails
-----------
Gate 0's instruction is to try coarser buckets — monthly to quarterly — or
coarser units, borough rather than community board, before abandoning the plan.
Both trades work the same way: fewer, larger unit-periods have less sampling
noise in their breach rate, and sampling noise is the thing that drives measured
autocorrelation down. ``--quarterly`` runs that fallback directly.
"""

from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from .nyc_signals import build_panel

#: A unit needs this many consecutive periods before its own autocorrelation
#: means anything at all.
MIN_PERIODS = 6

#: The feasibility floor from the pooled BPIC persistence study.
FEASIBILITY_FLOOR = 0.30

#: Reference points, so the NYC number is read against something.
REFERENCE = {"BPIC 2015 (forecastable)": 0.702, "BPIC 2018 (not forecastable)": 0.141}


def _autocorr(series: pd.Series) -> float:
    """Lag-1 autocorrelation. Zero when a unit's rate never moves.

    A constant series has no defined correlation. Returning 0.0 rather than NaN
    is the conservative choice here: a unit whose breach rate is identical every
    month carries no forecastable variation, so counting it as unpersistent
    understates nothing that matters.
    """
    values = series.to_numpy(dtype=float)
    if len(values) < 2 or np.std(values[:-1]) == 0 or np.std(values[1:]) == 0:
        return 0.0
    return float(np.corrcoef(values[:-1], values[1:])[0, 1])


def per_unit(panel: pd.DataFrame) -> pd.DataFrame:
    """Each unit's persistence, over units with enough periods to measure it."""
    panel = panel.sort_values(["agency", "board", "month"], kind="stable")
    grouped = panel.groupby(["agency", "board"], observed=True)
    table = pd.DataFrame(
        {
            "periods": grouped["slaBreachRate"].size(),
            "persistence": grouped["slaBreachRate"].apply(_autocorr),
            "mean_breach": grouped["slaBreachRate"].mean(),
            "sd_breach": grouped["slaBreachRate"].std(),
        }
    )
    return table[table["periods"] >= MIN_PERIODS].reset_index()


def pooled(panel: pd.DataFrame) -> float:
    """One correlation over every unit's consecutive (m, m+1) pairs, stacked.

    Within-unit pairs only, so this stays a within-unit question — stacking the
    raw column and shifting it once would pair the last month of one unit with
    the first month of the next.
    """
    panel = panel.sort_values(["agency", "board", "month"], kind="stable")
    grouped = panel.groupby(["agency", "board"], observed=True)
    current = panel["slaBreachRate"]
    following = grouped["slaBreachRate"].shift(-1)
    step = grouped["month"].shift(-1).map(
        lambda p: p.ordinal if pd.notna(p) else np.nan
    ) - panel["month"].map(lambda p: p.ordinal)
    valid = following.notna() & (step == 1)
    if valid.sum() < 2:
        return float("nan")
    return float(np.corrcoef(current[valid], following[valid])[0, 1])


def to_quarterly(panel: pd.DataFrame) -> pd.DataFrame:
    """Gate 0's fallback: the same panel re-bucketed to quarters.

    Breach rate is re-averaged weighted by request count, so a quiet month does
    not carry the same weight as a busy one. The label is rebuilt from the
    coarser series rather than carried over, since "next quarter" is a different
    outcome from "next month".
    """
    panel = panel.copy()
    panel["quarter"] = panel["month"].map(lambda p: p.asfreq("Q"))
    weighted = panel.assign(_w=lambda d: d["slaBreachRate"] * d["requests"])
    grouped = weighted.groupby(["agency", "board", "quarter"], observed=True)
    coarse = grouped.agg(requests=("requests", "sum"), _weighted=("_w", "sum")).reset_index()
    coarse["slaBreachRate"] = coarse["_weighted"] / coarse["requests"]
    return coarse.rename(columns={"quarter": "month"}).drop(columns="_weighted")


def run(quarterly: bool = False) -> float:
    panel = build_panel()
    label = "monthly"
    if quarterly:
        panel = to_quarterly(panel)
        label = "quarterly"

    units = per_unit(panel)
    pooled_ac = pooled(panel)

    print(f"V4 - target persistence on the NYC 311 panel ({label} buckets)")
    print(
        f"{len(panel):,} unit-periods, {panel.groupby(['agency', 'board']).ngroups} units, "
        f"{len(units)} with >= {MIN_PERIODS} periods\n"
    )

    print(f"pooled lag-1 autocorrelation (all within-unit pairs): {pooled_ac:+.4f}")
    print(
        f"per-unit autocorrelation: median {units['persistence'].median():+.4f}, "
        f"mean {units['persistence'].mean():+.4f}, "
        f"IQR [{units['persistence'].quantile(0.25):+.4f}, "
        f"{units['persistence'].quantile(0.75):+.4f}]"
    )
    above = (units["persistence"] >= FEASIBILITY_FLOOR).mean()
    print(f"units at or above the {FEASIBILITY_FLOOR:+.2f} floor: {above:.1%}\n")

    print("for reference")
    for name, value in REFERENCE.items():
        print(f"  {name:<32}{value:+.4f}")
    print(f"  {'feasibility floor':<32}{FEASIBILITY_FLOOR:+.4f}")

    print("\nper agency")
    by_agency = units.groupby("agency")["persistence"].agg(["size", "median", "mean"])
    for agency, row in by_agency.iterrows():
        print(f"  {agency:<6}{int(row['size']):>4} units   median {row['median']:+.4f}")

    verdict = pooled_ac >= FEASIBILITY_FLOOR
    print(
        f"\nGate 0 - AR(1) >= {FEASIBILITY_FLOOR:.2f}: "
        f"{'PASS, proceed to Phase 1' if verdict else 'FAIL'}"
    )
    if not verdict:
        print(
            "  before abandoning: re-run with --quarterly, then try borough-level units.\n"
            "  Both reduce sampling noise in the breach rate, which is what suppresses\n"
            "  measured autocorrelation on thin unit-periods."
        )
    return pooled_ac


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--quarterly", action="store_true", help="Gate 0's fallback: coarser periods"
    )
    run(**vars(parser.parse_args()))
