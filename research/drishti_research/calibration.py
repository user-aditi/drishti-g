"""Calibration constants for the synthetic dataset.

Every number the generator uses lives here, each with a ``source`` field, so a
reader can see exactly which parameters rest on published statistics and which
are the team's own assumptions.

**Read this before citing anything.** Parameters marked ``UNVERIFIED`` are
plausible defaults chosen to produce a realistic-looking distribution; they are
*not* drawn from a source and must be replaced with figures the team has looked
up and can cite before the paper is written. Leaving them unverified does not
break the experiment — the research question is about the *relationship*
between an interpretable and a black-box model on the same data, which holds
whatever the marginals are — but it does mean no claim about real Indian
governance rates can rest on them.

The honest framing for the paper, which Section 10 of the project plan already
commits to: this is a constructed dataset, because no public dataset links
budget, delay, inspection and complaint history to an outcome label.
"""

from dataclasses import dataclass, field
from typing import Literal

Verification = Literal["VERIFIED", "UNVERIFIED"]


@dataclass(frozen=True)
class Param:
    """One calibration constant and where it came from."""

    value: float
    source: str
    status: Verification = "UNVERIFIED"
    note: str = ""


@dataclass(frozen=True)
class Calibration:
    """Marginal distributions the generator is anchored to.

    Grouped by the entity they describe. Anything here that stays UNVERIFIED at
    submission should be reported in the paper as an assumption, not a finding.
    """

    # --- Area (sector / circle / zone) --------------------------------------
    sla_breach_rate_mean: Param = field(
        default_factory=lambda: Param(
            0.34,
            "Look up: CPGRAMS / state grievance portal annual disposal figures, "
            "share of grievances closed beyond the stated timeline.",
            "UNVERIFIED",
            "Drives how often complaints miss their deadline in the generated data.",
        )
    )
    sla_breach_rate_sd: Param = field(
        default_factory=lambda: Param(0.18, "Assumed spread across areas.", "UNVERIFIED")
    )

    repeat_complaint_rate_mean: Param = field(
        default_factory=lambda: Param(
            0.29,
            "Look up: municipal grievance portals publishing repeat/reopened counts.",
            "UNVERIFIED",
            "Share of complaints that repeat an issue already reported in the same area.",
        )
    )
    repeat_complaint_rate_sd: Param = field(
        default_factory=lambda: Param(0.15, "Assumed spread across areas.", "UNVERIFIED")
    )

    escalation_rate_mean: Param = field(
        default_factory=lambda: Param(
            0.17,
            "No public benchmark located; this is DRISHTI-G's own mechanism.",
            "UNVERIFIED",
            "Escalation is a feature of this system, so no external rate exists to match.",
        )
    )
    escalation_rate_sd: Param = field(
        default_factory=lambda: Param(0.12, "Assumed spread across areas.", "UNVERIFIED")
    )

    open_load_mean: Param = field(
        default_factory=lambda: Param(11.0, "Assumed, scaled to a Noida sector.", "UNVERIFIED")
    )
    open_load_sd: Param = field(default_factory=lambda: Param(7.0, "Assumed.", "UNVERIFIED"))

    resolution_days_mean: Param = field(
        default_factory=lambda: Param(
            6.2,
            "Look up: published average grievance disposal time for a comparable body.",
            "UNVERIFIED",
        )
    )
    resolution_days_sd: Param = field(default_factory=lambda: Param(4.0, "Assumed.", "UNVERIFIED"))

    # --- Projects ------------------------------------------------------------
    budget_overrun_mean: Param = field(
        default_factory=lambda: Param(
            0.14,
            "Look up: MoSPI Flash Report on Central Sector Projects reports cost "
            "overrun on delayed projects; a state-authority equivalent is closer.",
            "UNVERIFIED",
            "Mean fractional overrun across all projects, including on-budget ones.",
        )
    )
    budget_overrun_sd: Param = field(default_factory=lambda: Param(0.2, "Assumed.", "UNVERIFIED"))

    schedule_delay_days_mean: Param = field(
        default_factory=lambda: Param(
            48.0,
            "Look up: MoSPI Flash Report time-overrun distribution.",
            "UNVERIFIED",
        )
    )
    schedule_delay_days_sd: Param = field(
        default_factory=lambda: Param(55.0, "Assumed, heavily right-skewed.", "UNVERIFIED")
    )

    inspection_failure_rate_mean: Param = field(
        default_factory=lambda: Param(
            0.21,
            "Look up: CAG audit reports on municipal/authority works quality.",
            "UNVERIFIED",
        )
    )
    inspection_failure_rate_sd: Param = field(
        default_factory=lambda: Param(0.16, "Assumed.", "UNVERIFIED")
    )

    # --- Contractors ---------------------------------------------------------
    blacklist_base_rate: Param = field(
        default_factory=lambda: Param(
            0.07,
            "Look up: proportion of empanelled contractors currently debarred, "
            "from a state PWD or development authority list.",
            "UNVERIFIED",
        )
    )
    late_delivery_rate_mean: Param = field(
        default_factory=lambda: Param(0.38, "Assumed.", "UNVERIFIED")
    )
    late_delivery_rate_sd: Param = field(default_factory=lambda: Param(0.22, "Assumed.", "UNVERIFIED"))

    # --- Outcome -------------------------------------------------------------
    outcome_base_rate: Param = field(
        default_factory=lambda: Param(
            0.18,
            "Chosen so the positive class is neither rare nor balanced, which is "
            "the regime a governance risk model actually operates in.",
            "UNVERIFIED",
            "Share of entities that suffer a serious governance failure in the window.",
        )
    )


CALIBRATION = Calibration()


def unverified_parameters() -> list[tuple[str, Param]]:
    """Every parameter still resting on an assumption.

    Printed by the experiment runner so an unverified figure cannot quietly end
    up in a results table.
    """
    return [
        (name, value)
        for name, value in vars(CALIBRATION).items()
        if isinstance(value, Param) and value.status == "UNVERIFIED"
    ]
