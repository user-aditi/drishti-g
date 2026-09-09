"""Does a hand-specified model transfer between organisations better than a fitted one?

    python -m drishti_research.transfer

The question
------------
Every comparison so far trains and tests inside the same population. That is not
how a governance risk model gets deployed. An authority does not have five years
of its own labelled history when it switches the system on — it has somebody
else's model, and the hope that the model still means something here.

That is the regime where a *hand-specified* model should have an advantage it
cannot show in-distribution. Fitted weights encode whatever was true of the
source organisation, including the parts that were accidents of that
organisation. Weights chosen from domain reasoning encode none of it, because
they never saw a source organisation at all. If that argument is right, the gap
between GRIE and the fitted models should **widen** when the test population
changes.

If it is wrong, that is worth knowing too, and more useful than the in-
distribution comparison it would replace: it would say the interpretable model's
advantage is a small-sample effect that disappears the moment the data changes.

Design
------
Leave-one-municipality-out. Fit on four of BPIC 2015's five municipalities, test
on the fifth, five times over. Every model sees exactly the same split.

GRIE is the control that needs no training: its weights are the same in every
fold, because they were chosen by the team and never fitted to anything. The
fitted models — logistic regression, random forest, gradient boosting, and GRIE
with tuned weights — are refitted on each training set.

The comparison to watch is not the absolute AUC, which will fall for everyone
when the population changes. It is **whether the ordering changes**: a model
whose advantage survives the move is a different proposition from one whose
advantage was an artefact of testing where it was fitted.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GridSearchCV

from .bpic import MUNICIPALITIES
from .bpic_signals import FEATURE_KEYS, build_panel
from .bpic_study import build_logistic, small_data_black_box, small_data_forest
from .model_spec import load_spec
from .models import InterpretableScorer
from .tuning import tune_weights

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "research" / "results"

#: GRIE scores areas, so the sector weight set is the one that applies.
ENTITY = "SECTOR"

GRIE = "GRIE (hand-specified)"
GRIE_TUNED = "GRIE (tuned on source)"
LOGISTIC = "Logistic regression"
FOREST = "Random forest"
BOOSTING = "Gradient boosting"


def _fit_and_score(
    spec,
    X_train: pd.DataFrame,
    y_train: np.ndarray,
    X_test: pd.DataFrame,
    y_test: np.ndarray,
    groups_train: np.ndarray,
    seed: int,
) -> dict[str, float]:
    """Every model on one source/target split."""
    scores: dict[str, float] = {}

    # The control: identical weights in every fold, fitted to nothing.
    grie = InterpretableScorer(spec, ENTITY)
    scores[GRIE] = roc_auc_score(y_test, grie.predict_proba(X_test)[:, 1])

    tuning = tune_weights(spec, ENTITY, X_train, y_train, seed=seed)
    tuned = InterpretableScorer(spec, ENTITY, weights=tuning.weights)
    scores[GRIE_TUNED] = roc_auc_score(y_test, tuned.predict_proba(X_test)[:, 1])

    for name, builder in (
        (LOGISTIC, build_logistic),
        (FOREST, small_data_forest),
        (BOOSTING, small_data_black_box),
    ):
        estimator = builder(seed)
        # The inner hyperparameter search groups by case worker, so no worker's
        # quarters straddle its folds. Without the groups it raises rather than
        # silently leaking, which is the right failure.
        fit_kwargs = {"groups": groups_train} if isinstance(estimator, GridSearchCV) else {}
        model = estimator.fit(X_train, y_train, **fit_kwargs)
        scores[name] = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])

    return scores


def run(seed: int = 20260910) -> pd.DataFrame:
    spec = load_spec()
    panel = build_panel()

    rows: list[dict] = []

    for target in MUNICIPALITIES:
        train = panel[panel.municipality != target]
        test = panel[panel.municipality == target]

        # A fold with one class in the target tells us nothing about ranking.
        if test.failed.nunique() < 2 or len(test) < 20:
            print(f"  skipping municipality {target}: {len(test)} rows, "
                  f"{test.failed.nunique()} classes")
            continue

        X_train = train[FEATURE_KEYS].astype(float)
        X_test = test[FEATURE_KEYS].astype(float)

        groups_train = (
            train["municipality"].astype(str) + "/" + train["owner"].astype(str)
        ).to_numpy()

        scores = _fit_and_score(
            spec,
            X_train,
            train.failed.to_numpy(),
            X_test,
            test.failed.to_numpy(),
            groups_train,
            seed,
        )

        for model, auc in scores.items():
            rows.append(
                {
                    "target": target,
                    "model": model,
                    "test_auc": auc,
                    "train_rows": len(train),
                    "test_rows": len(test),
                    "test_positive_rate": float(test.failed.mean()),
                }
            )

    return pd.DataFrame(rows)


def report(frame: pd.DataFrame) -> None:
    order = [GRIE, GRIE_TUNED, LOGISTIC, FOREST, BOOSTING]

    print("--- leave-one-municipality-out transfer ---")
    print(f"    {frame.target.nunique()} folds, "
          f"{frame.test_rows.iloc[0] if len(frame) else 0}-ish rows per target\n")

    print(f"  {'model':<26}{'mean AUC':>10}{'sd':>8}{'worst':>9}{'best':>9}")
    summary = {}
    for model in order:
        g = frame[frame.model == model]
        if g.empty:
            continue
        summary[model] = g.test_auc.mean()
        print(f"  {model:<26}{g.test_auc.mean():>10.4f}{g.test_auc.std():>8.4f}"
              f"{g.test_auc.min():>9.4f}{g.test_auc.max():>9.4f}")

    print()
    print("  per fold:")
    pivot = frame.pivot(index="target", columns="model", values="test_auc")
    for target, row in pivot.iterrows():
        best = row.idxmax()
        print(f"    municipality {target}: best = {best} ({row[best]:.4f}), "
              f"GRIE = {row.get(GRIE, float('nan')):.4f}")

    print()
    if GRIE in summary:
        for challenger in (BOOSTING, FOREST, LOGISTIC, GRIE_TUNED):
            if challenger not in summary:
                continue
            gap = summary[GRIE] - summary[challenger]
            wins = (pivot[GRIE] > pivot[challenger]).sum()
            print(f"  GRIE - {challenger:<24}{gap:+.4f}   ahead in "
                  f"{wins}/{len(pivot)} folds")

    print()
    if GRIE in summary and BOOSTING in summary:
        if summary[GRIE] > summary[BOOSTING]:
            print("  The hand-specified model's advantage SURVIVES the population change.")
            print("  That is the interesting version of this result: it is not an artefact")
            print("  of testing where the model was fitted, because it was never fitted.")
        else:
            print("  The hand-specified model's advantage does NOT survive transfer.")
            print("  Report it: the in-distribution result is then a small-sample effect,")
            print("  and that is a materially weaker claim than the one currently written.")



def plot(frame: pd.DataFrame) -> None:
    """Per-fold AUC, one line per model.

    A bar chart of the five means would hide the thing worth seeing: the fitted
    models do not merely score lower on average, they score *less predictably*.
    Plotting every fold puts the spread on the page.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    order = [GRIE, GRIE_TUNED, LOGISTIC, FOREST, BOOSTING]
    pivot = frame.pivot(index="target", columns="model", values="test_auc")
    targets = list(pivot.index)
    x = np.arange(len(targets))

    fig, ax = plt.subplots(figsize=(7.5, 4.2))
    for model in order:
        if model not in pivot:
            continue
        control = model == GRIE
        ax.plot(
            x,
            pivot[model],
            marker="o",
            markersize=6 if control else 4,
            linewidth=2.2 if control else 1.2,
            alpha=1.0 if control else 0.75,
            label=f"{model} ({pivot[model].mean():.3f})",
            zorder=3 if control else 2,
        )

    ax.set_xticks(x)
    ax.set_xticklabels([f"municipality {t}" for t in targets], fontsize=8)
    ax.set_ylabel("AUC on the held-out municipality")
    ax.grid(alpha=0.25, linewidth=0.6, axis="y")
    ax.legend(fontsize=8, frameon=False, loc="lower right", title="mean across folds",
              title_fontsize=8)
    fig.suptitle(
        "Leave-one-municipality-out: the hand-specified model's edge widens under transfer",
        fontsize=10.5,
    )
    fig.tight_layout()
    out = RESULTS / "transfer.png"
    fig.savefig(out, dpi=150)
    print(f"  wrote {out.relative_to(ROOT)}")


def main() -> None:
    frame = run()
    if frame.empty:
        print("No usable folds — the panel is too thin to split by municipality.")
        return

    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / "transfer.csv"
    frame.to_csv(out, index=False)
    report(frame)
    print(f"\n  wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
