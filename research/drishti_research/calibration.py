"""Calibration constants for the synthetic dataset.

Every number the generator uses lives here, each with a ``source`` field, so a
reader can see exactly which parameters rest on published statistics and which
are the team's own assumptions.

**Read this before citing anything.** Three parameters are ``VERIFIED`` against
published figures. Seventeen are ``DECLARED``: somebody searched, no public
source exists, and the paper reports them as assumptions rather than findings.

None of this breaks the experiment — the research question is about the
*relationship* between an interpretable and a black-box model on the same data,
which holds whatever the marginals are. It does mean **no claim about real
Indian governance rates may rest on the declared seventeen.**

Two things the search turned up that matter more than the numbers:

*The widely quoted CPGRAMS figure of 98% is a disposal rate, not a timeliness
rate.* Reading it as "only 2% breach their deadline" would overstate performance
dramatically. DARPG publishes disposal counts and average disposal time, but not
the share closed beyond the prescribed timeline, so ``sla_breach_rate_mean``
stays declared rather than borrowing a number that means something else.

*MoSPI's figures are the right kind of statistic from the wrong reference
class.* Its average time overrun across delayed central projects is about 36
months — roughly 1,080 days, plainly absurd for a municipal drain repair. Its
cost-overrun and delayed-share figures are used because they are the closest
published numbers that exist, and the paper states the mismatch rather than
hiding it. The 36-month figure is not used at all.

The honest framing for the paper, which Section 10 of the project plan already
commits to: this is a constructed dataset, because no public dataset links
budget, delay, inspection and complaint history to an outcome label.
"""

from dataclasses import dataclass, field
from typing import Literal

#: Three states, not two.
#:
#: ``UNVERIFIED`` used to mean both "nobody has looked" and "there is nothing to
#: find", which are different problems with different remedies. A parameter
#: somebody searched for and could not source is not waiting on effort — it is
#: waiting on a disclosure in the paper, and labelling it as homework nobody did
#: is its own small dishonesty.
#:
#: ``VERIFIED``   a published figure, cited in ``source``.
#: ``DECLARED``   searched for, no public source located, reported in the paper
#:                as an assumption. ``source`` says where the search went.
#: ``UNVERIFIED`` nobody has looked yet.
Verification = Literal["VERIFIED", "DECLARED", "DECLARED"]


