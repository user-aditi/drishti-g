"""GRIE - Governance Risk Intelligence Engine.

The v1 scorer is a deliberately transparent weighted sum. That is not a
placeholder for a "real" model: the project's research question is whether an
interpretable score costs accuracy against a black box, so this *is* the
treatment condition. The scikit-learn comparison model is the control and gets
built later, alongside the experiment harness - not here.

Every score returns its factors: raw value, how it was normalised to 0-100, the
weight applied, the resulting contribution, and a sentence a municipal officer
can read. A score without an explanation is a bug, not a shortcut.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from app.models.enums import RiskBand, RiskEntityType

MODEL_VERSION = "v1-weighted"

# Score at or above which GRIE raises a flag for human review.
REVIEW_THRESHOLD = 60.0


@dataclass(frozen=True)
class Factor:
    """One risk signal and how it is turned into a 0-100 sub-score."""

    key: str
    label: str
    weight: float
    # raw value -> 0-100. Kept explicit so the paper can report each curve.
    normalise: Callable[[float], float]
    describe: Callable[[float], str]


def _linear(cap: float) -> Callable[[float], float]:
    """Scale a raw value linearly onto 0-100, flattening once it passes `cap`.

    Capping matters: without it, one catastrophic project would saturate a
    contractor's score and hide every other signal.
    """

    def _fn(raw: float) -> float:
        if raw <= 0:
            return 0.0
        return min(100.0, (raw / cap) * 100.0)

    return _fn


def _proportion(raw: float) -> float:
    """A raw value already expressed as a 0-1 proportion."""
    return max(0.0, min(100.0, raw * 100.0))


def _boolean(raw: float) -> float:
    return 100.0 if raw else 0.0


def _identity(raw: float) -> float:
    """Already on a 0-100 scale."""
    return max(0.0, min(100.0, raw))


# --- Factor definitions per entity type -------------------------------------
# Weights within each set sum to 1.0. They are the tunable part of the model:
# the paper's fine-tuning step adjusts these and reports the before/after.

PROJECT_FACTORS: list[Factor] = [
    Factor(
        key="budget_overrun",
        label="Budget overrun",
        weight=0.30,
        normalise=_linear(0.5),  # 50% over budget reads as maximum risk
        describe=lambda raw: (
            f"Spending is {raw * 100:.0f}% over the allocated budget."
            if raw > 0
            else "Spending is within the allocated budget."
        ),
    ),
    Factor(
        key="schedule_delay_days",
        label="Schedule delay",
        weight=0.25,
        normalise=_linear(180.0),  # 180 days late reads as maximum risk
        describe=lambda raw: (
            f"Running {raw:.0f} days past the planned completion date."
            if raw > 0
            else "On or ahead of schedule."
        ),
    ),
    Factor(
        key="inspection_failure_rate",
        label="Inspection failures",
        weight=0.25,
        normalise=_proportion,
        describe=lambda raw: (
            f"{raw * 100:.0f}% of site inspections were failed."
            if raw > 0
            else "No failed inspections on record."
        ),
    ),
    Factor(
        key="linked_complaints",
        label="Linked complaints",
        weight=0.20,
        normalise=_linear(20.0),
        describe=lambda raw: (
            f"{int(raw)} citizen complaints are linked to this project's ward."
            if raw > 0
            else "No linked citizen complaints."
        ),
    ),
]

CONTRACTOR_FACTORS: list[Factor] = [
    Factor(
        key="avg_project_risk",
        label="Average project risk",
        weight=0.40,
        normalise=_identity,
        describe=lambda raw: f"Their projects average a risk score of {raw:.0f}/100.",
    ),
    Factor(
        key="late_delivery_rate",
        label="Late delivery history",
        weight=0.30,
        normalise=_proportion,
        describe=lambda raw: (
            f"{raw * 100:.0f}% of their completed projects finished late."
            if raw > 0
            else "No history of late delivery."
        ),
    ),
    Factor(
        key="inspection_failure_rate",
        label="Inspection failures",
        weight=0.20,
        normalise=_proportion,
        describe=lambda raw: (
            f"{raw * 100:.0f}% of inspections across their work were failed."
            if raw > 0
            else "No failed inspections across their work."
        ),
    ),
    Factor(
        key="is_blacklisted",
        label="Blacklisting",
        weight=0.10,
        normalise=_boolean,
        describe=lambda raw: "Currently blacklisted." if raw else "Not blacklisted.",
    ),
]

WARD_FACTORS: list[Factor] = [
    Factor(
        key="repeat_complaint_rate",
        label="Repeat complaints",
        weight=0.35,
        normalise=_proportion,
        describe=lambda raw: (
            f"{raw * 100:.0f}% of complaints here repeat an issue already reported."
        ),
    ),
    Factor(
        key="sla_breach_rate",
        label="SLA breaches",
        weight=0.30,
        normalise=_proportion,
        describe=lambda raw: (
            f"{raw * 100:.0f}% of complaints missed their resolution deadline."
        ),
    ),
    Factor(
        key="open_complaint_load",
        label="Open complaint load",
        weight=0.20,
        normalise=_linear(100.0),
        describe=lambda raw: f"{int(raw)} complaints are currently open in this ward.",
    ),
    Factor(
        key="avg_resolution_days",
        label="Resolution speed",
        weight=0.15,
        normalise=_linear(30.0),
        describe=lambda raw: f"Complaints take {raw:.1f} days to resolve on average.",
    ),
]

FACTOR_SETS: dict[RiskEntityType, list[Factor]] = {
    RiskEntityType.PROJECT: PROJECT_FACTORS,
    RiskEntityType.CONTRACTOR: CONTRACTOR_FACTORS,
    RiskEntityType.WARD: WARD_FACTORS,
}


@dataclass
class ScoreResult:
    entity_type: RiskEntityType
    entity_id: int
    score: float
    band: RiskBand
    factors: list[dict[str, Any]] = field(default_factory=list)
    model_version: str = MODEL_VERSION

    @property
    def needs_review(self) -> bool:
        return self.score >= REVIEW_THRESHOLD

    @property
    def top_reason(self) -> str:
        """The single biggest contributor - what a supervisor sees in the queue."""
        if not self.factors:
            return "No contributing factors recorded."
        return max(self.factors, key=lambda f: f["contribution"])["explanation"]


def band_for(score: float) -> RiskBand:
    if score >= 80:
        return RiskBand.SEVERE
    if score >= 60:
        return RiskBand.HIGH
    if score >= 40:
        return RiskBand.MODERATE
    return RiskBand.LOW


def score_entity(
    entity_type: RiskEntityType,
    entity_id: int,
    signals: dict[str, float],
) -> ScoreResult:
    """Turn raw signals into an explained 0-100 risk score.

    `signals` maps factor keys to raw values. A missing key scores 0 for that
    factor rather than raising: an entity with no inspections yet should read as
    low risk, not as unscoreable.
    """
    breakdown: list[dict[str, Any]] = []
    total = 0.0

    for factor in FACTOR_SETS[entity_type]:
        raw = float(signals.get(factor.key) or 0.0)
        normalised = factor.normalise(raw)
        contribution = normalised * factor.weight
        total += contribution
        breakdown.append(
            {
                "factor": factor.key,
                "label": factor.label,
                "raw": round(raw, 4),
                "normalised": round(normalised, 2),
                "weight": factor.weight,
                "contribution": round(contribution, 2),
                "explanation": factor.describe(raw),
            }
        )

    score = round(min(100.0, total), 2)
    # Descending contribution: an explanation should lead with what mattered most.
    breakdown.sort(key=lambda f: f["contribution"], reverse=True)

    return ScoreResult(
        entity_type=entity_type,
        entity_id=entity_id,
        score=score,
        band=band_for(score),
        factors=breakdown,
    )
