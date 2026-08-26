"""The experiment: interpretable vs black box, on the same data.

Runs the whole protocol and writes the tables the paper quotes:

    for each regime (plausible, adversarial)
      for each entity type
        generate the dataset
        split train / test once, stratified
        score the untuned GRIE model         (the treatment)
        tune GRIE weights on train only      (the fine-tuning step)
        fit logistic regression              (fitted, still interpretable)
        fit gradient boosting                (the control)
        fit random forest                    (a second control)
        report every metric on the held-out test split
        repeat across seeds and report the spread

Two design choices carry most of the honesty here.

**Both regimes are reported.** A single number from a single data-generating
process would be a claim the experiment cannot support. ``plausible`` is what
the team believes governance data looks like; ``adversarial`` deliberately
builds in structure a weighted sum cannot represent. See ``generator.py``.

**Gaps are reported as skill, not raw AUC.** Raw AUC includes the 0.5 a coin
flip earns and stops at a ceiling the noise floor imposes; on a task where that
band is only 0.3 wide, a 0.005 difference looks negligible and is not. Skill
rescales onto the achievable band, so 1.0 is the Bayes optimum and 0.0 is
chance. ``diagnostics.py`` reports the ceiling and must be run alongside this.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

from .calibration import unverified_parameters
from .generator import GeneratorConfig, feature_matrix, generate
from .model_spec import ModelSpec, load_spec
from .models import InterpretableScorer, build_black_box, build_logistic, build_random_forest
from .tuning import tune_weights

RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"

ENTITY_TYPES = ["SECTOR", "PROJECT", "CONTRACTOR"]
REGIMES = ["plausible", "adversarial"]
SEEDS = [20260826, 20260827, 20260828, 20260829, 20260830]

GRIE_UNTUNED = "GRIE (hand-specified)"
GRIE_TUNED = "GRIE (tuned weights)"


@dataclass
class ModelScore:
    model: str
    interpretable: bool
    roc_auc: float
    average_precision: float
    brier: float
    precision_at_threshold: float
    recall_at_threshold: float

    def as_row(self) -> dict[str, object]:
        return asdict(self)


def _evaluate(
    name: str,
    interpretable: bool,
    y_true: np.ndarray,
    probabilities: np.ndarray,
    predictions: np.ndarray,
) -> ModelScore:
    return ModelScore(
        model=name,
        interpretable=interpretable,
        roc_auc=float(roc_auc_score(y_true, probabilities)),
        average_precision=float(average_precision_score(y_true, probabilities)),
        # Reported, but read with care for the untuned scorer: a weighted sum is
        # a ranking, not a calibrated probability, so a poor Brier score there is
        # expected rather than damning.
        brier=float(brier_score_loss(y_true, np.clip(probabilities, 0, 1))),
        precision_at_threshold=float(precision_score(y_true, predictions, zero_division=0)),
        recall_at_threshold=float(recall_score(y_true, predictions, zero_division=0)),
    )


def run_one(
    entity_type: str,
    spec: ModelSpec,
    seed: int,
    regime: str = "plausible",
    test_size: float = 0.3,
) -> tuple[list[ModelScore], dict[str, float], float]:
    """One entity type, one seed, one regime.

    Returns the model scores, the tuned weight set, and the Bayes ceiling for
    this split — every gap is reported against that ceiling, because a 0.005 AUC
    difference means one thing with 0.20 of headroom and quite another with 0.01.
    """
    frame = generate(entity_type, GeneratorConfig(seed=seed, regime=regime))

    X = feature_matrix(frame, spec, entity_type)
    y = frame["outcome"].to_numpy()
    truth = frame["failure_probability"].to_numpy()

    indices = np.arange(len(X))
    idx_train, idx_test = train_test_split(
        indices, test_size=test_size, random_state=seed, stratify=y
    )
    X_train, X_test = X.iloc[idx_train], X.iloc[idx_test]
    y_train, y_test = y[idx_train], y[idx_test]

    bayes_ceiling = float(roc_auc_score(y_test, truth[idx_test]))

    scores: list[ModelScore] = []

    # --- Treatment: GRIE as it ships -----------------------------------------
    grie = InterpretableScorer(spec, entity_type)
    scores.append(
        _evaluate(
            GRIE_UNTUNED, True, y_test, grie.predict_proba(X_test)[:, 1], grie.predict(X_test)
        )
    )

    # --- Treatment, tuned on the training split only -------------------------
    tuning = tune_weights(spec, entity_type, X_train, y_train, seed=seed)
    tuned = InterpretableScorer(spec, entity_type, weights=tuning.weights)
    scores.append(
        _evaluate(
            GRIE_TUNED, True, y_test, tuned.predict_proba(X_test)[:, 1], tuned.predict(X_test)
        )
    )

    # --- Fitted linear: interpretable, but learned ---------------------------
    logistic = build_logistic(seed).fit(X_train, y_train)
    scores.append(
        _evaluate(
            "Logistic regression",
            True,
            y_test,
            logistic.predict_proba(X_test)[:, 1],
            logistic.predict(X_test),
        )
    )

    # --- Controls: the black boxes -------------------------------------------
    for name, builder in [
        ("Gradient boosting", build_black_box),
        ("Random forest", build_random_forest),
    ]:
        model = builder(seed).fit(X_train, y_train)
        scores.append(
            _evaluate(
                name, False, y_test, model.predict_proba(X_test)[:, 1], model.predict(X_test)
            )
        )

    return scores, tuning.weights, bayes_ceiling


def run_experiment(
    spec: ModelSpec | None = None,
    seeds: list[int] | None = None,
    entity_types: list[str] | None = None,
    regimes: list[str] | None = None,
) -> pd.DataFrame:
    """The full protocol across regimes, entity types and seeds."""
    spec = spec or load_spec()
    seeds = seeds or SEEDS
    entity_types = entity_types or ENTITY_TYPES
    regimes = regimes or REGIMES

    rows: list[dict[str, object]] = []
    tuned_weights: dict[str, dict[str, float]] = {}

    for regime in regimes:
        for entity_type in entity_types:
            for seed in seeds:
                scores, weights, ceiling = run_one(entity_type, spec, seed, regime=regime)
                if seed == seeds[0]:
                    tuned_weights[f"{regime}/{entity_type}"] = weights
                for score in scores:
                    rows.append(
                        {
                            "regime": regime,
                            "entity_type": entity_type,
                            "seed": seed,
                            "bayes_ceiling": ceiling,
                            **score.as_row(),
                        }
                    )

    frame = pd.DataFrame(rows)
    frame.attrs["tuned_weights"] = tuned_weights
    return frame


def summarise(results: pd.DataFrame) -> pd.DataFrame:
    """Mean and spread per model, per entity type, per regime.

    ``skill`` is the number to read. Raw AUC includes the 0.5 every coin flip
    earns and stops at a ceiling the noise floor imposes, so on a noise-limited
    task it compresses real differences into the third decimal. Skill rescales
    onto the achievable band: 1.0 is the Bayes optimum, 0.0 is chance.
    """
    summary = (
        results.groupby(["regime", "entity_type", "model", "interpretable"], as_index=False)
        .agg(
            roc_auc_mean=("roc_auc", "mean"),
            roc_auc_sd=("roc_auc", "std"),
            ceiling=("bayes_ceiling", "mean"),
            ap_mean=("average_precision", "mean"),
            precision_mean=("precision_at_threshold", "mean"),
            recall_mean=("recall_at_threshold", "mean"),
        )
        .sort_values(["regime", "entity_type", "roc_auc_mean"], ascending=[True, True, False])
        .reset_index(drop=True)
    )
    summary["skill"] = (summary["roc_auc_mean"] - 0.5) / (summary["ceiling"] - 0.5)
    return summary


def interpretability_gap(summary: pd.DataFrame) -> pd.DataFrame:
    """The paper's headline table.

    How far the interpretable model sits behind the best black box, in skill —
    and how much of that distance the tuning step recovered. A negative gap
    means the interpretable model is ahead, which is reported as such rather
    than hidden behind an absolute value.
    """
    rows = []
    for (regime, entity_type), group in summary.groupby(["regime", "entity_type"]):
        black_box = group[~group["interpretable"]].iloc[0]
        untuned = group[group["model"] == GRIE_UNTUNED].iloc[0]
        tuned = group[group["model"] == GRIE_TUNED].iloc[0]

        gap_before = black_box["skill"] - untuned["skill"]
        gap_after = black_box["skill"] - tuned["skill"]

        if gap_before <= 1e-6:
            closed = "n/a (already ahead)"
        elif gap_before < 0.01:
            # A percentage of a gap this small is noise dressed as a finding.
            closed = "n/a (gap negligible)"
        else:
            closed = f"{min((gap_before - gap_after) / gap_before, 1.0):.0%}"

        rows.append(
            {
                "regime": regime,
                "entity_type": entity_type,
                "best_black_box": black_box["model"],
                "black_box_skill": round(float(black_box["skill"]), 4),
                "grie_skill": round(float(untuned["skill"]), 4),
                "grie_tuned_skill": round(float(tuned["skill"]), 4),
                "skill_gap": round(float(gap_before), 4),
                "skill_gap_after_tuning": round(float(gap_after), 4),
                "gap_closed_by_tuning": closed,
            }
        )

    return pd.DataFrame(rows)


def main() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    spec = load_spec()

    print(f"DRISHTI-G research harness — model {spec.model_version}")
    print(f"{len(REGIMES)} regimes × {len(ENTITY_TYPES)} entity types × {len(SEEDS)} seeds\n")

    unverified = unverified_parameters()
    if unverified:
        print(
            f"WARNING: {len(unverified)} calibration parameters are still unverified "
            "assumptions. They are fine for a model comparison — the question is about "
            "the relationship between two models on the same data — but no claim about "
            "real Indian governance rates may rest on them. See calibration.py.\n"
        )

    results = run_experiment(spec=spec)
    summary = summarise(results)
    gap = interpretability_gap(summary)

    for regime in REGIMES:
        print(f"\n{'=' * 78}")
        print(f"Regime: {regime}")
        print("=" * 78 + "\n")
        block = summary[summary["regime"] == regime].drop(columns=["regime"])
        print(block.round(4).to_string(index=False))

    print(f"\n\n{'=' * 78}")
    print("The interpretability gap, in skill (1.0 = Bayes optimum, 0.0 = chance)")
    print("=" * 78 + "\n")
    print(gap.to_string(index=False))

    print("\n\nTuned weights (first seed)\n")
    for key, weights in results.attrs["tuned_weights"].items():
        entity_type = key.split("/")[1]
        original = spec.weights(entity_type)
        print(f"  {key}")
        for factor, value in sorted(weights.items(), key=lambda kv: -abs(kv[1] - original[kv[0]])):
            print(f"    {factor:<24} {original[factor]:.3f} -> {value:.3f}  ({value - original[factor]:+.3f})")

    results.to_csv(RESULTS_DIR / "raw-results.csv", index=False)
    summary.to_csv(RESULTS_DIR / "summary.csv", index=False)
    gap.to_csv(RESULTS_DIR / "interpretability-gap.csv", index=False)
    (RESULTS_DIR / "tuned-weights.json").write_text(
        json.dumps(results.attrs["tuned_weights"], indent=2) + "\n", encoding="utf-8"
    )

    print(f"\n\nWrote results to {RESULTS_DIR}")
    print("Run `python -m drishti_research.diagnostics` alongside this — the gap "
          "numbers are only meaningful with the ceiling and overfit checks beside them.")


if __name__ == "__main__":
    main()
