"""Is the explanation the same one tomorrow?

    python -m drishti_research.explanation_stability

The unasked question
--------------------
`explanation_cost.py` asks whether an explanation is *concentrated* — whether one
factor swallows the weight and leaves the officer with nothing to read. This
module asks the other thing that determines whether an explanation is worth
anything, and which the interpretability literature almost never measures:
**is it stable?**

A model is normally called interpretable if a human can read its parameters. That
is a statement about the model's form, not about its behaviour. A logistic
regression whose largest coefficient is `slaBreachRate` on one sample of the data
and `escalationRate` on another is perfectly readable and completely unreliable
as an explanation: the sentence shown to an officer would change because the
training sample changed, not because anything about the sector changed.

Nobody should have to trust an explanation that would have been a different
explanation given a different Tuesday's data.

How it is measured
------------------
Resample the training data with replacement, refit, and record each model's
attribution vector over the five signals. Across resamples, measure:

``rank agreement``   mean Spearman correlation between attribution vectors from
                     independent resamples. 1.0 means the factors always rank
                     the same way; 0.0 means the ordering is noise.
``top-1 agreement``  how often two independent resamples name the same most
                     important factor. This is the one an officer actually sees,
                     because the explanation sentence leads with it.
``sign flips``       share of factors whose attribution changes direction
                     between resamples. A factor that raises risk in one fit and
                     lowers it in another is not a finding about governance.

Attributions are permutation importance on a held-out split, which is the one
measure definable for every model here — coefficients exist only for the linear
models, and impurity importance only for the trees. Using one instrument for all
five keeps the comparison about the models rather than about the instrument.

The obvious objection, and the answer
-------------------------------------
GRIE scores 1.0 on every measure by construction: its weights are fixed, so its
explanation cannot move. Reporting that as a *win* would be circular.

So GRIE is drawn as a reference line, not entered as a competitor, and the real
comparison is among the models that are fitted — including **tuned GRIE**, which
has exactly GRIE's transparent form but obtains its weights from data. If tuned
GRIE is as unstable as the black boxes, that is the result worth publishing: it
would mean instability comes from *fitting*, not from model class, and that the
interpretability literature's focus on form is aimed at the wrong thing.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GridSearchCV, train_test_split

from .bpic_signals import FEATURE_KEYS
from .bpic_signals import build_panel as build_2015
from .bpic_study import build_logistic, small_data_black_box, small_data_forest
from .model_spec import load_spec
from .models import InterpretableScorer
from .tuning import tune_weights

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "research" / "results"

ENTITY = "SECTOR"

#: Bootstrap resamples of the training data. Each one is a plausible alternative
#: history — the data the authority might have had, had the week gone differently.
N_RESAMPLES = 40

#: Permutation repeats inside each resample, to damp the measure's own noise.
N_PERMUTATIONS = 20

SEED = 20260910

GRIE = "GRIE (fixed weights)"
GRIE_TUNED = "GRIE (tuned)"
LOGISTIC = "Logistic regression"
FOREST = "Random forest"
BOOSTING = "Gradient boosting"

FITTED = [GRIE_TUNED, LOGISTIC, FOREST, BOOSTING]


def _permutation_importance(
    model, X: pd.DataFrame, y: np.ndarray, seed: int
) -> np.ndarray:
    """Drop in AUC when each column is shuffled, averaged over repeats.

    Written out rather than taken from sklearn because `InterpretableScorer` is
    a scorer, not an estimator — it has no `fit`, which sklearn's version
    requires. Permutation importance needs only `predict_proba`, so defining it
    here lets one instrument measure all five models. Coefficients would cover
    only the linear ones and impurity importance only the trees, and a
    comparison using a different instrument per model would be measuring the
    instruments.
    """
    rng = np.random.default_rng(seed)
    base = roc_auc_score(y, model.predict_proba(X)[:, 1])

    drops = np.zeros(X.shape[1])
    for col in range(X.shape[1]):
        losses = []
        for _ in range(N_PERMUTATIONS):
            shuffled = X.copy()
            shuffled.iloc[:, col] = rng.permutation(shuffled.iloc[:, col].to_numpy())
            losses.append(base - roc_auc_score(y, model.predict_proba(shuffled)[:, 1]))
        drops[col] = float(np.mean(losses))
    return drops


def _attributions(
    X: pd.DataFrame, y: np.ndarray, groups: np.ndarray, seed: int
) -> tuple[dict[str, np.ndarray], dict[str, float]]:
    """One resample: fit every model, return its importance vector and its AUC."""
    spec = load_spec()
    rng = np.random.default_rng(seed)

    # Resample units, not rows: a bootstrap over rows would split one unit's
    # quarters across train and test and quietly leak.
    units = np.unique(groups)
    drawn = rng.choice(units, size=len(units), replace=True)
    train_mask = np.concatenate([np.where(groups == u)[0] for u in drawn])
    held_out = np.where(~np.isin(groups, drawn))[0]
    if len(held_out) < 10 or len(np.unique(y[held_out])) < 2:
        return {}, {}

    X_train, y_train = X.iloc[train_mask], y[train_mask]
    X_test, y_test = X.iloc[held_out], y[held_out]

    models: dict[str, object] = {}

    tuned = tune_weights(spec, ENTITY, X_train, y_train, seed=seed).weights
    models[GRIE_TUNED] = InterpretableScorer(spec, ENTITY, weights=tuned)

    for name, builder in ((LOGISTIC, build_logistic), (FOREST, small_data_forest),
                          (BOOSTING, small_data_black_box)):
        estimator = builder(seed)
        fit_kwargs = (
            {"groups": groups[train_mask]} if isinstance(estimator, GridSearchCV) else {}
        )
        fitted = estimator.fit(X_train, y_train, **fit_kwargs)

        # A bootstrap draw can leave the inner grouped CV with a fold that has
        # one class, and every candidate then scores nan. GridSearchCV still
        # returns a model, having picked the first parameter set arbitrarily —
        # an arbitrary model's attributions would be counted here as if they
        # were a fitted model's disagreement. Drop the resample instead.
        if isinstance(fitted, GridSearchCV) and not np.isfinite(
            fitted.cv_results_["mean_test_score"]
        ).any():
            return {}, {}
        models[name] = fitted

    importances: dict[str, np.ndarray] = {}
    aucs: dict[str, float] = {}
    for name, model in models.items():
        importances[name] = _permutation_importance(model, X_test, y_test, seed)
        aucs[name] = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])

    return importances, aucs


def run() -> tuple[pd.DataFrame, dict[str, list[np.ndarray]]]:
    panel = build_2015()
    X = panel[FEATURE_KEYS].astype(float).reset_index(drop=True)
    y = panel["failed"].to_numpy()
    groups = (panel["municipality"].astype(str) + "/" + panel["owner"].astype(str)).to_numpy()

    collected: dict[str, list[np.ndarray]] = {name: [] for name in FITTED}
    auc_rows = []

    usable = 0
    for i in range(N_RESAMPLES):
        importances, aucs = _attributions(X, y, groups, SEED + i)
        if not importances:
            continue
        usable += 1
        for name, vector in importances.items():
            collected[name].append(vector)
        for name, auc in aucs.items():
            auc_rows.append({"resample": i, "model": name, "auc": auc})

    rows = []
    for name, vectors in collected.items():
        if len(vectors) < 2:
            continue
        stack = np.vstack(vectors)

        # Every unordered pair of resamples: how much do two plausible
        # alternative histories agree about why a sector is risky?
        rhos, top1, flips = [], [], []
        for i in range(len(stack)):
            for j in range(i + 1, len(stack)):
                a, b = stack[i], stack[j]
                if np.std(a) > 0 and np.std(b) > 0:
                    rhos.append(spearmanr(a, b).statistic)
                top1.append(int(np.argmax(a) == np.argmax(b)))
                flips.append(float(np.mean(np.sign(a) != np.sign(b))))

        rows.append(
            {
                "model": name,
                "rank_agreement": float(np.nanmean(rhos)),
                "top1_agreement": float(np.mean(top1)),
                "sign_flip_rate": float(np.mean(flips)),
                "resamples": len(stack),
                # How often each factor came first, as a distribution.
                "top1_entropy": float(_entropy(np.argmax(stack, axis=1), len(FEATURE_KEYS))),
            }
        )

    print(f"  {usable}/{N_RESAMPLES} resamples usable "
          f"({N_RESAMPLES - usable} dropped for a degenerate inner search)")
    frame = pd.DataFrame(rows)
    aucs = pd.DataFrame(auc_rows).groupby("model").auc.mean()
    frame["mean_auc"] = frame["model"].map(aucs)
    return frame, collected


def _entropy(choices: np.ndarray, k: int) -> float:
    """Normalised entropy of which factor came first. 0 = always the same, 1 = uniform."""
    counts = np.bincount(choices, minlength=k).astype(float)
    p = counts / counts.sum()
    p = p[p > 0]
    return float(-(p * np.log(p)).sum() / np.log(k))


def report(frame: pd.DataFrame, collected: dict[str, list[np.ndarray]]) -> None:
    print("--- would the explanation have been the same one on different data? ---")
    print(f"    {N_RESAMPLES} bootstrap resamples of the training units, "
          f"BPIC 2015 panel\n")

    print(f"  {'model':<24}{'rank agr':>10}{'top-1 agr':>11}"
          f"{'sign flips':>12}{'top-1 entropy':>15}{'AUC':>8}")
    print(f"  {GRIE:<24}{1.0:>10.3f}{1.0:>11.3f}{0.0:>12.3f}{0.0:>15.3f}"
          f"{'—':>8}   (fixed by construction)")
    for _, r in frame.sort_values("rank_agreement", ascending=False).iterrows():
        print(f"  {r.model:<24}{r.rank_agreement:>10.3f}{r.top1_agreement:>11.3f}"
              f"{r.sign_flip_rate:>12.3f}{r.top1_entropy:>15.3f}{r.mean_auc:>8.3f}")

    print("\n  which factor came first, by model:")
    for name, vectors in collected.items():
        if not vectors:
            continue
        stack = np.vstack(vectors)
        counts = np.bincount(np.argmax(stack, axis=1), minlength=len(FEATURE_KEYS))
        leaders = ", ".join(
            f"{FEATURE_KEYS[i]} {c / counts.sum():.0%}" for i, c in enumerate(counts) if c
        )
        print(f"    {name:<24}{leaders}")

    print()
    worst = frame.loc[frame.top1_agreement.idxmin()]
    best = frame.loc[frame.top1_agreement.idxmax()]
    print(f"  Two independent resamples name the same leading factor "
          f"{best.top1_agreement:.0%} of the time for {best.model},")
    print(f"  and only {worst.top1_agreement:.0%} of the time for {worst.model}.")

    tuned = frame[frame.model == GRIE_TUNED]
    boxes = frame[frame.model.isin([FOREST, BOOSTING])]
    if not tuned.empty and not boxes.empty:
        print()
        if tuned.top1_agreement.iloc[0] <= boxes.top1_agreement.max():
            print("  A transparent model fitted to data is NO more stable than a black")
            print("  box. Instability comes from fitting, not from model class — which")
            print("  is a finding about what interpretability research measures.")
        else:
            print("  The transparent fitted model is more stable than the black boxes,")
            print("  so model class carries some of the stability, not fitting alone.")


def plot(collected: dict[str, list[np.ndarray]]) -> None:
    """How often each factor leads the explanation, per model."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    models = [m for m in FITTED if collected.get(m)]
    fig, axes = plt.subplots(1, len(models) + 1, figsize=(3.1 * (len(models) + 1), 3.4),
                             sharey=True)

    # GRIE first, as the reference: one factor leads, always.
    fixed = np.zeros(len(FEATURE_KEYS))
    spec = load_spec()
    weights = spec.weights(ENTITY)
    fixed[int(np.argmax(list(weights.values())))] = 1.0
    axes[0].bar(range(len(FEATURE_KEYS)), fixed, color="#3730a3")
    axes[0].set_title(f"{GRIE}\n(reference)", fontsize=9)

    for ax, name in zip(axes[1:], models, strict=True):
        stack = np.vstack(collected[name])
        counts = np.bincount(np.argmax(stack, axis=1), minlength=len(FEATURE_KEYS))
        ax.bar(range(len(FEATURE_KEYS)), counts / counts.sum(), color="#94a3b8")
        ax.set_title(name, fontsize=9)

    for ax in axes:
        ax.set_xticks(range(len(FEATURE_KEYS)))
        ax.set_xticklabels([k.replace("Rate", "").replace("Complaint", "")
                            for k in FEATURE_KEYS], rotation=45, ha="right", fontsize=7)
        ax.grid(alpha=0.25, linewidth=0.6, axis="y")
    axes[0].set_ylabel("share of resamples leading the explanation")

    fig.suptitle(
        "Which factor the explanation leads with, across 40 plausible alternative histories",
        fontsize=10.5,
    )
    fig.tight_layout()
    out = RESULTS / "explanation-stability.png"
    fig.savefig(out, dpi=150)
    print(f"  wrote {out.relative_to(ROOT)}")


def main() -> None:
    frame, collected = run()
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / "explanation-stability.csv"
    frame.to_csv(out, index=False)
    report(frame, collected)
    print(f"\n  wrote {out.relative_to(ROOT)}")
    plot(collected)


if __name__ == "__main__":
    main()
