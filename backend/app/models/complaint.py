from datetime import datetime

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
from app.models.enums import ComplaintStatus, Priority
from app.models.mixins import TimestampMixin
from app.models.org import ComplaintCategory, Department, Ward
from app.models.user import User

# One shared type object per native enum: reusing the instance stops SQLAlchemy
# from trying to CREATE TYPE twice when two columns share it.
complaint_status_enum = Enum(ComplaintStatus, name="complaint_status", native_enum=True)
priority_enum = Enum(Priority, name="priority", native_enum=True)


class Complaint(Base, TimestampMixin):
    __tablename__ = "complaints"
    __table_args__ = (
        Index("ix_complaints_status_ward", "status", "ward_id"),
        Index("ix_complaints_citizen", "citizen_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Human-facing reference the citizen quotes on the phone, e.g. DG-2026-000042
    reference_no: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)

    citizen_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    photo_url: Mapped[str | None] = mapped_column(String(512))

    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    address: Mapped[str | None] = mapped_column(Text)

    # Set by GCCE at routing time, not by the citizen.
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("complaint_categories.id", ondelete="SET NULL")
    )
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL")
    )
    ward_id: Mapped[int | None] = mapped_column(ForeignKey("wards.id", ondelete="SET NULL"))
    assigned_to_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    status: Mapped[ComplaintStatus] = mapped_column(
        complaint_status_enum,
        default=ComplaintStatus.SUBMITTED,
        nullable=False,
    )
    priority: Mapped[Priority] = mapped_column(
        priority_enum,
        default=Priority.MEDIUM,
        nullable=False,
    )

    sla_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Set when GCCE (or a supervisor) marks this a duplicate of an earlier one.
    duplicate_of_id: Mapped[int | None] = mapped_column(
        ForeignKey("complaints.id", ondelete="SET NULL")
    )

    citizen: Mapped["User"] = relationship(foreign_keys=[citizen_id])
    assignee: Mapped["User | None"] = relationship(foreign_keys=[assigned_to_id])
    category: Mapped["ComplaintCategory | None"] = relationship()
    department: Mapped["Department | None"] = relationship()
    ward: Mapped["Ward | None"] = relationship()
    history: Mapped[list["ComplaintStatusHistory"]] = relationship(
        back_populates="complaint", cascade="all, delete-orphan"
    )


class ComplaintStatusHistory(Base):
    """Every status transition, so a citizen can see the full journey."""

    __tablename__ = "complaint_status_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    complaint_id: Mapped[int] = mapped_column(
        ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_status: Mapped[ComplaintStatus | None] = mapped_column(complaint_status_enum)
    to_status: Mapped[ComplaintStatus] = mapped_column(complaint_status_enum, nullable=False)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
    evidence_url: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    complaint: Mapped["Complaint"] = relationship(back_populates="history")
