"""What does it cost to guarantee that an explanation stays informative?

    python -m drishti_research.explanation_cost

The question
------------
The interpretability literature argues about model *classes* — is a linear model
enough, does a tree beat a forest. It rarely asks a second question that anyone
deploying a scoring system runs into immediately: **an interpretable model can
still produce a useless explanation.**

`tuning.py` records the moment this project met it. An unconstrained weight
search collapsed the contractor model to a single factor at **0.998 weight** —
accurate, and useless. Every explanation would have read *"this contractor is
blacklisted"* whatever else was true, and the reviewing officer would have
learned nothing about the work in front of them. The model was interpretable in
the technical sense and uninformative in the only sense that matters.

The fix was a floor: no factor may fall below `MIN_WEIGHT`, so every factor
stays materially present in every explanation. That is a real constraint and it
must cost something. **Nobody appears to have measured what.**

What this measures
------------------
Accuracy against explanation concentration, across the floor from 0 (free
optimisation) to a floor tight enough to force near-uniform weights.

Concentration is the Herfindahl-Hirschman index of the weight vector — the sum
of squared shares, borrowed from competition economics where it measures market
domination by the largest firms. It is the right instrument here for the same
reason: 1.0 means one factor explains everything, and 1/k means all k factors
contribute equally. An explanation drawn from a concentrated model tells the
reader one thing; from a diffuse model, several.

Reporting both curves on one axis turns "we constrained the tuner" from a design
note into a measured trade-off a reader can locate their own tolerance on.

Honest expectations
-------------------
This may find nothing. If the accuracy curve is flat across the whole range, the
constraint is free, there is no trade-off to report, and the finding is a
one-line footnote rather than a paper. That would be a real answer and it is
recorded either way — the sweep exists to be capable of returning it.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from .generator import GeneratorConfig, feature_matrix, generate
from .model_spec import load_spec
from .models import InterpretableScorer
from .tuning import tune_weights

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "research" / "results"

#: The floor sweep, expressed as a *fraction of uniform weighting*.
#:
#: An absolute floor is not comparable across entity types, because they have
#: different numbers of factors: 0.20 leaves a five-factor model no freedom at
#: all (five times 0.20 is the entire budget) while a four-factor model still
#: has room. Worse, the tuner rejects the degenerate case outright, so a fixed
#: sweep simply crashes on the narrowest entity.
#:
#: Expressing the floor as a share of 1/k fixes both. 0.0 lets the optimiser
#: collapse the model entirely; 0.95 forces every factor to within 5% of an
#: equal share, which is uniformity in all but name. The shipped MIN_WEIGHT of
#: 0.05 sits at roughly 0.25 of uniform for a five-factor model.
FLOOR_FRACTIONS = [0.0, 0.1, 0.25, 0.4, 0.6, 0.8, 0.95]

REGIMES = ["plausible", "adversarial"]
ENTITY_TYPES = ["SECTOR", "PROJECT", "CONTRACTOR"]
SEEDS = [11, 23, 37, 41, 53]


def herfindahl(weights: dict[str, float]) -> float:
    """Concentration of a weight vector: 1/k when uniform, 1.0 when degenerate."""
    w = np.array(list(weights.values()), dtype=float)
    total = w.sum()
    if total <= 0:
        return float("nan")
    shares = w / total
    return float((shares**2).sum())


def largest_share(weights: dict[str, float]) -> float:
    w = np.array(list(weights.values()), dtype=float)
    return float(w.max() / w.sum()) if w.sum() > 0 else float("nan")


def run() -> pd.DataFrame:
    spec = load_spec()
    rows: list[dict] = []

    for regime in REGIMES:
        for entity_type in ENTITY_TYPES:
            for seed in SEEDS:
                frame = generate(entity_type, GeneratorConfig(seed=seed, regime=regime))
                X = feature_matrix(frame, spec, entity_type)
                y = frame["outcome"].to_numpy()

                idx = np.arange(len(X))
                idx_train, idx_test = train_test_split(
                    idx, test_size=0.3, random_state=seed, stratify=y
                )
                X_train, X_test = X.iloc[idx_train], X.iloc[idx_test]
                y_train, y_test = y[idx_train], y[idx_test]

                # The shipped model, as a reference line on every chart.
                base = InterpretableScorer(spec, entity_type)
                base_auc = roc_auc_score(y_test, base.predict_proba(X_test)[:, 1])
                base_weights = spec.weights(entity_type)

                # 1/k is uniform weighting for this entity's factor count.
                uniform = 1.0 / len(base.feature_keys)

                for fraction in FLOOR_FRACTIONS:
                    floor = fraction * uniform
                    result = tune_weights(
                        spec, entity_type, X_train, y_train, seed=seed, min_weight=floor
                    )
                    scorer = InterpretableScorer(spec, entity_type, weights=result.weights)
                    auc = roc_auc_score(y_test, scorer.predict_proba(X_test)[:, 1])

                    rows.append(
                        {
                            "regime": regime,
                            "entity_type": entity_type,
                            "seed": seed,
                            "floor_fraction": fraction,
                            "min_weight": floor,
                            "factors": len(base.feature_keys),
                            "test_auc": auc,
                            "untuned_auc": base_auc,
                            "hhi": herfindahl(result.weights),
                            "largest_share": largest_share(result.weights),
                            "untuned_hhi": herfindahl(base_weights),
                            "converged": result.converged,
                        }
                    )

    return pd.DataFrame(rows)


def report(frame: pd.DataFrame) -> None:
    print("--- the cost of a guaranteed explanation ---")
    print(f"    {len(FLOOR_FRACTIONS)} floors x {len(REGIMES)} regimes x {len(ENTITY_TYPES)} entities "
          f"x {len(SEEDS)} seeds = {len(frame)} fits")
    print()

    for regime in REGIMES:
        sub = frame[frame.regime == regime]
        print(f"  {regime}")
        print(f"  {'floor':>7} {'test AUC':>9} {'sd':>7} {'HHI':>7} {'largest factor':>15}")
        for fraction in FLOOR_FRACTIONS:
            g = sub[sub.floor_fraction == fraction]
            label = "free" if fraction == 0 else f"{fraction:.0%}"
            print(
                f"  {label:>8} {g.test_auc.mean():>9.4f} {g.test_auc.std():>7.4f} "
                f"{g.hhi.mean():>7.3f} {g.largest_share.mean():>14.1%}"
            )

        free = sub[sub.min_weight == 0.0].test_auc.mean()
        shipped = sub[sub.min_weight == 0.05].test_auc.mean()
        tight = sub[sub.floor_fraction == FLOOR_FRACTIONS[-1]].test_auc.mean()
        print(f"\n    free -> shipped floor : {shipped - free:+.4f} AUC")
        print(f"    free -> tightest floor: {tight - free:+.4f} AUC")
        print(f"    concentration falls    : {sub[sub.min_weight==0.0].hhi.mean():.3f} "
              f"-> {sub[sub.floor_fraction==FLOOR_FRACTIONS[-1]].hhi.mean():.3f}")
        print()

    # The verdict the module exists to be able to return.
    spread = frame.groupby("floor_fraction").test_auc.mean()
    swing = spread.max() - spread.min()
    print(f"  Largest mean AUC difference across the whole floor range: {swing:.4f}")
    if swing < 0.005:
        print("  VERDICT: the constraint is effectively free. There is no trade-off to")
        print("           report — say so in one line and do not build a paper on it.")
    else:
        print("  VERDICT: the constraint has a measurable price. Report the curve.")


def plot(frame: pd.DataFrame) -> None:
    """Accuracy against explanation concentration — the frontier, per entity.

    Concentration on the x-axis rather than the floor, because the floor is a
    knob and concentration is the thing a reader cares about. Reading right to
    left is reading "what happens as I force the explanation to spread out".
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    regimes = sorted(frame.regime.unique())
    fig, axes = plt.subplots(1, len(regimes), figsize=(11, 4.2), sharey=False)

    for ax, regime in zip(axes, regimes, strict=True):
        sub = frame[frame.regime == regime]
        for entity in sorted(sub.entity_type.unique()):
            g = sub[sub.entity_type == entity].groupby("floor_fraction").agg(
                hhi=("hhi", "mean"), auc=("test_auc", "mean")
            )
            ax.plot(g.hhi, g.auc, marker="o", markersize=4, label=entity.title())

        ax.set_title(f"{regime} regime", fontsize=10)
        ax.set_xlabel("explanation concentration (HHI)")
        ax.set_ylabel("test AUC")
        ax.grid(alpha=0.25, linewidth=0.6)
        ax.legend(fontsize=8, frameon=False)

    fig.suptitle(
        "Forcing an explanation to stay diverse is nearly free until it is not",
        fontsize=11,
    )
    fig.tight_layout()
    out = RESULTS / "explanation-cost.png"
    fig.savefig(out, dpi=150)
    print(f"  wrote {out.relative_to(ROOT)}")


def main() -> None:
    frame = run()
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / "explanation-cost.csv"
    frame.to_csv(out, index=False)
    report(frame)
    print(f"\n  wrote {out.relative_to(ROOT)}")
    plot(frame)


if __name__ == "__main__":
    main()
