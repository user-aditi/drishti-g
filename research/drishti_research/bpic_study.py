"""W0.1 — the interpretability comparison, re-run on BPI Challenge 2015.

The constructed-data study in `experiments.py` asks whether keeping a governance
risk score interpretable costs accuracy against a black box, and whether weight
tuning closes the gap. This module asks the same question of the same model on
**real municipal data**, and it is the arm that decides whether paper 1 is
publishable or merely internally interesting.

Three things differ from the constructed study, and each one weakens what can be
claimed. All three belong in the paper's method section rather than a footnote.

**There is no Bayes ceiling.** On generated data the ceiling is known, so results
can be reported as *skill* — the fraction of achievable separation a model
captured — and a 0.005 AUC difference can be shown to be large. Here the ceiling
is unknowable, so raw AUC is all there is, and a small gap cannot be argued up
into a large one. Reported alongside it is the best AUC any model reached, which
is a lower bound on the ceiling and nothing more.

**The panel is small.** 268 unit-periods after filtering, against thousands in
the constructed study. Every number therefore carries a bootstrap interval, and
a gap whose interval spans zero is reported as "no detectable difference" rather
than as a win for either side.

**Splits are grouped by case worker.** A worker's quarters are strongly
autocorrelated, so a plain random split would put quarter `q` in training and
quarter `q+1` in test for the same person and quietly inflate everything. Every
split here holds all of a worker's periods on one side.

Run with:  python -m drishti_research.bpic_study
"""

from __future__ import annotations

import argparse
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedGroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .bpic_signals import FEATURE_KEYS, build_panel, feature_matrix
from .model_spec import load_spec
from .models import InterpretableScorer
from .tuning import tune_weights

RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"

#: GRIE's factor set for the level at which work is actually held.
ENTITY_TYPE = "SECTOR"

N_SPLITS = 5
N_REPEATS = 10
N_BOOTSTRAP = 2000
SEED = 20260909


#: Capacity grids for the black boxes.
#:
#: `models.build_black_box` is configured for the constructed study's thousands
#: of rows. At n~200 per training fold a fixed configuration is a coin flip
#: between two failure modes, and the first run of this module hit one of them:
#: gradient boosting overfit by +0.16 AUC and the random forest by +0.11, so the
#: interpretable model "won" against models that had memorised their fold —
#: precisely mistake 1 from the constructed study's README, recurring on real
#: data.
#:
#: The fix is not to guess a smaller configuration, which would invite the
#: opposite criticism. Capacity is selected per training fold by an inner
#: cross-validation, so the black box gets the best configuration the training
#: data itself supports and neither straw-man nor memorisation is on the table.
#: The overfit gap is still reported every run, because the selection can fail.
GBM_GRID = {
    "clf__max_iter": [50, 200],
    "clf__learning_rate": [0.05],
    "clf__max_leaf_nodes": [2, 4],
    "clf__min_samples_leaf": [10, 25],
    "clf__l2_regularization": [1.0, 10.0],
}

FOREST_GRID = {
    "clf__min_samples_leaf": [5, 15, 30],
    "clf__max_features": ["sqrt", None],
}

#: Inner folds for capacity selection. Three, not five: the training fold is
#: already small and an inner fold needs both classes present.
#:
#: The inner splitter is grouped by case worker, exactly like the outer one.
#: With ungrouped inner folds the search rewards configurations that exploit a
#: worker's quarter-to-quarter autocorrelation — the same worker appearing on
#: both sides of a validation split — and those configurations then fail on the
#: grouped outer test fold. That showed up directly: ungrouped selection left
#: the black boxes overfitting by +0.08 to +0.10 AUC.
INNER_SPLITS = 3


def _search(base: Pipeline, grid: dict, seed: int) -> GridSearchCV:
    return GridSearchCV(
        base,
        grid,
        scoring="roc_auc",
        cv=StratifiedGroupKFold(n_splits=INNER_SPLITS, shuffle=True, random_state=seed),
        n_jobs=-1,
    )


def small_data_black_box(seed: int) -> GridSearchCV:
    base = Pipeline(
        [
            (
                "clf",
                HistGradientBoostingClassifier(
                    max_depth=3, early_stopping=False, random_state=seed
                ),
            )
        ]
    )
    return _search(base, GBM_GRID, seed)


def small_data_forest(seed: int) -> GridSearchCV:
    base = Pipeline(
        [("clf", RandomForestClassifier(n_estimators=300, n_jobs=1, random_state=seed))]
    )
    return _search(base, FOREST_GRID, seed)


