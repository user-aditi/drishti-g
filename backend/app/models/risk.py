"""GRIE's outputs: risk scores with their per-factor reasoning, and the
supervisor review queue fed by scores that cross a threshold.
"""
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.db.types import JSONColumn
from app.models.enums import ReviewStatus, RiskBand, RiskEntityType
from app.models.mixins import TimestampMixin

risk_entity_type_enum = Enum(RiskEntityType, name="risk_entity_type", native_enum=True)
risk_band_enum = Enum(RiskBand, name="risk_band", native_enum=True)


class RiskScore(Base):
    """One score, for one entity, at one point in time.

    Rows are append-only: recomputing writes a new row rather than updating, so
    a score's history is inspectable and the paper's experiments can replay it.
    """

    __tablename__ = "risk_scores"
    __table_args__ = (
        Index("ix_risk_entity", "entity_type", "entity_id", "computed_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_type: Mapped[RiskEntityType] = mapped_column(risk_entity_type_enum, nullable=False)
    entity_id: Mapped[int] = mapped_column(nullable=False)

    score: Mapped[float] = mapped_column(Float, nullable=False)
    band: Mapped[RiskBand] = mapped_column(risk_band_enum, nullable=False)

    # The whole point of GRIE: every score carries its own explanation.
    # Shape: [{"factor": "budget_overrun", "raw": 0.31, "normalised": 62.0,
    #          "weight": 0.25, "contribution": 15.5, "explanation": "..."}]
    factors: Mapped[list[dict[str, Any]]] = mapped_column(JSONColumn, default=list, nullable=False)

    # Which weight set produced this score, so results stay reproducible after
    # the weights are tuned.
    model_version: Mapped[str] = mapped_column(String(32), default="v1", nullable=False)

    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RiskFlag(Base, TimestampMixin):
    """A score that crossed the review threshold and needs a human decision."""

    __tablename__ = "risk_flags"

    id: Mapped[int] = mapped_column(primary_key=True)
    risk_score_id: Mapped[int] = mapped_column(
        ForeignKey("risk_scores.id", ondelete="CASCADE"), nullable=False
    )
    entity_type: Mapped[RiskEntityType] = mapped_column(risk_entity_type_enum, nullable=False)
    entity_id: Mapped[int] = mapped_column(nullable=False)

    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[ReviewStatus] = mapped_column(
        Enum(ReviewStatus, name="review_status", native_enum=True),
        default=ReviewStatus.PENDING,
        nullable=False,
    )
    reviewed_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(Text)

    score: Mapped["RiskScore"] = relationship()
