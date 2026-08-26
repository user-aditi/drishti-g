"""Sanity checks that must pass before any result is believed.

The first run of the experiment reported the interpretable model *beating*
gradient boosting. That is a publishable finding if it is real and an
embarrassment if it is an artefact, so it needs establishing which.

Three things could produce a spurious win:

  1. **The black box is underfit.** Then the comparison is against a straw man.
     Checked by reporting train and test AUC — an underfit model is weak on
     both, an overfit one is strong on train and weak on test.

  2. **The data has no structure a flexible model could exploit.** Measured as
     the gap between the boosted model and a fitted *linear* model on the same
     features. If a tree ensemble cannot beat a straight line, the problem is
     additive, and an interpretable model matching it says more about the data
     than about interpretability.

     An earlier version compared the boosted model against itself with oracle
     interaction terms bolted on, and read the near-zero difference as "no
     structure". That was backwards: trees *construct* those interactions from
     the raw columns, so handing them over changes nothing. A null result there
     means the black box already found whatever was present.

  3. **The task is noise-dominated.** Checked against the Bayes ceiling: the AUC
     of the generator's own failure probability. Nothing can beat it. If every
     model sits near it, the problem is easy and the comparison says little; if
     everything sits far below, the outcome is mostly irreducible noise and a
     small gap between models is expected rather than meaningful.

Run with:  python -m drishti_research.diagnostics
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from .generator import GeneratorConfig, feature_matrix, generate
from .model_spec import ModelSpec, load_spec
from .models import InterpretableScorer, build_black_box, build_logistic

ENTITY_TYPES = ["SECTOR", "PROJECT", "CONTRACTOR"]


def _oracle_features(frame: pd.DataFrame, entity_type: str) -> pd.DataFrame:
    """The observable features plus the exact non-linear terms the generator uses.

    A model given these has every structural advantage short of seeing the
    latent state itself. If it cannot beat the plain feature set, there is no
    exploitable structure for a black box to find.
    """
    if entity_type == "SECTOR":
        struggling = (frame["slaBreachRate"] > 0.4).astype(float)
        return pd.DataFrame(
            {
                "interaction": frame["slaBreachRate"] * frame["repeatComplaintRate"],
                "saturation": np.maximum(0.0, frame["openComplaintLoad"] - 20.0) / 20.0,
                "escalation_when_struggling": frame["escalationRate"] * struggling,
            }
        )
    if entity_type == "PROJECT":
        overrun_n = np.minimum(frame["budgetOverrun"] / 0.5, 1.0)
        badly_late = (frame["scheduleDelayDays"] > 90).astype(float)
        return pd.DataFrame(
            {
                "interaction": overrun_n * frame["inspectionFailureRate"],
                "late_and_failing": badly_late * frame["inspectionFailureRate"],
            }
        )
    if entity_type == "CONTRACTOR":
        risk_n = frame["avgProjectRisk"] / 100.0
        return pd.DataFrame(
            {
                "risk_x_inspection": risk_n * frame["inspectionFailureRate"],
                "blacklist_x_inspection": frame["isBlacklisted"] * frame["inspectionFailureRate"],
                "late_when_risky": frame["lateDeliveryRate"] * (risk_n > 0.6).astype(float),
            }
        )
    return pd.DataFrame(index=frame.index)


def diagnose(
    entity_type: str,
    spec: ModelSpec,
    seed: int = 20260826,
    regime: str = "plausible",
) -> dict[str, float]:
    frame = generate(entity_type, GeneratorConfig(seed=seed, regime=regime))
    X = feature_matrix(frame, spec, entity_type)
    y = frame["outcome"].to_numpy()
    oracle_prob = frame["failure_probability"].to_numpy()

    extra = _oracle_features(frame, entity_type)
    X_oracle = pd.concat([X, extra], axis=1) if not extra.empty else X.copy()

    idx_train, idx_test = train_test_split(
        np.arange(len(X)), test_size=0.3, random_state=seed, stratify=y
    )

    X_train, X_test = X.iloc[idx_train], X.iloc[idx_test]
    Xo_train, Xo_test = X_oracle.iloc[idx_train], X_oracle.iloc[idx_test]
    y_train, y_test = y[idx_train], y[idx_test]

    # The ceiling: nothing can rank better than the generator's own probability.
    bayes_auc = roc_auc_score(y_test, oracle_prob[idx_test])

    black_box = build_black_box(seed).fit(X_train, y_train)
    bb_train = roc_auc_score(y_train, black_box.predict_proba(X_train)[:, 1])
    bb_test = roc_auc_score(y_test, black_box.predict_proba(X_test)[:, 1])

    oracle_model = build_black_box(seed).fit(Xo_train, y_train)
    oracle_test = roc_auc_score(y_test, oracle_model.predict_proba(Xo_test)[:, 1])

    # The linear yardstick. Fitted, so it is not handicapped by hand-chosen
    # weights — the question here is purely what *shape* of function the data
    # needs, not whose coefficients are better.
    linear = build_logistic(seed).fit(X_train, y_train)
    linear_test = roc_auc_score(y_test, linear.predict_proba(X_test)[:, 1])

    grie = InterpretableScorer(spec, entity_type)
    grie_test = roc_auc_score(y_test, grie.predict_proba(X_test)[:, 1])

    return {
        "bayes_ceiling": float(bayes_auc),
        "linear_test_auc": float(linear_test),
        "black_box_test_auc": float(bb_test),
        "black_box_train_auc": float(bb_train),
        "oracle_features_auc": float(oracle_test),
        "grie_test_auc": float(grie_test),
        "black_box_overfit_gap": float(bb_train - bb_test),
        "headroom_to_ceiling": float(bayes_auc - bb_test),
        "nonlinear_advantage": float(bb_test - linear_test),
    }


def main() -> None:
    spec = load_spec()

    for regime in ("plausible", "adversarial"):
        rows = [
            {"entity_type": entity_type, **diagnose(entity_type, spec, regime=regime)}
            for entity_type in ENTITY_TYPES
        ]
        frame = pd.DataFrame(rows)

        print()
        print("=" * 78)
        print(f"Regime: {regime}")
        print("=" * 78)
        print()
        print(frame.round(4).to_string(index=False))

        worst_overfit = frame["black_box_overfit_gap"].max()
        best_nonlinear = frame["nonlinear_advantage"].max()

        print()
        if worst_overfit > 0.06:
            print(
                f"  CONCERN: the black box overfits by up to {worst_overfit:.3f} AUC. "
                "Regularise further; beating an overfit model proves nothing."
            )
        else:
            print(f"  OK: worst overfit gap {worst_overfit:.3f} AUC, within tolerance.")

        worst_headroom = frame["headroom_to_ceiling"].max()

        # Two very different reasons the models can end up level. The paper must
        # not confuse them, because they support quite different claims.
        if worst_headroom < 0.03:
            print(
                f"  NOTE: the best model sits within {worst_headroom:.3f} AUC of the Bayes "
                "ceiling, so this task is noise-limited rather than capacity-limited. "
                "Models converge because the outcome is mostly irreducible, not because "
                "the data is additive. Report gaps as a share of achievable headroom "
                "rather than as raw AUC differences."
            )
        elif best_nonlinear < 0.01:
            print(
                f"  NOTE: {worst_headroom:.3f} AUC of headroom remains, yet boosting beats "
                f"a linear model by only {best_nonlinear:.3f}. This regime really is "
                "additive, so an interpretable model matching a black box says more "
                "about the data than about interpretability."
            )
        else:
            print(
                f"  OK: boosting beats a linear model by up to {best_nonlinear:.3f} AUC "
                f"with {worst_headroom:.3f} of headroom left — genuine non-linear "
                "structure the black box can exploit."
            )

    print()
    print("Reading these numbers:")
    print("  bayes_ceiling         no model can rank better than this")
    print("  linear_test_auc       a fitted straight line on the same features")
    print("  nonlinear_advantage   boosting minus linear: what curvature buys")
    print("  black_box_overfit_gap train minus test; large means it memorised")
    print("  headroom_to_ceiling   how much accuracy the noise floor withholds")


if __name__ == "__main__":
    main()
