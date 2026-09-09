"""W0.2 — does conditioning confidence on the feasible action set move the curve?

This is the kill-check for the autonomy gate paper, and it is deliberately the
cheapest possible version of the experiment. It answers one question before any
of the gate gets built:

    When a next-action predictor's confidence is renormalised over only the
    actions policy permits in the current state, does the risk-coverage curve
    move — i.e. can more work be automated at the same error rate?

If the two curves lie on top of each other there is no research result in the
gate, only a product feature, and the paper needs re-angling. Better to learn
that in a day than in week six.

Method, and why each choice is the conservative one
---------------------------------------------------
* **Counting predictor, not a neural one.** A prefix -> next-activity frequency
  table with backoff. Weytjens & Weber (BPM 2026) found counting matches
  billion-parameter models on next-activity prediction, so this is a defensible
  baseline rather than a shortcut — and the question here is about the *gap*
  between two confidence measures on the same predictor, which a stronger model
  would not change in kind.
* **Case-level temporal split.** Prefixes of one case never straddle the split,
  and the test set is the future. A prefix-level random split would leak and
  inflate everything.
* **Constraints authored from the code scheme, never mined.** See `bpic.py`. The
  feasible set consults the alphabet and the documented numbering, and no
  transition counts from any split.
* **End of case is not an action.** Decisions are scored only where a next
  activity exists. A gate that must also decide "close the case" is a harder
  problem; excluding it keeps this check comparable to the standard
  next-activity setup, and the paper should say so.

What "gated" does when the feasible set has no probability mass
--------------------------------------------------------------
The predictor may put all its mass on actions policy forbids. That is exactly
the case the gate exists to catch, so it is not swept under the carpet: the
distribution falls back to the unigram prior restricted to the feasible set, and
if even that is empty the decision is recorded with confidence 0 — never
automated, and counted as an error if the gate were forced to act. Both fallback
counts are reported.

Run:
    python -m drishti_research.feasibility_check            # municipality 1
    python -m drishti_research.feasibility_check --all      # all five
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from .bpic import (
    MUNICIPALITIES,
    FeasibilityModel,
    build_feasibility,
    load_log,
    split_by_case,
    traces,
)

RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"

#: Longest prefix the counting model conditions on before backing off.
MAX_ORDER = 4

#: Error budgets at which coverage is reported. An autonomy gate is specified as
#: "automate as much as possible while staying under this error rate", so
#: coverage at a fixed budget is the number that matters operationally.
ERROR_BUDGETS = (0.01, 0.02, 0.05, 0.10)


# --------------------------------------------------------------------------
# Counting predictor
# --------------------------------------------------------------------------


class CountingPredictor:
    """Prefix -> next-activity frequency table with backoff to shorter prefixes.

    Order-k tables are built for k = MAX_ORDER..0. At prediction time the longest
    context that was seen at least `min_support` times in training wins; failing
    all of them, the order-0 (unigram) table is used. `order_used` is returned so
    the experiment can report how often it had to back off.
    """

    def __init__(self, max_order: int = MAX_ORDER, min_support: int = 3) -> None:
        self.max_order = max_order
        self.min_support = min_support
        self.tables: list[dict[tuple[str, ...], Counter]] = [
            defaultdict(Counter) for _ in range(max_order + 1)
        ]
        self.alphabet: set[str] = set()

    def fit(self, train: dict[str, list[str]]) -> CountingPredictor:
        for trace in train.values():
            self.alphabet.update(trace)
            for index in range(len(trace) - 1):
                nxt = trace[index + 1]
                for order in range(self.max_order + 1):
                    if index + 1 < order:
                        break
                    context = tuple(trace[index + 1 - order : index + 1])
                    self.tables[order][context][nxt] += 1
        self.unigram = self.tables[0][()]
        return self

    def distribution(self, prefix: list[str]) -> tuple[dict[str, float], int]:
        """Return `(probabilities, order_used)` for the next activity after `prefix`."""
        for order in range(min(self.max_order, len(prefix)), 0, -1):
            counts = self.tables[order].get(tuple(prefix[-order:]))
            if counts and sum(counts.values()) >= self.min_support:
                total = sum(counts.values())
                return {a: c / total for a, c in counts.items()}, order

        total = sum(self.unigram.values())
        if total == 0:
            return {}, 0
        return {a: c / total for a, c in self.unigram.items()}, 0


# --------------------------------------------------------------------------
# The two confidence measures
# --------------------------------------------------------------------------


def _argmax(distribution: dict[str, float]) -> tuple[str | None, float]:
    if not distribution:
        return None, 0.0
    action = max(distribution, key=lambda a: (distribution[a], a))
    return action, distribution[action]


def gate(
    distribution: dict[str, float],
    permitted: set[str],
    unigram: dict[str, float],
) -> tuple[str | None, float, str]:
    """Renormalise `distribution` over `permitted` and take the top action.

    Returns `(action, automation_confidence, fallback)` where `fallback` is
    `"none"`, `"unigram"` (the model had no mass on any permitted action) or
    `"empty"` (nothing permitted at all — the gate cannot act).
    """
    masked = {a: p for a, p in distribution.items() if a in permitted}
    mass = sum(masked.values())
    if mass > 0:
        action, confidence = _argmax({a: p / mass for a, p in masked.items()})
        return action, confidence, "none"

    backoff = {a: p for a, p in unigram.items() if a in permitted}
    mass = sum(backoff.values())
    if mass > 0:
        action, _ = _argmax({a: p / mass for a, p in backoff.items()})
        return action, 0.0, "unigram"

    return None, 0.0, "empty"


# --------------------------------------------------------------------------
# Risk-coverage
# --------------------------------------------------------------------------


def risk_coverage(confidence: np.ndarray, correct: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Sweep the confidence threshold; return `(coverage, risk)` point by point.

    At each coverage level the automated set is the most-confident prefix of the
    decisions, and risk is the error rate inside that set — the empirical form of
    what a selective classifier promises.
    """
    order = np.argsort(-confidence, kind="stable")
    errors = (~correct[order]).astype(float)
    n = len(errors)
    coverage = np.arange(1, n + 1) / n
    risk = np.cumsum(errors) / np.arange(1, n + 1)
    return coverage, risk


