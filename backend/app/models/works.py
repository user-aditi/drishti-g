"""Contractors and municipal projects.

These exist from the start so GRIE has more than one kind of entity to score —
the signals in the plan (budget overrun, delay history, inspection failures)
only mean something against a project and the contractor who ran it.
"""
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, Float, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.org import Department, Ward


class Contractor(Base, TimestampMixin):
    __tablename__ = "contractors"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    registration_no: Mapped[str | None] = mapped_column(String(64))
    contact_email: Mapped[str | None] = mapped_column(String(255))
    is_blacklisted: Mapped[bool] = mapped_column(default=False, nullable=False)

    projects: Mapped[list["Project"]] = relationship(back_populates="contractor")


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    contractor_id: Mapped[int | None] = mapped_column(
        ForeignKey("contractors.id", ondelete="SET NULL")
    )
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL")
    )
    ward_id: Mapped[int | None] = mapped_column(ForeignKey("wards.id", ondelete="SET NULL"))

    # Money is Numeric, never float — GRIE divides these and the paper reports
    # the results.
    budget_allocated: Mapped[float | None] = mapped_column(Numeric(14, 2))
    budget_spent: Mapped[float | None] = mapped_column(Numeric(14, 2))

    planned_start: Mapped[date | None] = mapped_column(Date)
    planned_end: Mapped[date | None] = mapped_column(Date)
    actual_start: Mapped[date | None] = mapped_column(Date)
    actual_end: Mapped[date | None] = mapped_column(Date)

    completion_pct: Mapped[float | None] = mapped_column(Float, default=0.0)

    contractor: Mapped["Contractor | None"] = relationship(back_populates="projects")
    department: Mapped["Department | None"] = relationship()
    ward: Mapped["Ward | None"] = relationship()
    inspections: Mapped[list["Inspection"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Inspection(Base, TimestampMixin):
    """A site inspection. Repeated failures are one of GRIE's strongest signals."""

    __tablename__ = "inspections"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    inspector_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    scheduled_for: Mapped[date | None] = mapped_column(Date)
    conducted_on: Mapped[date | None] = mapped_column(Date)
    passed: Mapped[bool | None] = mapped_column()
    score: Mapped[int | None] = mapped_column(Integer, doc="0-100 inspection score")
    remarks: Mapped[str | None] = mapped_column(Text)

    project: Mapped["Project"] = relationship(back_populates="inspections")
