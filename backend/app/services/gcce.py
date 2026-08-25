"""GCCE - Governance Capability Coordination Engine.

Every state-changing action in DRISHTI-G goes through here. GCCE answers three
questions in a fixed order, and writes an audit event for each answer:

  1. WHERE does this belong?   -> resolve category, department, ward
  2. WHO is accountable?       -> pick an assignee
  3. WHAT ELSE must happen?    -> notifications, inspections, GRIE re-scoring

It is deliberately deterministic. The plan rules out autonomous multi-step AI
agents, and coordination is exactly the place where unpredictability would be
most expensive: the same complaint must always route the same way, and a
supervisor must be able to explain why it did.

The graph projection (Neo4j) is written alongside Postgres so GCCE's routing and
GRIE's propagation queries can traverse relationships instead of joining.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.complaint import Complaint, ComplaintStatusHistory
from app.models.enums import ComplaintStatus, Priority, UserRole
from app.models.notification import Notification
from app.models.org import ComplaintCategory, Ward
from app.models.user import User
from app.services import audit

logger = logging.getLogger(__name__)

SOURCE = "gcce"


@dataclass
class RoutingDecision:
    """What GCCE decided, and why. Returned to the caller and audited verbatim."""

    category_id: int | None = None
    department_id: int | None = None
    ward_id: int | None = None
    assignee_id: int | None = None
    priority: Priority = Priority.MEDIUM
    sla_due_at: datetime | None = None
    reasons: list[str] = field(default_factory=list)
    triggered: list[str] = field(default_factory=list)

    def as_payload(self) -> dict[str, Any]:
        return {
            "category_id": self.category_id,
            "department_id": self.department_id,
            "ward_id": self.ward_id,
            "assignee_id": self.assignee_id,
            "priority": self.priority.value,
            "sla_due_at": self.sla_due_at.isoformat() if self.sla_due_at else None,
            "reasons": self.reasons,
            "triggered": self.triggered,
        }


# --- Step 1: where does this belong? ----------------------------------------


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance. Used only to pick the nearest ward centroid."""
    radius_km = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * radius_km * asin(sqrt(a))


def resolve_ward(db: Session, complaint: Complaint) -> tuple[int | None, str]:
    """Nearest ward centroid, falling back to the citizen's registered ward.

    Real boundary polygons (PostGIS ST_Contains) are the right answer and slot in
    here later; centroid distance is accurate enough to demo and needs no
    boundary data we do not have yet.
    """
    if complaint.latitude is not None and complaint.longitude is not None:
        wards = (
            db.execute(
                select(Ward).where(
                    Ward.centroid_lat.is_not(None), Ward.centroid_lon.is_not(None)
                )
            )
            .scalars()
            .all()
        )
        if wards:
            nearest = min(
                wards,
                key=lambda w: _haversine_km(
                    complaint.latitude, complaint.longitude, w.centroid_lat, w.centroid_lon
                ),
            )
            distance = _haversine_km(
                complaint.latitude, complaint.longitude, nearest.centroid_lat, nearest.centroid_lon
            )
            return nearest.id, (
                f"Located in Ward {nearest.ward_number} ({nearest.name}), "
                f"{distance:.1f} km from its centre."
            )

    citizen = db.get(User, complaint.citizen_id)
    if citizen is not None and citizen.ward_id is not None:
        return citizen.ward_id, "No usable coordinates; used the citizen's registered ward."

    return None, "Could not determine a ward - needs manual routing."


def resolve_category(db: Session, complaint: Complaint) -> tuple[int | None, str]:
    """Keyword match over category hints.

    This is the fallback path. When the MuRIL/IndicBERT classifier lands it
    becomes the primary and this stays as the answer for low-confidence
    predictions, so a complaint is never left uncategorised.
    """
    if complaint.category_id is not None:
        return complaint.category_id, "Category was supplied with the complaint."

    text = f"{complaint.title} {complaint.description}".lower()
    categories = db.execute(select(ComplaintCategory)).scalars().all()

    best: tuple[ComplaintCategory, int] | None = None
    for category in categories:
        hints = [k.strip().lower() for k in (category.keywords or "").split(",") if k.strip()]
        hits = sum(1 for hint in hints if hint in text)
        if hits and (best is None or hits > best[1]):
            best = (category, hits)

    if best is not None:
        category, hits = best
        return category.id, (
            f"Matched category '{category.name}' on {hits} keyword"
            f"{'s' if hits != 1 else ''} in the complaint text."
        )

    return None, "No category keywords matched - left for manual categorisation."


# --- Step 2: who is accountable? --------------------------------------------


