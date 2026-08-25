"""GRIE scoring.

These tests pin the properties the research question depends on: the score is
bounded, monotonic in each factor, and every score carries a full explanation
whose contributions add up to the score itself.
"""
import pytest

from app.models.enums import RiskBand, RiskEntityType
from app.services import grie


def test_no_signals_scores_zero() -> None:
    result = grie.score_entity(RiskEntityType.PROJECT, 1, {})
    assert result.score == 0.0
    assert result.band == RiskBand.LOW
    # Still fully explained - "nothing is wrong" is itself an explanation.
    assert len(result.factors) == len(grie.PROJECT_FACTORS)


def test_score_is_bounded() -> None:
    """Absurd inputs must not produce a score above 100."""
    result = grie.score_entity(
        RiskEntityType.PROJECT,
        1,
        {
            "budget_overrun": 50.0,
            "schedule_delay_days": 100_000,
            "inspection_failure_rate": 5.0,
            "linked_complaints": 9_999,
        },
    )
    assert result.score == 100.0
    assert result.band == RiskBand.SEVERE


@pytest.mark.parametrize(
    "entity_type,factors",
    [
        (RiskEntityType.PROJECT, grie.PROJECT_FACTORS),
        (RiskEntityType.CONTRACTOR, grie.CONTRACTOR_FACTORS),
        (RiskEntityType.WARD, grie.WARD_FACTORS),
    ],
)
def test_weights_sum_to_one(entity_type, factors) -> None:
    """If weights drift from 1.0, a 'maximum risk' entity stops scoring 100 and
    the bands stop meaning what they say."""
    assert sum(f.weight for f in factors) == pytest.approx(1.0)


@pytest.mark.parametrize(
    "entity_type", [RiskEntityType.PROJECT, RiskEntityType.CONTRACTOR, RiskEntityType.WARD]
)
def test_contributions_reconstruct_the_score(entity_type) -> None:
    """The explanation must actually account for the number shown. A breakdown
    that does not add up would make the interpretability claim false."""
    signals = {f.key: 0.4 for f in grie.FACTOR_SETS[entity_type]}
    result = grie.score_entity(entity_type, 1, signals)
    assert sum(f["contribution"] for f in result.factors) == pytest.approx(
        result.score, abs=0.05
    )


def test_higher_signal_never_lowers_the_score() -> None:
    low = grie.score_entity(RiskEntityType.PROJECT, 1, {"budget_overrun": 0.1})
    high = grie.score_entity(RiskEntityType.PROJECT, 1, {"budget_overrun": 0.4})
    assert high.score > low.score


def test_factors_are_ordered_by_contribution() -> None:
    result = grie.score_entity(
        RiskEntityType.WARD,
        1,
        {"repeat_complaint_rate": 0.1, "sla_breach_rate": 0.9, "open_complaint_load": 5},
    )
    contributions = [f["contribution"] for f in result.factors]
    assert contributions == sorted(contributions, reverse=True)
    assert result.factors[0]["factor"] == "sla_breach_rate"


def test_top_reason_names_the_dominant_factor() -> None:
    result = grie.score_entity(RiskEntityType.WARD, 1, {"sla_breach_rate": 0.8})
    assert "deadline" in result.top_reason


@pytest.mark.parametrize(
    "score,expected",
    [
        (0, RiskBand.LOW),
        (39.9, RiskBand.LOW),
        (40, RiskBand.MODERATE),
        (59.9, RiskBand.MODERATE),
        (60, RiskBand.HIGH),
        (79.9, RiskBand.HIGH),
        (80, RiskBand.SEVERE),
        (100, RiskBand.SEVERE),
    ],
)
def test_band_boundaries(score, expected) -> None:
    assert grie.band_for(score) == expected


def test_review_threshold_matches_the_high_band() -> None:
    """A flag should be raised exactly when the band turns HIGH - two different
    thresholds would mean the queue and the badge disagree."""
    assert grie.band_for(grie.REVIEW_THRESHOLD) == RiskBand.HIGH
    assert grie.band_for(grie.REVIEW_THRESHOLD - 0.1) == RiskBand.MODERATE


def test_needs_review_follows_the_threshold() -> None:
    clean = grie.score_entity(RiskEntityType.CONTRACTOR, 1, {})
    assert not clean.needs_review

    bad = grie.score_entity(
        RiskEntityType.CONTRACTOR,
        1,
        {
            "avg_project_risk": 85,
            "late_delivery_rate": 0.8,
            "inspection_failure_rate": 0.6,
            "is_blacklisted": 1,
        },
    )
    assert bad.needs_review


def test_every_factor_carries_an_explanation() -> None:
    result = grie.score_entity(RiskEntityType.CONTRACTOR, 1, {"late_delivery_rate": 0.5})
    for factor in result.factors:
        assert factor["explanation"].strip()
        assert set(factor) == {
            "factor",
            "label",
            "raw",
            "normalised",
            "weight",
            "contribution",
            "explanation",
        }


def test_none_signal_is_treated_as_zero() -> None:
    """Missing data must read as 'no evidence of risk', not crash the scorer."""
    result = grie.score_entity(RiskEntityType.WARD, 1, {"sla_breach_rate": None})
    assert result.score == 0.0