def build_logistic(seed: int) -> Pipeline:
    return Pipeline(
        [("scale", StandardScaler()), ("clf", LogisticRegression(max_iter=2000, random_state=seed))]
    )


def _fold_scores(
    X: pd.DataFrame,
    y: np.ndarray,
    groups: np.ndarray,
    seed: int,
) -> tuple[pd.DataFrame, dict[str, np.ndarray]]:
    """One repeat of grouped stratified k-fold. Returns per-fold AUCs and out-of-fold scores."""
    spec = load_spec()
    splitter = StratifiedGroupKFold(n_splits=N_SPLITS, shuffle=True, random_state=seed)

    oof = {name: np.full(len(y), np.nan) for name in ("grie", "grie_tuned", "logistic", "gbm", "rf")}
    rows = []

    for fold, (train_idx, test_idx) in enumerate(splitter.split(X, y, groups)):
        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]
        groups_train = groups[train_idx]

        if len(np.unique(y_test)) < 2:
            continue  # a fold with one class cannot produce an AUC

        grie = InterpretableScorer(spec, ENTITY_TYPE)
        tuned_weights = tune_weights(spec, ENTITY_TYPE, X_train, y_train, seed=seed).weights
        grie_tuned = InterpretableScorer(spec, ENTITY_TYPE, weights=tuned_weights)

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
    """Bootstrap interval on AUC(a) − AUC(b), resampling unit-periods.

    Paired on the same rows, so the interval reflects the difference between two
    models on one panel rather than two independent estimates.
    """
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


def run(bucket_note: str = "") -> None:
    panel = build_panel()
    X = feature_matrix(panel)
    y = panel["failed"].to_numpy()
    groups = (panel["municipality"].astype(str) + "/" + panel["owner"].astype(str)).to_numpy()

    print(f"BPIC 2015 - GRIE interpretability arm{bucket_note}")
    print(
        f"{len(panel)} unit-periods, {len(np.unique(groups))} case workers, "
        f"{y.mean():.1%} positive "
        f"(next-quarter breach rate at or above the {panel.attrs['label_quantile']:.0%} "
        f"quantile, {panel.attrs['label_cutoff']:.3f})"
    )
    print(f"{N_REPEATS} repeats of {N_SPLITS}-fold, grouped by case worker so no worker straddles a split")

    all_folds = []
    oof_accumulator: dict[str, list[np.ndarray]] = {}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for repeat in range(N_REPEATS):
            folds, oof = _fold_scores(X, y, groups, seed=SEED + repeat)
            all_folds.append(folds)
            for name, values in oof.items():
                oof_accumulator.setdefault(name, []).append(values)

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

    labels = {
        "grie": "GRIE (hand-specified)",
        "grie_tuned": "GRIE (tuned weights)",
        "logistic": "logistic regression",
        "gbm": "gradient boosting",
        "rf": "random forest",
    }

    print()
    print(f"{'model':<26}{'test AUC':>10}{'sd':>8}{'train AUC':>11}{'overfit':>9}")
    for name, row in summary.iterrows():
        print(
            f"{labels[name]:<26}{row['test_auc']:>10.4f}{row['test_sd']:>8.4f}"
            f"{row['train_auc']:>11.4f}{row['overfit']:>+9.4f}"
        )

    # Averaged out-of-fold scores give one ranking per model over the whole
    # panel, which is what the paired bootstrap needs.
    oof_mean = {name: np.nanmean(np.vstack(v), axis=0) for name, v in oof_accumulator.items()}
    rng = np.random.default_rng(SEED)

    print()
    print("paired bootstrap on the AUC gap (2,000 resamples of the panel)")
    for challenger in ("grie", "grie_tuned", "logistic"):
        for control in ("gbm", "rf"):
            point, low, high = _bootstrap_gap(y, oof_mean[challenger], oof_mean[control], rng)
            verdict = "no detectable difference" if low < 0 < high else (
                "ahead" if point > 0 else "behind"
            )
            print(
                f"  {labels[challenger]:<24} vs {labels[control]:<20}"
                f"{point:>+8.4f}  [{low:+.4f}, {high:+.4f}]  {verdict}"
            )

    print()
    print("diagnostics")
    gbm_auc = summary.loc["gbm", "test_auc"]
    logistic_auc = summary.loc["logistic", "test_auc"]
    print(
        f"  structure available to a flexible model: gradient boosting minus logistic "
        f"= {gbm_auc - logistic_auc:+.4f}"
    )
    print(
        "    a near-zero or negative value means the signal is essentially additive,"
        " so a weighted sum matching the black box says more about the data than about"
        " interpretability"
    )
    worst_overfit = summary["overfit"].max()
    print(f"  largest train-test gap across models: {worst_overfit:+.4f}")
    print(
        "    a large gap means the black box memorised its fold and any interpretable"
        " 'win' is an artefact — the comparison would be void"
    )
    print(f"  best AUC reached by any model: {summary['test_auc'].max():.4f}")
    print(
        "    on real data the Bayes ceiling is unknowable, so this is a lower bound on it"
        " and nothing more — results are NOT reported as skill here"
    )

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    summary.to_csv(RESULTS_DIR / "w01-bpic-interpretability.csv")
    folds.to_csv(RESULTS_DIR / "w01-bpic-folds.csv", index=False)
    panel.to_csv(RESULTS_DIR / "w01-bpic-panel.csv", index=False)
    print(f"\nwrote {RESULTS_DIR / 'w01-bpic-interpretability.csv'} (+ folds, panel)")