def aurc(coverage: np.ndarray, risk: np.ndarray) -> float:
    """Area under the risk-coverage curve. Lower is better; 0 is a perfect gate."""
    return float(np.trapezoid(risk, coverage))


def coverage_at_error(coverage: np.ndarray, risk: np.ndarray, budget: float) -> float:
    """Largest coverage whose error rate still sits at or under `budget`."""
    within = coverage[risk <= budget]
    return float(within.max()) if within.size else 0.0


# --------------------------------------------------------------------------
# The experiment
# --------------------------------------------------------------------------


@dataclass
class Decisions:
    """One row per test-set decision point, under both confidence measures."""

    raw_action: list[str] = field(default_factory=list)
    raw_confidence: list[float] = field(default_factory=list)
    gated_action: list[str] = field(default_factory=list)
    gated_confidence: list[float] = field(default_factory=list)
    truth: list[str] = field(default_factory=list)
    raw_argmax_infeasible: list[bool] = field(default_factory=list)
    truth_infeasible: list[bool] = field(default_factory=list)
    fallback: list[str] = field(default_factory=list)
    permitted_size: list[int] = field(default_factory=list)
    order_used: list[int] = field(default_factory=list)

    def frame(self) -> pd.DataFrame:
        return pd.DataFrame(self.__dict__)


def collect(
    predictor: CountingPredictor,
    feasibility: FeasibilityModel,
    test: dict[str, list[str]],
) -> pd.DataFrame:
    rows = Decisions()
    unigram_total = sum(predictor.unigram.values())
    unigram = {a: c / unigram_total for a, c in predictor.unigram.items()}

    for trace in test.values():
        for index in range(len(trace) - 1):
            prefix = trace[: index + 1]
            truth = trace[index + 1]

            distribution, order = predictor.distribution(prefix)
            permitted = feasibility.feasible_actions(prefix)

            raw_action, raw_confidence = _argmax(distribution)
            gated_action, gated_confidence, fallback = gate(distribution, permitted, unigram)

            rows.raw_action.append(raw_action or "")
            rows.raw_confidence.append(raw_confidence)
            rows.gated_action.append(gated_action or "")
            rows.gated_confidence.append(gated_confidence)
            rows.truth.append(truth)
            rows.raw_argmax_infeasible.append(raw_action is not None and raw_action not in permitted)
            rows.truth_infeasible.append(truth not in permitted)
            rows.fallback.append(fallback)
            rows.permitted_size.append(len(permitted))
            rows.order_used.append(order)

    return rows.frame()