@dataclass(frozen=True)
class Param:
    """One calibration constant and where it came from."""

    value: float
    source: str
    status: Verification = "DECLARED"
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
            "Searched: DARPG CPGRAMS monthly and annual reports publish disposal counts and average disposal time, but not the share disposed *beyond* the prescribed timeline. The widely quoted 98% is a disposal rate, not a timeliness rate, and reading it as one would overstate performance dramatically. No public figure located; declared as an assumption.",
            "DECLARED",
            "Drives how often complaints miss their deadline in the generated data.",
        )
    )
    sla_breach_rate_sd: Param = field(
        default_factory=lambda: Param(0.18, "Assumed spread across areas; no published dispersion located.", "DECLARED")
    )

    repeat_complaint_rate_mean: Param = field(
        default_factory=lambda: Param(
            0.29,
            "Searched: no Indian municipal grievance portal located that publishes repeat or reopened counts separately from total volume. Declared as an assumption.",
            "DECLARED",
            "Share of complaints that repeat an issue already reported in the same area.",
        )
    )
    repeat_complaint_rate_sd: Param = field(
        default_factory=lambda: Param(0.15, "Assumed spread across areas; no published dispersion located.", "DECLARED")
    )

    escalation_rate_mean: Param = field(
        default_factory=lambda: Param(
            0.17,
            "No public benchmark exists: escalation up a chain of command is DRISHTI-G's own mechanism, not a reported statistic. Declared as an assumption by construction.",
            "DECLARED",
            "Escalation is a feature of this system, so no external rate exists to match.",
        )
    )
    escalation_rate_sd: Param = field(
        default_factory=lambda: Param(0.12, "Assumed spread across areas; no published dispersion located.", "DECLARED")
    )

    open_load_mean: Param = field(
        default_factory=lambda: Param(11.0, "Assumed, scaled to a Noida sector; no published figure located.", "DECLARED")
    )
    open_load_sd: Param = field(default_factory=lambda: Param(7.0, "Assumed spread; no published dispersion located.", "DECLARED"))

    resolution_days_mean: Param = field(
        default_factory=lambda: Param(
            12.0,
            "DARPG, CPGRAMS Annual Report 2024: over 24 lakh grievances received in 2024, "
            "98% disposed at an average disposal time of 12 days (13 days for Central "
            "Ministries/Departments, Jan-Nov 2024). The prescribed timeline was reduced "
            "from 30 days to 21 days in the same reform round.",
            "VERIFIED",
        )
    )
    resolution_days_sd: Param = field(default_factory=lambda: Param(4.0, "Assumed spread; no published dispersion located.", "DECLARED"))

    # --- Projects ------------------------------------------------------------
    budget_overrun_mean: Param = field(
        default_factory=lambda: Param(
            0.187,
            "MoSPI, Flash Report on Central Sector Projects (March 2024): delays added "
            "roughly Rs 5 trillion to monitored projects, 18.7% of original cost. "
            "Reference class differs — central projects above Rs 150 crore, not "
            "municipal works — and the paper states that limitation rather than "
            "hiding it. It is the closest published figure located.",
            "VERIFIED",
            "Mean fractional overrun across all projects, including on-budget ones.",
        )
    )
    budget_overrun_sd: Param = field(default_factory=lambda: Param(0.2, "Assumed spread; no published dispersion located.", "DECLARED"))

    schedule_delay_days_mean: Param = field(
        default_factory=lambda: Param(
            48.0,
            "MoSPI reports an average time overrun of about 36 months across delayed central projects — roughly 1,080 days, and plainly the wrong reference class for a municipal drain repair. Using it would make the generated data absurd. Declared as an assumption, with the mismatch stated rather than the number borrowed.",
            "DECLARED",
        )
    )
    schedule_delay_days_sd: Param = field(
        default_factory=lambda: Param(55.0, "Assumed, heavily right-skewed; no published dispersion located.", "DECLARED")
    )

    inspection_failure_rate_mean: Param = field(
        default_factory=lambda: Param(
            0.21,
            "Searched: CAG performance audits report findings qualitatively and per-scheme rather than as a comparable failure rate across works. Declared as an assumption.",
            "DECLARED",
        )
    )
    inspection_failure_rate_sd: Param = field(
        default_factory=lambda: Param(0.16, "Assumed spread; no published dispersion located.", "DECLARED")
    )

    # --- Contractors ---------------------------------------------------------
    blacklist_base_rate: Param = field(
        default_factory=lambda: Param(
            0.07,
            "Searched: debarment lists are published by individual authorities without a denominator of empanelled contractors, so a rate cannot be derived. Declared as an assumption.",
            "DECLARED",
        )
    )
    late_delivery_rate_mean: Param = field(
        default_factory=lambda: Param(
            0.416,
            "MoSPI, Flash Report on Central Sector Projects (March 2024): 779 of 1,873 "
            "monitored projects running late, i.e. 41.6%. Same reference-class caveat "
            "as budget_overrun_mean.",
            "VERIFIED",
        )
    )
    late_delivery_rate_sd: Param = field(default_factory=lambda: Param(0.22, "Assumed spread; no published dispersion located.", "DECLARED"))

    # --- Outcome -------------------------------------------------------------
    outcome_base_rate: Param = field(
        default_factory=lambda: Param(
            0.18,
            "A design choice, not an estimate: set so the positive class is neither rare nor balanced, which is the regime a governance risk model actually operates in. Declared, and the sensitivity sweep varies the label threshold around it.",
            "DECLARED",
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
        if isinstance(value, Param) and value.status == "DECLARED"
    ]
