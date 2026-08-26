"""Fine-tuning GRIE's weights.

The project plan asks two questions, and this file answers the second:

    Does keeping a risk score interpretable cost much accuracy against a black
    box — and does a fine-tuning step close most of that gap?

Two constraints make this honest, and both matter.

**Tuned weights must remain weights.** Non-negative, summing to 1.0, so the
result is still a weighted sum of the same explainable factors on the same
0-100 scale. Arbitrary coefficients would no longer be the model the paper is
defending.

**No factor may be tuned out of existence.** An unconstrained search collapsed
the contractor model to a single factor at 0.998 weight — accurate, and useless:
every explanation would have read "this contractor is blacklisted" whatever else
was true, and the officer reviewing it would have learned nothing about the
work. A floor of MIN_WEIGHT keeps every factor materially present, so the tuned
model remains the multi-factor instrument the product promises. That costs a
little accuracy, and the paper should report the cost rather than quietly taking
the degenerate optimum.

Fitted on the training split only, then reported on the held-out test split, so
the reported gain is not the tuner grading its own homework.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.metrics import roc_auc_score

from .model_spec import ModelSpec
from .models import InterpretableScorer


#: Smallest share any single factor may retain after tuning.
#:
#: 0.05 keeps five factors all visible in an explanation while still leaving the
#: optimiser most of the mass to move. Raising it constrains tuning further and
#: costs accuracy; lowering it lets the model collapse toward one factor.
MIN_WEIGHT = 0.05


@dataclass(frozen=True)
class TuningResult:
    weights: dict[str, float]
    train_auc_before: float
    train_auc_after: float
    iterations: int
    converged: bool
    min_weight: float = MIN_WEIGHT

    def shifts(self, original: dict[str, float]) -> pd.DataFrame:
        """What moved, and by how much — the table the paper reports."""
        return (
            pd.DataFrame(
                {
                    "factor": list(self.weights),
                    "before": [original[k] for k in self.weights],
                    "after": [self.weights[k] for k in self.weights],
                }
            )
            .assign(change=lambda d: d["after"] - d["before"])
            .sort_values("change", key=abs, ascending=False)
            .reset_index(drop=True)
        )


def _softmax(z: np.ndarray, min_weight: float = MIN_WEIGHT) -> np.ndarray:
    """Map unconstrained parameters onto the simplex, with a floor per factor.

    Optimising in this space keeps the result a valid weight set — non-negative
    and summing to 1.0 by construction — so the optimiser cannot wander off into
    coefficients that would no longer be weights.

    The floor is applied by reserving `min_weight` for every factor up front and
    letting the softmax distribute only what remains. That keeps the sum exactly
    1.0 while guaranteeing no factor drops out of the explanation.
    """
    shifted = z - np.max(z)
    exp = np.exp(shifted)
    free = exp / exp.sum()
    reserved = min_weight * len(z)
    if reserved >= 1.0:
        raise ValueError(f"min_weight {min_weight} is too large for {len(z)} factors")
    return min_weight + free * (1.0 - reserved)


def tune_weights(
    spec: ModelSpec,
    entity_type: str,
    X_train: pd.DataFrame,
    y_train: np.ndarray,
    *,
    max_iter: int = 400,
    seed: int = 20260826,
    min_weight: float = MIN_WEIGHT,
) -> TuningResult:
    """Search for the weight set that best ranks training outcomes.

    The objective is negative ROC-AUC, because the operational question is
    "does this queue put the genuinely failing entities at the top?" — a ranking
    question, not a calibration one. Optimising log-loss instead would chase
    probability calibration the raw score does not claim to have.
    """
    base = InterpretableScorer(spec, entity_type)
    keys = base.feature_keys
    normalised = base.normalise(X_train).to_numpy()

    original_weights = np.array([base.weights[k] for k in keys], dtype=float)
    auc_before = roc_auc_score(y_train, normalised @ original_weights)

    def objective(z: np.ndarray) -> float:
        weights = _softmax(z, min_weight)
        scores = normalised @ weights
        # A degenerate weight set can flatten the score; guard the metric.
        if np.allclose(scores, scores[0]):
            return 0.0
        return -roc_auc_score(y_train, scores)

    # Start from the hand-specified weights rather than randomly: the question
    # is how far the expert model can be improved, not what an unrelated optimum
    # looks like.
    start = np.log(np.clip(original_weights, 1e-6, None))

    result = minimize(
        objective,
        start,
        method="Nelder-Mead",
        options={"maxiter": max_iter, "xatol": 1e-4, "fatol": 1e-6},
    )

    tuned = _softmax(result.x, min_weight)
    auc_after = roc_auc_score(y_train, normalised @ tuned)

    # Never return a worse model than we started with. Nelder-Mead can stop on
    # a slightly worse simplex vertex, and shipping that would misreport tuning
    # as harmful when it simply failed to converge.
    if auc_after < auc_before:
        tuned = original_weights
        auc_after = auc_before

    _ = seed  # reserved for multi-restart tuning; kept for signature stability

    return TuningResult(
        weights={k: float(w) for k, w in zip(keys, tuned)},
        train_auc_before=float(auc_before),
        train_auc_after=float(auc_after),
        iterations=int(result.nit),
        converged=bool(result.success),
        min_weight=min_weight,
    )