def sensitivity(repeats: int = 3) -> pd.DataFrame:
    """Does the headline survive the two numbers that were chosen rather than derived?

    `LABEL_QUANTILE` sets how bad next quarter has to be to count as a failure,
    and `MIN_CASES_PER_PERIOD` sets how thin a unit-period may be before it is
    dropped. Both are judgement calls. A result that moves when they move is not
    a result, and finding that out belongs here rather than in a reviewer's
    report.
    """
    from . import bpic_signals

    original = (bpic_signals.LABEL_QUANTILE, bpic_signals.MIN_CASES_PER_PERIOD)
    rows = []

    try:
        for quantile in (0.70, 0.75, 0.80, 0.85):
            for min_cases in (3, 5, 8):
                bpic_signals.LABEL_QUANTILE = quantile
                bpic_signals.MIN_CASES_PER_PERIOD = min_cases

                panel = build_panel()
                X = feature_matrix(panel)
                y = panel["failed"].to_numpy()
                groups = (
                    panel["municipality"].astype(str) + "/" + panel["owner"].astype(str)
                ).to_numpy()

                folds = []
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    for repeat in range(repeats):
                        fold_scores, _ = _fold_scores(X, y, groups, seed=SEED + repeat)
                        folds.append(fold_scores)

                means = pd.concat(folds).groupby("model")["test_auc"].mean()
                rows.append(
                    {
                        "label_quantile": quantile,
                        "min_cases": min_cases,
                        "n": len(panel),
                        "positive_rate": float(y.mean()),
                        "grie": means["grie"],
                        "grie_tuned": means["grie_tuned"],
                        "logistic": means["logistic"],
                        "gbm": means["gbm"],
                        "rf": means["rf"],
                        "grie_minus_gbm": means["grie"] - means["gbm"],
                        "grie_minus_rf": means["grie"] - means["rf"],
                        "tuning_delta": means["grie_tuned"] - means["grie"],
                    }
                )
                print(
                    f"  q={quantile:.2f} min_cases={min_cases}  n={len(panel):>4}  "
                    f"pos={y.mean():.1%}  GRIE={means['grie']:.4f}  "
                    f"vs gbm {means['grie'] - means['gbm']:+.4f}  "
                    f"vs rf {means['grie'] - means['rf']:+.4f}  "
                    f"tuning {means['grie_tuned'] - means['grie']:+.4f}"
                )
    finally:
        bpic_signals.LABEL_QUANTILE, bpic_signals.MIN_CASES_PER_PERIOD = original

    table = pd.DataFrame(rows)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    table.to_csv(RESULTS_DIR / "w01-bpic-sensitivity.csv", index=False)

    print()
    print("across all 12 configurations:")
    for column, label in (
        ("grie_minus_gbm", "GRIE minus gradient boosting"),
        ("grie_minus_rf", "GRIE minus random forest"),
        ("tuning_delta", "tuning effect on GRIE"),
    ):
        values = table[column]
        sign = "always ahead" if (values > 0).all() else (
            "always behind" if (values < 0).all() else "SIGN FLIPS - not a robust finding"
        )
        print(f"  {label:<32}{values.min():+.4f} to {values.max():+.4f}   {sign}")
    print(f"\nwrote {RESULTS_DIR / 'w01-bpic-sensitivity.csv'}")
    return table


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sensitivity",
        action="store_true",
        help="sweep the two chosen constants instead of running the headline comparison",
    )
    args = parser.parse_args()
    if args.sensitivity:
        sensitivity()
    else:
        run()


if __name__ == "__main__":
    main()
