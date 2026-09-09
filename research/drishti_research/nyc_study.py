"""V5 — the interpretability comparison, re-run on NYC 311.

    python -m drishti_research.nyc_study

The same question the study has asked on three panels now: does keeping a
governance risk score interpretable cost accuracy against a fitted model, and
does tuning its weights close the gap? What changes here is the panel, and the
change is the point.

What this arm fixes
-------------------
BPIC 2018 reported no replication, and the honest reading of that arm was never
"the effect is absent" but "this panel could not have found it". Its minimum
detectable gap was 0.0655 against an effect measured at 0.0553: the experiment
was underpowered for the hypothesis it was testing, and reporting the null was
reporting the sample size (N3).

The NYC panel is roughly ten times larger and, unlike either BPIC log, it is
literally the system under study — a municipal complaint desk, with the five
signals read off the same quantities ``riskSignals.ts`` computes in production.
If the interpretability result holds here, it holds on the domain the paper is
about, at a sample size that could have refuted it.

What still limits it
--------------------
**No Bayes ceiling.** Real data, so the achievable separation is unknown and raw
AUC is all there is. The best AUC any model reaches is reported as a lower bound
on the ceiling and is not more than that.

**One city, one borough.** Every unit here shares a municipal administration, so
this is not evidence about municipal risk scoring in general. N4's Chicago and
Boston arms are what would make it that.

**The label's threshold is derived.** ``slaBreachRate`` is defined against an SLA
this project derived from the corpus, because NYC publishes no deadline for these
complaint types (V1, and the declaration in ``nyc_sla``). Every model is scored
against the same derived target, so the comparison is unaffected — but the
absolute numbers are about a relative-performance target, not a statutory one.

Splits are grouped by unit
--------------------------
A board's months are strongly autocorrelated, so a random split would put month
``m`` in training and ``m+1`` in test for the same board and inflate every model
at once. Every split holds all of a unit's months on one side, exactly as the
BPIC arms do.
"""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedGroupKFold

from .bpic_study import (
    N_BOOTSTRAP,
    build_logistic,
    small_data_black_box,
    small_data_forest,
)
from .model_spec import load_spec
from .models import InterpretableScorer
from .nyc_signals import FEATURE_KEYS, build_panel, feature_matrix
from .tuning import tune_weights

RESULTS = Path(__file__).resolve().parents[1] / "results"
OUTPUT = RESULTS / "nyc-interpretability.csv"

#: GRIE's factor set for the level at which work is held. A community board is
#: the NYC unit closest to a NOIDA sector: the smallest area with a named
#: administrative identity that complaints are actually attributed to.
ENTITY_TYPE = "SECTOR"

N_SPLITS = 5

#: Five repeats, not the BPIC arms' ten. Each repeat runs a nested grid search
#: over a panel an order of magnitude larger, and the fold-to-fold spread on
#: 2,000 rows is small enough that five repeats already pins the mean tighter
#: than ten did on 268.
N_REPEATS = 5

SEED = 20260910

LABELS = {
    "grie": "GRIE (hand-specified)",
    "grie_tuned": "GRIE (tuned weights)",
    "logistic": "logistic regression",
    "gbm": "gradient boosting",
    "rf": "random forest",
}


def _fold_scores(
    X: pd.DataFrame, y: np.ndarray, groups: np.ndarray, seed: int
) -> tuple[pd.DataFrame, dict[str, np.ndarray]]:
    """One repeat of grouped stratified k-fold. Per-fold AUCs and out-of-fold scores."""
    spec = load_spec()
    splitter = StratifiedGroupKFold(n_splits=N_SPLITS, shuffle=True, random_state=seed)

    oof = {name: np.full(len(y), np.nan) for name in LABELS}
    rows = []

    for fold, (train_idx, test_idx) in enumerate(splitter.split(X, y, groups)):
        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]
        groups_train = groups[train_idx]

        if len(np.unique(y_test)) < 2:
            continue

        grie = InterpretableScorer(spec, ENTITY_TYPE)
        tuned = tune_weights(spec, ENTITY_TYPE, X_train, y_train, seed=seed).weights
        grie_tuned = InterpretableScorer(spec, ENTITY_TYPE, weights=tuned)

        scores = {
            "grie": (grie.predict_proba(X_test)[:, 1], grie.predict_proba(X_train)[:, 1]),
            "grie_tuned": (
                grie_tuned.predict_proba(X_test)[:, 1],
                grie_tuned.predict_proba(X_train)[:, 1],
            ),
        }
        for name, builder in (
            ("logistic", build_logistic),
            ("gbm", small_data_black_box),
            ("rf", small_data_forest),
        ):
            estimator = builder(seed)
            fit_kwargs = {"groups": groups_train} if isinstance(estimator, GridSearchCV) else {}
            model = estimator.fit(X_train, y_train, **fit_kwargs)
            scores[name] = (
                model.predict_proba(X_test)[:, 1],
                model.predict_proba(X_train)[:, 1],
            )

        for name, (test_scores, train_scores) in scores.items():
            oof[name][test_idx] = test_scores
            rows.append(
                {
                    "seed": seed,
                    "fold": fold,
                    "model": name,
                    "test_auc": roc_auc_score(y_test, test_scores),
                    "train_auc": roc_auc_score(y_train, train_scores),
                }
            )

    return pd.DataFrame(rows), oof