def pick_assignee(db: Session, department_id: int | None, ward_id: int | None) -> tuple[int | None, str]:
    """Least-loaded field official serving this department and ward.

    Load is counted as currently-open complaints, so work spreads instead of
    piling onto whoever happens to sort first.
    """
    if department_id is None or ward_id is None:
        return None, "Department or ward unresolved, so no assignee was chosen."

    open_load = (
        select(Complaint.assigned_to_id, func.count().label("open_count"))
        .where(
            Complaint.status.in_(
                [ComplaintStatus.ASSIGNED, ComplaintStatus.IN_PROGRESS, ComplaintStatus.ROUTED]
            )
        )
        .group_by(Complaint.assigned_to_id)
        .subquery()
    )

    row = db.execute(
        select(User, func.coalesce(open_load.c.open_count, 0).label("load"))
        .outerjoin(open_load, open_load.c.assigned_to_id == User.id)
        .where(
            User.role == UserRole.FIELD_OFFICIAL,
            User.is_active.is_(True),
            User.department_id == department_id,
            User.ward_id == ward_id,
        )
        .order_by("load", User.id)
        .limit(1)
    ).first()

    if row is None:
        return None, "No active field official covers this department and ward."

    official, load = row
    return official.id, (
        f"Assigned to {official.full_name}, the least-loaded official for this "
        f"department and ward ({load} open task{'s' if load != 1 else ''})."
    )


def derive_priority(db: Session, complaint: Complaint, ward_id: int | None) -> tuple[Priority, str]:
    """Escalate when a ward is already saturated with open complaints.

    A pothole in a ward with 40 open issues is a different problem from the same
    pothole in a quiet ward, and GRIE should see that reflected in the priority.
    """
    if ward_id is None:
        return Priority.MEDIUM, "Default priority; ward unknown."

    open_count = db.execute(
        select(func.count())
        .select_from(Complaint)
        .where(
            Complaint.ward_id == ward_id,
            Complaint.status.notin_(
                [ComplaintStatus.CLOSED, ComplaintStatus.REJECTED, ComplaintStatus.DUPLICATE]
            ),
        )
    ).scalar_one()

    if open_count >= 30:
        return Priority.HIGH, f"Raised to high: {open_count} complaints already open in this ward."
    return Priority.MEDIUM, f"Standard priority; {open_count} complaints open in this ward."


# --- The coordinator itself --------------------------------------------------


def route_complaint(db: Session, complaint: Complaint, actor: User | None = None) -> RoutingDecision:
    """Coordinate a newly filed complaint. Does not commit - the caller owns the
    transaction, so routing and its audit trail land together or not at all.
    """
    decision = RoutingDecision()

    category_id, category_reason = resolve_category(db, complaint)
    decision.category_id = category_id
    decision.reasons.append(category_reason)

    if category_id is not None:
        category = db.get(ComplaintCategory, category_id)
        if category is not None:
            decision.department_id = category.department_id
            decision.sla_due_at = datetime.now(timezone.utc) + timedelta(
                hours=category.default_sla_hours
            )
            decision.reasons.append(
                f"Routed to the {category.department.name} department with a "
                f"{category.default_sla_hours}-hour resolution target."
            )

    ward_id, ward_reason = resolve_ward(db, complaint)
    decision.ward_id = ward_id
    decision.reasons.append(ward_reason)

    decision.priority, priority_reason = derive_priority(db, complaint, ward_id)
    decision.reasons.append(priority_reason)

    assignee_id, assignee_reason = pick_assignee(db, decision.department_id, ward_id)
    decision.assignee_id = assignee_id
    decision.reasons.append(assignee_reason)

    # Apply the decision.
    complaint.category_id = decision.category_id
    complaint.department_id = decision.department_id
    complaint.ward_id = decision.ward_id
    complaint.assigned_to_id = decision.assignee_id
    complaint.priority = decision.priority
    complaint.sla_due_at = decision.sla_due_at

    previous_status = complaint.status
    complaint.status = (
        ComplaintStatus.ASSIGNED if assignee_id is not None else ComplaintStatus.ROUTED
    )

    db.add(
        ComplaintStatusHistory(
            complaint_id=complaint.id,
            from_status=previous_status,
            to_status=complaint.status,
            actor_id=actor.id if actor else None,
            note="Routed by GCCE. " + " ".join(decision.reasons),
        )
    )

    # Step 3: downstream effects.
    if assignee_id is not None:
        db.add(
            Notification(
                user_id=assignee_id,
                title=f"New task: {complaint.title}",
                body=(
                    f"Complaint {complaint.reference_no} has been assigned to you. "
                    f"Priority: {decision.priority.value}."
                ),
                link=f"/tasks/{complaint.id}",
            )
        )
        decision.triggered.append("notify_assignee")

    db.add(
        Notification(
            user_id=complaint.citizen_id,
            title="Your complaint has been registered",
            body=(
                f"Complaint {complaint.reference_no} was received and routed. "
                "You will be notified as it progresses."
            ),
            link=f"/complaints/{complaint.id}",
        )
    )
    decision.triggered.append("notify_citizen")

    if ward_id is not None:
        # GRIE re-scores the ward because its complaint load just changed.
        decision.triggered.append(f"grie_rescore:ward:{ward_id}")

    audit.record(
        db,
        action="complaint.routed",
        entity_type="complaint",
        entity_id=complaint.id,
        payload=decision.as_payload(),
        actor_id=actor.id if actor else None,
        actor_label=actor.full_name if actor else "GCCE",
        source=SOURCE,
    )

    logger.info(
        "GCCE routed complaint %s -> dept=%s ward=%s assignee=%s",
        complaint.reference_no,
        decision.department_id,
        decision.ward_id,
        decision.assignee_id,
    )
    return decision