def evaluate(decisions: pd.DataFrame) -> dict[str, float]:
    truth = decisions["truth"].to_numpy()
    raw_correct = decisions["raw_action"].to_numpy() == truth
    gated_correct = decisions["gated_action"].to_numpy() == truth

    raw_cov, raw_risk = risk_coverage(decisions["raw_confidence"].to_numpy(), raw_correct)
    gated_cov, gated_risk = risk_coverage(decisions["gated_confidence"].to_numpy(), gated_correct)

    summary: dict[str, float] = {
        "decisions": float(len(decisions)),
        "raw_accuracy": float(raw_correct.mean()),
        "gated_accuracy": float(gated_correct.mean()),
        "raw_aurc": aurc(raw_cov, raw_risk),
        "gated_aurc": aurc(gated_cov, gated_risk),
        "raw_argmax_infeasible_rate": float(decisions["raw_argmax_infeasible"].mean()),
        "truth_infeasible_rate": float(decisions["truth_infeasible"].mean()),
        "mean_permitted_size": float(decisions["permitted_size"].mean()),
        "unigram_fallback_rate": float((decisions["fallback"] == "unigram").mean()),
        "empty_feasible_rate": float((decisions["fallback"] == "empty").mean()),
    }

    # The honest cost of masking: what the gate does on the decisions where the
    # activity that actually happened was not permitted at all.
    deviating = decisions["truth_infeasible"].to_numpy()
    summary["raw_accuracy_on_deviating"] = (
        float(raw_correct[deviating].mean()) if deviating.any() else float("nan")
    )
    summary["gated_accuracy_on_deviating"] = (
        float(gated_correct[deviating].mean()) if deviating.any() else float("nan")
    )
    summary["raw_accuracy_on_conforming"] = float(raw_correct[~deviating].mean())
    summary["gated_accuracy_on_conforming"] = float(gated_correct[~deviating].mean())

    for budget in ERROR_BUDGETS:
        summary[f"raw_coverage@{budget:g}"] = coverage_at_error(raw_cov, raw_risk, budget)
        summary[f"gated_coverage@{budget:g}"] = coverage_at_error(gated_cov, gated_risk, budget)

    summary["_curves"] = (raw_cov, raw_risk, gated_cov, gated_risk)  # type: ignore[assignment]
    return summary