def _bootstrap_gap(
    y: np.ndarray, a: np.ndarray, b: np.ndarray, rng: np.random.Generator
) -> tuple[float, float, float]:
    """Paired bootstrap interval on AUC(a) - AUC(b), resampling unit-periods."""
    valid = ~(np.isnan(a) | np.isnan(b))
    y, a, b = y[valid], a[valid], b[valid]
    point = roc_auc_score(y, a) - roc_auc_score(y, b)

    draws = []
    for _ in range(N_BOOTSTRAP):
        idx = rng.integers(0, len(y), len(y))
        if len(np.unique(y[idx])) < 2:
            continue
        draws.append(roc_auc_score(y[idx], a[idx]) - roc_auc_score(y[idx], b[idx]))
    low, high = np.percentile(draws, [2.5, 97.5])
    return point, float(low), float(high)


def run() -> pd.DataFrame:
    panel = build_panel()
    X = feature_matrix(panel)
    y = panel["failed"].to_numpy()
    groups = (panel["agency"].astype(str) + "/" + panel["board"].astype(str)).to_numpy()

    print("V5 - NYC 311 interpretability arm")
    print(
        f"{len(panel):,} unit-months, {len(np.unique(groups))} units, {y.mean():.1%} positive "
        f"(next-month breach rate at or above the "
        f"{panel.attrs['label_quantile']:.0%} quantile, {panel.attrs['label_cutoff']:.3f})"
    )
    print(f"{N_REPEATS} repeats of {N_SPLITS}-fold, grouped by unit so no board straddles a split\n")

    all_folds = []
    accumulator: dict[str, list[np.ndarray]] = {}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for repeat in range(N_REPEATS):
            folds, oof = _fold_scores(X, y, groups, seed=SEED + repeat)
            all_folds.append(folds)
            for name, values in oof.items():
                accumulator.setdefault(name, []).append(values)
            print(f"  repeat {repeat + 1}/{N_REPEATS} done", flush=True)

    folds = pd.concat(all_folds, ignore_index=True)
    summary = (
        folds.groupby("model")
        .agg(
            test_auc=("test_auc", "mean"),
            test_sd=("test_auc", "std"),
            train_auc=("train_auc", "mean"),
        )
        .assign(overfit=lambda d: d["train_auc"] - d["test_auc"])
        .sort_values("test_auc", ascending=False)
    )

    print(f"\n{'model':<26}{'test AUC':>10}{'sd':>8}{'train AUC':>11}{'overfit':>9}")
    for name, row in summary.iterrows():
        print(
            f"{LABELS[name]:<26}{row['test_auc']:>10.4f}{row['test_sd']:>8.4f}"
            f"{row['train_auc']:>11.4f}{row['overfit']:>+9.4f}"
        )

    oof_mean = {name: np.nanmean(np.vstack(v), axis=0) for name, v in accumulator.items()}
    rng = np.random.default_rng(SEED)

    print(f"\npaired bootstrap on the AUC gap ({N_BOOTSTRAP:,} resamples of the panel)")
    gaps = []
    for challenger in ("grie", "grie_tuned", "logistic"):
        for control in ("gbm", "rf"):
            point, low, high = _bootstrap_gap(y, oof_mean[challenger], oof_mean[control], rng)
            verdict = (
                "no detectable difference"
                if low < 0 < high
                else ("ahead" if point > 0 else "behind")
            )
            gaps.append(
                {
                    "challenger": challenger,
                    "control": control,
                    "gap": point,
                    "ci_low": low,
                    "ci_high": high,
                    "verdict": verdict,
                }
            )
            print(
                f"  {LABELS[challenger]:<24} vs {LABELS[control]:<20}"
                f"{point:>+8.4f}  [{low:+.4f}, {high:+.4f}]  {verdict}"
            )

    # Gate 0's last condition: something has to beat chance, or this corpus is
    # BPIC 2018 again and no amount of application code fixes that.
    best = summary["test_auc"].max()
    best_name = summary["test_auc"].idxmax()
    chance_gap, chance_low, _ = _bootstrap_gap(
        y, oof_mean[best_name], np.full(len(y), 0.5), rng
    )
    print(
        f"\nbest model: {LABELS[best_name]} at {best:.4f} "
        f"(lower bound on the achievable ceiling, nothing more)"
    )
    print(
        f"Gate 0 - any model beats chance (CI lower > 0.5): "
        f"{'PASS' if 0.5 + chance_low > 0.5 else 'FAIL'} "
        f"- best AUC CI lower bound {0.5 + chance_low:.4f}"
    )

    RESULTS.mkdir(parents=True, exist_ok=True)
    output = summary.reset_index().assign(panel="NYC 311 Brooklyn", rows=len(panel))
    output.to_csv(OUTPUT, index=False)
    pd.DataFrame(gaps).to_csv(RESULTS / "nyc-interpretability-gaps.csv", index=False)
    print(f"\nwritten to {OUTPUT.name} and nyc-interpretability-gaps.csv")
    return summary


if __name__ == "__main__":
    run()
