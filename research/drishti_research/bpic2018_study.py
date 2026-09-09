"""The interpretability comparison, re-run on BPI Challenge 2018.

    python -m drishti_research.bpic2018_study

What this is for
----------------
The BPIC 2015 arm answers "is a hand-specified interpretable model competitive
with fitted black boxes on real governance data?" with five Dutch municipalities
that share a code scheme, a regulator and a process design. That is one system
observed five times. This re-runs the identical comparison on a different
country, agency, domain and decade of software, and it is the only evidence in
the study that the finding is not a fact about Dutch building permits.

Everything except the panel is held fixed on purpose: the same fold routine, the
same five models, the same grouped stratified splits, the same bootstrap. The
weight vector is the shipped one, unchanged and unfitted, exactly as in the
other arm. If the result differs, the panel is the only thing that differs.

What would count as a failure
-----------------------------
GRIE losing here is a publishable outcome and the paper reports it either way.
It would say the in-distribution advantage is a property of permit-office data
rather than of hand-specified models, which is a materially weaker claim than
the one currently drafted — and finding that out before submission is the entire
reason this arm exists.

This is a harder panel than BPIC 2015 and that is expected rather than
concerning. The strongest single feature correlates with the label at +0.12,
against far more in the permit data. Absolute AUCs near 0.6 are the realistic
range; what matters is the *ordering* and whether the interval on the gap
excludes zero.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from .bpic2018_signals import FEATURE_KEYS, build_panel
from .bpic_study import _bootstrap_gap, _fold_scores

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "research" / "results"

#: Repeats of the whole grouped k-fold, to average over split luck.
SEEDS = [11, 23, 37, 41, 53]

LABELS = {
    "grie": "GRIE (hand-specified)",
    "grie_tuned": "GRIE (tuned)",
    "logistic": "Logistic regression",
    "gbm": "Gradient boosting",
    "rf": "Random forest",
}


def run() -> tuple[pd.DataFrame, dict[str, np.ndarray], np.ndarray]:
    panel = build_panel()
    X = panel[FEATURE_KEYS].astype(float)
    y = panel["failed"].to_numpy()
    # Grouped by case worker, so no unit's quarters straddle a fold. Without
    # this a model can memorise a worker in training and meet them in test.
    groups = panel["unit"].to_numpy()

    frames = []
    pooled: dict[str, list[np.ndarray]] = {name: [] for name in LABELS}

    for seed in SEEDS:
        rows, oof = _fold_scores(X, y, groups, seed)
        frames.append(rows)
        for name, scores in oof.items():
            pooled[name].append(scores)

    # Out-of-fold scores averaged across repeats: every row is scored by a model
    # that never saw it, in every repeat.
    averaged = {name: np.nanmean(np.vstack(v), axis=0) for name, v in pooled.items()}
    return pd.concat(frames, ignore_index=True), averaged, y


def _auc_interval(
    y: np.ndarray, scores: np.ndarray, rng: np.random.Generator, draws: int = 2000
) -> tuple[float, float]:
    """Bootstrap interval on a single model's AUC, for comparison against 0.5."""
    out = []
    for _ in range(draws):
        idx = rng.integers(0, len(y), len(y))
        if len(np.unique(y[idx])) < 2:
            continue
        out.append(roc_auc_score(y[idx], scores[idx]))
    low, high = np.percentile(out, [2.5, 97.5])
    return float(low), float(high)


def report(folds: pd.DataFrame, oof: dict[str, np.ndarray], y: np.ndarray) -> None:
    print("--- BPIC 2018: interpretable vs fitted ---")
    print(f"    {folds.seed.nunique()} repeats x {folds.fold.nunique()} folds, "
          f"{len(y)} unit-quarters, {y.mean():.1%} positive\n")

    print(f"  {'model':<24}{'mean AUC':>10}{'sd':>8}{'train':>9}")
    means = {}
    for name, label in LABELS.items():
        g = folds[folds.model == name]
        if g.empty:
            continue
        means[name] = g.test_auc.mean()
        print(f"  {label:<24}{g.test_auc.mean():>10.4f}{g.test_auc.std():>8.4f}"
              f"{g.train_auc.mean():>9.4f}")

    print("\n  pooled out-of-fold AUC:")
    pooled = {}
    for name, label in LABELS.items():
        valid = ~np.isnan(oof[name])
        pooled[name] = roc_auc_score(y[valid], oof[name][valid])
        print(f"    {label:<24}{pooled[name]:>8.4f}")

    rng = np.random.default_rng(20260910)
    print("\n  gap against GRIE, bootstrapped over unit-quarters:")
    for name in ("gbm", "rf", "logistic", "grie_tuned"):
        point, low, high = _bootstrap_gap(y, oof["grie"], oof[name], rng)
        excludes = "excludes 0" if low > 0 or high < 0 else "contains 0"
        print(f"    GRIE - {LABELS[name]:<22}{point:+.4f}  "
              f"[{low:+.4f}, {high:+.4f}]  {excludes}")

    # Whether any model beats chance decides how the arm may be described. A
    # panel nothing can predict does not rank models; reporting "GRIE lost"
    # from it would be as wrong as reporting that it won.
    print("\n  against chance:")
    learnable = []
    for name, label in LABELS.items():
        valid = ~np.isnan(oof[name])
        lo, hi = _auc_interval(y[valid], oof[name][valid], rng)
        beats = lo > 0.5
        learnable.append(beats)
        print(f"    {label:<24}{pooled[name]:>8.4f}  [{lo:.4f}, {hi:.4f}]  "
              f"{'above chance' if beats else 'indistinguishable from chance'}")

    print()
    gap_excludes_zero = any(
        _bootstrap_gap(y, oof["grie"], oof[name], np.random.default_rng(20260910))[1] > 0
        or _bootstrap_gap(y, oof["grie"], oof[name], np.random.default_rng(20260910))[2] < 0
        for name in ("gbm", "rf", "logistic")
    )

    if not any(learnable):
        print("  NOTHING beats chance on this panel. The arm cannot rank models at")
        print("  all: report it as an inconclusive replication, not as a defeat.")
    elif not gap_excludes_zero:
        print("  NO SEPARATION between any pair of models — every interval on every")
        print("  gap contains zero. The BPIC 2015 advantage is NOT reproduced here,")
        print("  and neither is its reverse. The paper must say the advantage is")
        print("  demonstrated in one process family and did not replicate in a")
        print("  second where the task is close to unlearnable. That is weaker than")
        print("  the drafted claim and it is the claim the evidence supports.")
    elif pooled["grie"] > pooled["gbm"]:
        print("  The ordering HOLDS on a second, independent organisation.")
        print("  The finding is not a property of Dutch building-permit data.")
    else:
        print("  The ordering REVERSES here, and the gap excludes zero. The BPIC 2015")
        print("  result is specific to that process family; narrow the claim to match.")


def main() -> None:
    folds, oof, y = run()
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / "bpic2018-interpretability.csv"
    folds.to_csv(out, index=False)
    report(folds, oof, y)
    print(f"\n  wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
