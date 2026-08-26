"""The two models under comparison.

``InterpretableScorer`` is GRIE exactly as it runs in production, driven by the
exported spec. ``build_black_box`` is the control: a gradient-boosted ensemble
free to use interactions and non-linearities the weighted sum cannot express.

Both expose the same scikit-learn-ish surface so the experiment runner can treat
them identically and the comparison stays honest.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .model_spec import ModelSpec


class InterpretableScorer:
    """GRIE's weighted sum, scoring 0-100 with a full per-factor breakdown.

    Deliberately *not* fitted to the data. It is a hand-specified expert model,
    which is the whole point of the comparison — the paper asks what a governance
    body loses by using a score it can explain and defend, rather than one it
    tuned to a training set.

    ``tuning.py`` produces a fitted variant, so the paper can report the
    untuned model, the tuned model and the black box side by side.
    """

    def __init__(self, spec: ModelSpec, entity_type: str, weights: dict[str, float] | None = None):
        self.spec = spec
        self.entity_type = entity_type
        self.factors = spec.factors(entity_type)
        self.weights = weights or spec.weights(entity_type)

        total = sum(self.weights.values())
        if abs(total - 1.0) > 1e-6:
            raise ValueError(f"weights sum to {total:.4f}, not 1.0")

    @property
    def feature_keys(self) -> list[str]:
        return [f.key for f in self.factors]

    def normalise(self, X: pd.DataFrame) -> pd.DataFrame:
        """Each raw signal put on the 0-100 scale by its declared curve."""
        return pd.DataFrame(
            {f.key: f.curve.apply(X[f.key].to_numpy()) for f in self.factors},
            index=X.index,
        )

    def score(self, X: pd.DataFrame) -> np.ndarray:
        """The 0-100 risk score."""
        normalised = self.normalise(X)
        total = np.zeros(len(X), dtype=float)
        for factor in self.factors:
            total += normalised[factor.key].to_numpy() * self.weights[factor.key]
        return np.clip(total, 0.0, 100.0)

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        """Score as a pseudo-probability, so ROC-AUC is comparable.

        Only the *ranking* matters to AUC, and dividing by 100 is monotonic, so
        this changes no ordering. Calibration is reported separately — see
        `brier_score` in experiments.py — because a raw weighted sum is not a
        calibrated probability and the paper should not pretend otherwise.
        """
        p = self.score(X) / 100.0
        return np.column_stack([1 - p, p])

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """Flagged for review, using GRIE's own operating threshold."""
        return (self.score(X) >= self.spec.review_threshold).astype(int)

    def contributions(self, X: pd.DataFrame) -> pd.DataFrame:
        """Per-factor contribution for each row — the explanation itself."""
        normalised = self.normalise(X)
        return pd.DataFrame(
            {f.key: normalised[f.key].to_numpy() * self.weights[f.key] for f in self.factors},
            index=X.index,
        )


def build_black_box(seed: int = 20260826) -> Pipeline:
    """The control model: gradient boosting.

    Chosen over a deep network because it is the strongest realistic competitor
    on small tabular data — beating a weak baseline would prove nothing. It can
    represent the interactions and thresholds the generator builds in, which the
    weighted sum structurally cannot.

    Capacity is deliberately modest. An earlier configuration (31 leaves, 300
    iterations) overfit by 0.14 AUC on a few thousand rows with five features,
    and the interpretable model "won" purely because the control had memorised
    its training split. Shallow trees, a small learning rate, a large leaf
    minimum and aggressive early stopping give it a fair fight — which is the
    only kind worth reporting. `diagnostics.py` re-checks this every run.
    """
    return Pipeline(
        [
            (
                "clf",
                HistGradientBoostingClassifier(
                    max_iter=400,
                    learning_rate=0.04,
                    max_leaf_nodes=8,
                    max_depth=4,
                    min_samples_leaf=40,
                    l2_regularization=3.0,
                    early_stopping=True,
                    n_iter_no_change=25,
                    validation_fraction=0.2,
                    random_state=seed,
                ),
            )
        ]
    )


def build_random_forest(seed: int = 20260826) -> Pipeline:
    """A second black box, so the result is not an artefact of one algorithm."""
    return Pipeline(
        [
            (
                "clf",
                RandomForestClassifier(
                    n_estimators=500,
                    # Same reasoning as the boosting model: on a few thousand
                    # noisy rows an unconstrained forest memorises.
                    min_samples_leaf=25,
                    max_features="sqrt",
                    n_jobs=-1,
                    random_state=seed,
                ),
            )
        ]
    )


def build_logistic(seed: int = 20260826) -> Pipeline:
    """A fitted linear model.

    The useful middle rung: it is *also* interpretable, but unlike GRIE its
    coefficients are learned rather than chosen. Comparing the three separates
    two questions the paper would otherwise conflate — how much is lost by being
    linear, and how much by being hand-specified rather than fitted.
    """
    return Pipeline(
        [
            ("scale", StandardScaler()),
            ("clf", LogisticRegression(max_iter=2000, random_state=seed)),
        ]
    )
