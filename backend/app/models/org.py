"""City structure: departments, wards, and complaint categories."""
from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class Department(Base, TimestampMixin):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    categories: Mapped[list["ComplaintCategory"]] = relationship(
        back_populates="department"
    )
    officials: Mapped[list["User"]] = relationship(back_populates="department")


class Ward(Base, TimestampMixin):
    __tablename__ = "wards"
    __table_args__ = (UniqueConstraint("ward_number", name="uq_ward_number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ward_number: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    zone: Mapped[str | None] = mapped_column(String(64))
    population: Mapped[int | None] = mapped_column(Integer)

    # Ward centroid. Used to route a complaint to the nearest ward when the
    # citizen's coordinates don't fall inside any stored boundary.
    centroid_lat: Mapped[float | None] = mapped_column(Float)
    centroid_lon: Mapped[float | None] = mapped_column(Float)


class ComplaintCategory(Base, TimestampMixin):
    """A complaint type (pothole, streetlight, garbage) owned by one department.

    `default_sla_hours` is what GCCE uses to stamp a due date at routing time.
    """

    __tablename__ = "complaint_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False
    )
    default_sla_hours: Mapped[int] = mapped_column(Integer, default=72, nullable=False)
    keywords: Mapped[str | None] = mapped_column(
        Text, doc="Comma-separated hints for GCCE's keyword fallback classifier"
    )

    department: Mapped["Department"] = relationship(back_populates="categories")
