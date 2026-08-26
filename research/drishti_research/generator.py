"""Generates the linked governance dataset the paper needs.

No public dataset ties a project's budget, its delays, its inspection failures
and its complaint history to an outcome label — which is exactly why Section 10
of the project plan commits to constructing one and saying so plainly.

**How the outcome label is produced, and why it is fair.**

Entities are generated from a *latent* governance-quality variable that the
models never see. Observable signals are noisy, partly non-linear functions of
that latent state, and the outcome — did this area or contract suffer a serious
governance failure — is drawn from it too.

That structure is what makes the comparison meaningful:

* There is a real ground truth, so accuracy means something.
* Neither model is handed the answer; both must recover it from noisy proxies.
* The latent process contains **interactions and a threshold effect** that a
  weighted sum structurally cannot represent. This is deliberate, and it is the
  honest way to pose the question: we are giving the black box a genuine
  advantage rather than generating data that a linear model must win on.

If the interpretable model still lands close, that is a real result. If it does
not, that is also a real result, and the paper should report it.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .calibration import CALIBRATION, Calibration
from .model_spec import ModelSpec

# Entity types the harness generates. Sector, circle and zone share one factor
# set, so one geographic type stands in for all three.
AREA = "SECTOR"
PROJECT = "PROJECT"
CONTRACTOR = "CONTRACTOR"


@dataclass(frozen=True)
class GeneratorConfig:
    """How much data to make, and how hard to make it.

    ``regime`` is the honest part of this experiment.

    ``plausible`` is what the team believes governance data actually looks
    like: correlated positive signals, mild interactions, a large irreducible
    noise component. If an interpretable model matches a black box here, that
    is a real and useful finding — but it is a finding about *this kind of
    data*, not a general licence.

    ``adversarial`` deliberately builds in structure a weighted sum cannot
    represent, including a **non-monotone** effect: in an area that is coping,
    escalations mean problems are being surfaced and handled; in an area
    already drowning, a *low* escalation rate is the danger sign, because it
    means complaints are being closed without being worked. No monotone
    weighted sum can express "high is bad here, low is bad there".

    Reporting both is the point. One number from one regime would be a claim
    the experiment cannot support.
    """

    n_areas: int = 4000
    n_projects: int = 3000
    n_contractors: int = 2500
    seed: int = 20260826
    regime: str = "plausible"
    calibration: Calibration = CALIBRATION

    def __post_init__(self) -> None:
        if self.regime not in {"plausible", "adversarial"}:
            raise ValueError(f"unknown regime {self.regime!r}")


def _beta_from_moments(mean: float, sd: float, rng: np.random.Generator, size: int) -> np.ndarray:
    """Draw from a Beta matching a target mean and spread.

    Rates live on [0, 1], so a Beta is the right family: a truncated Normal
    would pile probability mass at the bounds and distort exactly the extremes
    the risk model cares about.
    """
    mean = float(np.clip(mean, 1e-3, 1 - 1e-3))
    max_sd = np.sqrt(mean * (1 - mean)) * 0.99
    sd = float(np.clip(sd, 1e-3, max_sd))

    common = mean * (1 - mean) / sd**2 - 1
    alpha = max(mean * common, 1e-3)
    beta = max((1 - mean) * common, 1e-3)
    return rng.beta(alpha, beta, size)


def _latent_quality(rng: np.random.Generator, size: int) -> np.ndarray:
    """Governance quality on roughly [0, 1]; higher is worse.

    Never exposed to either model — it is the thing both are trying to infer.
    """
    return np.clip(rng.beta(2.0, 3.2, size), 0.0, 1.0)


def _noisy(
    latent: np.ndarray,
    base: np.ndarray,
    strength: float,
    rng: np.random.Generator,
) -> np.ndarray:
    """Blend a latent-driven component with independent noise.

    `strength` is how much of the signal genuinely reflects governance quality.
    Below 1.0 the rest is measurement noise, which is what stops either model
    from reaching the latent state exactly.
    """
    noise = rng.normal(0.0, 0.12, latent.shape)
    return base * (1 - strength) + (latent + noise) * strength


def generate_areas(config: GeneratorConfig, rng: np.random.Generator) -> pd.DataFrame:
    cal = config.calibration
    n = config.n_areas
    latent = _latent_quality(rng, n)

    sla = np.clip(
        _noisy(latent, _beta_from_moments(cal.sla_breach_rate_mean.value, cal.sla_breach_rate_sd.value, rng, n), 0.62, rng),
        0.0,
        1.0,
    )
    repeat = np.clip(
        _noisy(latent, _beta_from_moments(cal.repeat_complaint_rate_mean.value, cal.repeat_complaint_rate_sd.value, rng, n), 0.55, rng),
        0.0,
        1.0,
    )
    escalation = np.clip(
        _noisy(latent, _beta_from_moments(cal.escalation_rate_mean.value, cal.escalation_rate_sd.value, rng, n), 0.58, rng),
        0.0,
        1.0,
    )
    open_load = np.clip(
        rng.normal(cal.open_load_mean.value, cal.open_load_sd.value, n) + latent * 18.0,
        0.0,
        None,
    )
    resolution_days = np.clip(
        rng.normal(cal.resolution_days_mean.value, cal.resolution_days_sd.value, n) + latent * 7.0,
        0.1,
        None,
    )

    # The latent failure process.
    #
    # The direct `latent` coefficient is kept small on purpose. An earlier
    # version had it dominate the logit, which made every observable a
    # near-redundant proxy for one hidden variable — an essentially additive,
    # one-dimensional problem that a weighted sum solves optimally. The
    # diagnostics caught it: explicit interaction terms bought 0.0005 AUC, so
    # the "interpretable model matches the black box" result was a property of
    # the generator rather than a finding. Most of the signal now flows through
    # terms a weighted sum structurally cannot express:
    #
    #   interaction — an area that both misses deadlines AND repeats complaints
    #     is worse than the sum of the two: work is being closed without being
    #     done, so the same fault keeps coming back.
    #   saturation  — past a threshold the backlog compounds rather than
    #     accumulating linearly.
    #   conditional — escalation means something quite different in an area that
    #     is otherwise coping than in one already missing its deadlines.
    interaction = sla * repeat
    saturation = np.maximum(0.0, open_load - 20.0) / 20.0
    struggling = (sla > 0.4).astype(float)

    if config.regime == "adversarial":
        # The non-monotone term. In a coping area escalation is healthy: someone
        # noticed and raised it. In a drowning area a LOW escalation rate is the
        # warning sign — complaints are being closed on paper without being
        # worked, so nothing ever reaches a senior officer. A weighted sum must
        # pick one direction for this factor and will be wrong for half the city.
        suppression = struggling * (1.0 - escalation)
        logit = (
            -2.30
            + 0.5 * latent
            + 0.4 * sla
            + 0.3 * repeat
            + 4.0 * interaction
            + 2.0 * saturation
            + 3.2 * suppression
            + 1.1 * escalation * (1 - struggling)
            + 0.3 * np.minimum(resolution_days / 14.0, 1.5)
        )
    else:
        logit = (
            -2.30
            + 1.6 * latent
            + 1.3 * sla
            + 1.1 * repeat
            + 1.4 * interaction
            + 0.9 * saturation
            + 0.9 * escalation
            + 0.5 * np.minimum(resolution_days / 14.0, 1.5)
        )
    prob = 1.0 / (1.0 + np.exp(-logit))
    outcome = rng.binomial(1, prob)

    return pd.DataFrame(
        {
            "entity_type": AREA,
            "slaBreachRate": sla,
            "repeatComplaintRate": repeat,
            "escalationRate": escalation,
            "openComplaintLoad": open_load,
            "avgResolutionDays": resolution_days,
            "latent_quality": latent,
            "failure_probability": prob,
            "outcome": outcome,
        }
    )


def generate_projects(config: GeneratorConfig, rng: np.random.Generator) -> pd.DataFrame:
    cal = config.calibration
    n = config.n_projects
    latent = _latent_quality(rng, n)

    overrun = np.clip(
        rng.normal(cal.budget_overrun_mean.value, cal.budget_overrun_sd.value, n) + latent * 0.28,
        0.0,
        None,
    )
    delay = np.clip(
        rng.normal(cal.schedule_delay_days_mean.value, cal.schedule_delay_days_sd.value, n)
        + latent * 90.0,
        0.0,
        None,
    )
    inspection_fail = np.clip(
        _noisy(
            latent,
            _beta_from_moments(cal.inspection_failure_rate_mean.value, cal.inspection_failure_rate_sd.value, rng, n),
            0.6,
            rng,
        ),
        0.0,
        1.0,
    )
    linked = np.clip(rng.poisson(4.0 + latent * 9.0, n), 0, None).astype(float)

    # A project that is both over budget and failing inspections is being built
    # badly *and* expensively — a different situation from either alone, and the
    # one that actually ends in an audit objection.
    overrun_n = np.minimum(overrun / 0.5, 1.0)
    delay_n = np.minimum(delay / 180.0, 1.0)
    interaction = overrun_n * inspection_fail
    # Delay only becomes dangerous once it is substantial; a fortnight late on a
    # six-month job is normal, three months late is a different animal.
    badly_late = (delay > 90).astype(float)

    if config.regime == "adversarial":
        # Money spent without progress is the tell. A project that is over
        # budget AND barely advanced is being drained; one that is over budget
        # because it is nearly finished is merely expensive. Same overrun,
        # opposite meaning — which a single weight cannot carry.
        stalled = (delay > 90).astype(float)
        logit = (
            -2.10
            + 0.4 * latent
            + 0.3 * overrun_n
            + 0.3 * delay_n
            + 0.5 * inspection_fail
            + 4.4 * interaction
            + 3.0 * overrun_n * stalled
            + 0.4 * np.minimum(linked / 20.0, 1.0)
        )
    else:
        logit = (
            -2.10
            + 1.5 * latent
            + 1.4 * overrun_n
            + 1.0 * delay_n
            + 1.2 * inspection_fail
            + 1.3 * interaction
            + 0.6 * badly_late * inspection_fail
            + 0.5 * np.minimum(linked / 20.0, 1.0)
        )
    prob = 1.0 / (1.0 + np.exp(-logit))
    outcome = rng.binomial(1, prob)

    return pd.DataFrame(
        {
            "entity_type": PROJECT,
            "budgetOverrun": overrun,
            "scheduleDelayDays": delay,
            "inspectionFailureRate": inspection_fail,
            "linkedComplaints": linked,
            "latent_quality": latent,
            "failure_probability": prob,
            "outcome": outcome,
        }
    )


def generate_contractors(config: GeneratorConfig, rng: np.random.Generator) -> pd.DataFrame:
    cal = config.calibration
    n = config.n_contractors
    latent = _latent_quality(rng, n)

    avg_project_risk = np.clip(rng.normal(38.0, 16.0, n) + latent * 42.0, 0.0, 100.0)
    late_delivery = np.clip(
        _noisy(
            latent,
            _beta_from_moments(cal.late_delivery_rate_mean.value, cal.late_delivery_rate_sd.value, rng, n),
            0.6,
            rng,
        ),
        0.0,
        1.0,
    )
    inspection_fail = np.clip(
        _noisy(
            latent,
            _beta_from_moments(cal.inspection_failure_rate_mean.value, cal.inspection_failure_rate_sd.value, rng, n),
            0.55,
            rng,
        ),
        0.0,
        1.0,
    )
    # Blacklisting is itself a consequence of poor performance, so it correlates
    # with the latent state rather than being drawn independently.
    blacklist_prob = np.clip(cal.blacklist_base_rate.value + latent * 0.22, 0.0, 1.0)
    blacklisted = rng.binomial(1, blacklist_prob).astype(float)

    # Blacklisting is a step change, not a slope: a debarred contractor whose
    # work is also failing inspection is a different proposition from one whose
    # paperwork simply lapsed.
    risk_n = avg_project_risk / 100.0

    if config.regime == "adversarial":
        logit = (
            -2.35
            + 0.4 * latent
            + 0.4 * risk_n
            + 0.3 * late_delivery
            + 0.4 * inspection_fail
            + 4.0 * risk_n * inspection_fail
            + 2.2 * blacklisted * (1.0 + inspection_fail)
            + 1.8 * late_delivery * (risk_n > 0.6).astype(float)
        )
    else:
        logit = (
            -2.35
            + 1.7 * latent
            + 1.5 * risk_n
            + 1.0 * late_delivery
            + 1.0 * inspection_fail
            + 1.2 * risk_n * inspection_fail
            + 1.4 * blacklisted
        )
    prob = 1.0 / (1.0 + np.exp(-logit))
    outcome = rng.binomial(1, prob)

    return pd.DataFrame(
        {
            "entity_type": CONTRACTOR,
            "avgProjectRisk": avg_project_risk,
            "lateDeliveryRate": late_delivery,
            "inspectionFailureRate": inspection_fail,
            "isBlacklisted": blacklisted,
            "latent_quality": latent,
            "failure_probability": prob,
            "outcome": outcome,
        }
    )


GENERATORS = {
    AREA: generate_areas,
    PROJECT: generate_projects,
    CONTRACTOR: generate_contractors,
}


def generate(entity_type: str, config: GeneratorConfig | None = None) -> pd.DataFrame:
    """Generate one entity type. Deterministic for a given seed."""
    config = config or GeneratorConfig()
    if entity_type not in GENERATORS:
        raise KeyError(f"no generator for {entity_type!r}; have {sorted(GENERATORS)}")

    # Offsetting the seed per entity type keeps each reproducible on its own,
    # rather than depending on the order the others were drawn in.
    offset = sum(ord(c) for c in entity_type)
    rng = np.random.default_rng(config.seed + offset)
    return GENERATORS[entity_type](config, rng)


def generate_all(config: GeneratorConfig | None = None) -> dict[str, pd.DataFrame]:
    config = config or GeneratorConfig()
    return {entity_type: generate(entity_type, config) for entity_type in GENERATORS}


def feature_matrix(frame: pd.DataFrame, spec: ModelSpec, entity_type: str) -> pd.DataFrame:
    """The observable columns, in the order the model spec declares them.

    Both models are handed exactly this — no latent state, no probability.
    """
    keys = spec.feature_keys(entity_type)
    missing = [k for k in keys if k not in frame.columns]
    if missing:
        raise KeyError(f"generated data for {entity_type} is missing {missing}")
    return frame[keys].copy()