def plot(summary: dict, label: str, path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    raw_cov, raw_risk, gated_cov, gated_risk = summary["_curves"]

    figure, axis = plt.subplots(figsize=(6.4, 4.4))
    axis.plot(raw_cov, raw_risk, label=f"raw  (AURC {summary['raw_aurc']:.4f})", lw=1.8)
    axis.plot(
        gated_cov,
        gated_risk,
        label=f"feasibility-gated  (AURC {summary['gated_aurc']:.4f})",
        lw=1.8,
    )
    for budget in (0.05,):
        axis.axhline(budget, color="0.6", lw=0.8, ls="--")
        axis.annotate(f"{budget:.0%} error budget", (0.01, budget + 0.004), fontsize=8, color="0.4")

    axis.set_xlabel("coverage — fraction of decisions automated")
    axis.set_ylabel("risk — error rate among automated decisions")
    axis.set_title(f"BPIC 2015 · {label}: risk-coverage")
    axis.set_xlim(0, 1)
    axis.set_ylim(0, max(raw_risk.max(), gated_risk.max()) * 1.05)
    axis.legend(loc="upper left", frameon=False, fontsize=9)
    figure.tight_layout()
    figure.savefig(path, dpi=160)
    plt.close(figure)


def _fit(
    train: dict[str, list[str]],
    test: dict[str, list[str]],
    *,
    strict: bool,
    label: str,
    quiet: bool,
) -> dict[str, float]:
    predictor = CountingPredictor().fit(train)
    feasibility = build_feasibility(train, strict=strict)

    decisions = collect(predictor, feasibility, test)
    summary = evaluate(decisions)
    summary["train_cases"] = float(len(train))
    summary["test_cases"] = float(len(test))
    summary["alphabet"] = float(len(feasibility.alphabet))

    if not quiet:
        _report(summary, label, strict)
    return summary


def run(municipality: int, *, strict: bool = True, quiet: bool = False) -> dict[str, float]:
    """In-distribution: train and test on the same municipality, split by time."""
    frame = load_log(municipality)
    train, test = split_by_case(frame, test_fraction=0.3, temporal=True)
    summary = _fit(train, test, strict=strict, label=f"municipality {municipality}", quiet=quiet)
    summary["municipality"] = float(municipality)
    return summary


def run_transfer(
    train_municipality: int, test_municipality: int, *, strict: bool = True, quiet: bool = False
) -> dict[str, float]:
    """Cross-municipality: the deployment case, and the fair test of the idea.

    In-distribution, a counting model fitted to a municipality's own history has
    already absorbed that municipality's constraints from the data, so masking
    has nothing left to remove. The situation an autonomy gate is actually built
    for is the other one: a process the model has not seen enough of, where the
    authored constraints still hold because they come from the code scheme rather
    than from the log. Training on one municipality and testing on another is the
    cheapest honest version of that.
    """
    train = traces(load_log(train_municipality))
    test = traces(load_log(test_municipality))
    summary = _fit(
        train,
        test,
        strict=strict,
        label=f"train m{train_municipality} -> test m{test_municipality}",
        quiet=quiet,
    )
    summary["municipality"] = float(test_municipality)
    summary["train_municipality"] = float(train_municipality)
    return summary


def run_scarce(
    municipality: int, fraction: float, *, strict: bool = True, quiet: bool = False
) -> dict[str, float]:
    """Data scarcity: the same split, but with only the first `fraction` of training cases.

    A newly onboarded unit has months of history, not years. If feasibility
    conditioning is worth anything it should show up here.
    """
    frame = load_log(municipality)
    train, test = split_by_case(frame, test_fraction=0.3, temporal=True)
    keep = max(1, int(len(train) * fraction))
    trimmed = dict(list(train.items())[-keep:])
    summary = _fit(
        trimmed,
        test,
        strict=strict,
        label=f"municipality {municipality}, {fraction:.0%} of training history",
        quiet=quiet,
    )
    summary["municipality"] = float(municipality)
    summary["train_fraction"] = fraction
    return summary


def _report(summary: dict, label: str, strict: bool) -> None:
    mode = "strict (subprocess + ordering)" if strict else "loose (subprocess only)"
    print(f"\n--- {label} · constraints: {mode} ---")
    print(
        f"{int(summary['train_cases'])} train cases / {int(summary['test_cases'])} test cases, "
        f"{int(summary['decisions'])} decisions, alphabet {int(summary['alphabet'])}"
    )
    print(
        f"mean permitted set: {summary['mean_permitted_size']:.0f} of "
        f"{int(summary['alphabet'])} activities "
        f"({summary['mean_permitted_size'] / summary['alphabet']:.0%} of the alphabet)"
    )
    print()
    print(f"{'':<34}{'raw':>10}{'gated':>10}{'delta':>10}")
    for label, key in (
        ("accuracy (full coverage)", "accuracy"),
        ("AURC (lower is better)", "aurc"),
    ):
        raw, gated = summary[f"raw_{key}"], summary[f"gated_{key}"]
        print(f"{label:<34}{raw:>10.4f}{gated:>10.4f}{gated - raw:>+10.4f}")
    for budget in ERROR_BUDGETS:
        raw = summary[f"raw_coverage@{budget:g}"]
        gated = summary[f"gated_coverage@{budget:g}"]
        print(f"{f'coverage at {budget:.0%} error':<34}{raw:>10.4f}{gated:>10.4f}{gated - raw:>+10.4f}")
    print()
    print(f"raw argmax was infeasible on        {summary['raw_argmax_infeasible_rate']:.1%} of decisions")
    print(f"true next action was infeasible on  {summary['truth_infeasible_rate']:.1%} of decisions")
    print(
        f"  accuracy on those deviating decisions   raw {summary['raw_accuracy_on_deviating']:.4f}"
        f"   gated {summary['gated_accuracy_on_deviating']:.4f}   <- the cost of masking"
    )
    print(
        f"  accuracy on conforming decisions        raw {summary['raw_accuracy_on_conforming']:.4f}"
        f"   gated {summary['gated_accuracy_on_conforming']:.4f}"
    )
    print(
        f"gate fell back to the unigram prior on {summary['unigram_fallback_rate']:.1%}; "
        f"nothing permitted on {summary['empty_feasible_rate']:.1%}"
    )


def verdict(summary: dict) -> str:
    """One line: are the two curves meaningfully separated?"""
    delta_aurc = summary["raw_aurc"] - summary["gated_aurc"]
    delta_cov = summary["gated_coverage@0.05"] - summary["raw_coverage@0.05"]
    relative = delta_aurc / summary["raw_aurc"] if summary["raw_aurc"] else 0.0

    if delta_aurc <= 0:
        return (
            f"VERDICT: no separation — gating did not reduce AURC "
            f"({delta_aurc:+.4f}). The gate is a product feature, not a result."
        )
    if relative < 0.02 and abs(delta_cov) < 0.02:
        return (
            f"VERDICT: curves effectively overlap — AURC {relative:.1%} better, "
            f"coverage at 5% error {delta_cov:+.1%}. Re-angle paper 2."
        )
    return (
        f"VERDICT: curves separate — AURC {relative:.1%} lower under gating, and "
        f"coverage at a 5% error budget moves {summary['raw_coverage@0.05']:.1%} "
        f"-> {summary['gated_coverage@0.05']:.1%} ({delta_cov:+.1%}). Paper 2 has a result."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--municipality", type=int, default=1, choices=MUNICIPALITIES)
    parser.add_argument("--all", action="store_true", help="run every municipality")
    parser.add_argument(
        "--transfer",
        action="store_true",
        help="train on one municipality and test on the next — the deployment case",
    )
    parser.add_argument(
        "--scarce",
        type=float,
        default=None,
        metavar="FRACTION",
        help="keep only this fraction of the training history (e.g. 0.1)",
    )
    parser.add_argument(
        "--loose",
        action="store_true",
        help="ablation: constrain by subprocess membership only, dropping the ordering rule",
    )
    args = parser.parse_args()

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    strict = not args.loose
    suffix = "" if strict else "-loose"

    if args.transfer:
        mode, pairs = "transfer", [(m, m % 5 + 1) for m in (MUNICIPALITIES if args.all else (args.municipality,))]
        runs = [(f"m{a}-to-m{b}", lambda a=a, b=b: run_transfer(a, b, strict=strict)) for a, b in pairs]
    elif args.scarce is not None:
        mode = f"scarce{args.scarce:g}"
        targets = MUNICIPALITIES if args.all else (args.municipality,)
        runs = [(f"m{m}", lambda m=m: run_scarce(m, args.scarce, strict=strict)) for m in targets]
    else:
        mode = "indist"
        targets = MUNICIPALITIES if args.all else (args.municipality,)
        runs = [(f"m{m}", lambda m=m: run(m, strict=strict)) for m in targets]

    summaries = []
    for name, thunk in runs:
        summary = thunk()
        plot(summary, name, RESULTS_DIR / f"w02-risk-coverage-{mode}-{name}{suffix}.png")
        print()
        print(verdict(summary))
        summaries.append({k: v for k, v in summary.items() if not k.startswith("_")})

    table = pd.DataFrame(summaries)
    out = RESULTS_DIR / f"w02-feasibility-{mode}{suffix}.csv"
    table.to_csv(out, index=False)
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
