"""Tamper-evident audit trail.

Section 7 of the project plan rejects blockchain in favour of a hash chain:
each row stores a SHA-256 fingerprint over its own content *plus the previous
row's hash*. Editing or deleting any historical row breaks every hash after it,
which `verify_chain` detects. Same integrity guarantee, no distributed ledger.
"""
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.db.types import BigIntPK, JSONColumn


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id"),
        Index("ix_audit_created", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True)

    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Denormalised so the trail stays readable even if the user row is removed.
    actor_label: Mapped[str | None] = mapped_column(String(160))

    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(48), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)

    payload: Mapped[dict[str, Any]] = mapped_column(JSONColumn, default=dict, nullable=False)
    # Which engine wrote this: "gcce", "grie", "api", or "system".
    source: Mapped[str] = mapped_column(String(16), default="api", nullable=False)

    prev_hash: Mapped[str | None] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
