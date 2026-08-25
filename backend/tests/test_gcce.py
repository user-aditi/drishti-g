"""GCCE routing.

The property that matters most here is determinism: the same complaint must
route the same way every time, and the reasoning must be recorded.
"""
from sqlalchemy.orm import Session

from app.models.audit import AuditEvent
from app.models.complaint import Complaint
from app.models.enums import ComplaintStatus, Priority, UserRole
from app.models.notification import Notification
from app.services import gcce


def _complaint(db: Session, citizen_id: int, **kwargs) -> Complaint:
    defaults = {
        "reference_no": f"DG-TEST-{citizen_id}-{kwargs.pop('n', 1)}",
        "title": "Street light not working",
        "description": "The street light near the park has been off for a week.",
        "citizen_id": citizen_id,
        "status": ComplaintStatus.SUBMITTED,
    }
    defaults.update(kwargs)
    complaint = Complaint(**defaults)
    db.add(complaint)
    db.flush()
    return complaint


class TestCategoryResolution:
    def test_matches_english_keywords(self, db_session, city, make_user) -> None:
        citizen = make_user("c1@example.com")
        complaint = _complaint(db_session, citizen.id)
        category_id, reason = gcce.resolve_category(db_session, complaint)
        assert category_id == city["category"].id
        assert "Matched category" in reason

    def test_matches_hinglish_keywords(self, db_session, city, make_user) -> None:
        """Citizens write in Hinglish; the fallback categoriser has to cope
        until the MuRIL classifier takes over."""
        citizen = make_user("c2@example.com")
        complaint = _complaint(
            db_session,
            citizen.id,
            title="Batti kharab hai",
            description="Humare area ki batti kaam nahi kar rahi, poora andhera hai.",
        )
        category_id, _ = gcce.resolve_category(db_session, complaint)
        assert category_id == city["category"].id

    def test_no_match_leaves_it_manual(self, db_session, city, make_user) -> None:
        citizen = make_user("c3@example.com")
        complaint = _complaint(
            db_session,
            citizen.id,
            title="General query",
            description="I would like to know the office timings.",
        )
        category_id, reason = gcce.resolve_category(db_session, complaint)
        assert category_id is None
        assert "manual" in reason

    def test_supplied_category_is_respected(self, db_session, city, make_user) -> None:
        citizen = make_user("c4@example.com")
        complaint = _complaint(db_session, citizen.id, category_id=city["category"].id)
        _, reason = gcce.resolve_category(db_session, complaint)
        assert "supplied" in reason


class TestWardResolution:
    def test_picks_the_nearest_ward_by_coordinates(
        self, db_session, city, make_user
    ) -> None:
        citizen = make_user("w1@example.com")
        # Sitting essentially on top of ward 2's centroid.
        complaint = _complaint(db_session, citizen.id, latitude=23.2121, longitude=77.4291)
        ward_id, reason = gcce.resolve_ward(db_session, complaint)
        assert ward_id == city["ward_b"].id
        assert "Ward 2" in reason

    def test_falls_back_to_the_citizens_ward(self, db_session, city, make_user) -> None:
        citizen = make_user("w2@example.com", ward_id=city["ward_a"].id)
        complaint = _complaint(db_session, citizen.id)  # no coordinates
        ward_id, reason = gcce.resolve_ward(db_session, complaint)
        assert ward_id == city["ward_a"].id
        assert "registered ward" in reason

    def test_unresolvable_ward_is_reported(self, db_session, city, make_user) -> None:
        citizen = make_user("w3@example.com")  # no ward, no coordinates
        complaint = _complaint(db_session, citizen.id)
        ward_id, reason = gcce.resolve_ward(db_session, complaint)
        assert ward_id is None
        assert "manual routing" in reason


class TestAssignment:
    def test_picks_the_least_loaded_official(self, db_session, city, make_user) -> None:
        busy = make_user(
            "busy@gov.in",
            role=UserRole.FIELD_OFFICIAL,
            ward_id=city["ward_a"].id,
            department_id=city["dept"].id,
        )
        free = make_user(
            "free@gov.in",
            role=UserRole.FIELD_OFFICIAL,
            ward_id=city["ward_a"].id,
            department_id=city["dept"].id,
        )
        citizen = make_user("a1@example.com", ward_id=city["ward_a"].id)

        # Give `busy` two open tasks.
        for n in (1, 2):
            _complaint(
                db_session,
                citizen.id,
                n=n,
                assigned_to_id=busy.id,
                status=ComplaintStatus.ASSIGNED,
            )
        db_session.flush()

        assignee_id, reason = gcce.pick_assignee(db_session, city["dept"].id, city["ward_a"].id)
        assert assignee_id == free.id
        assert "least-loaded" in reason

    def test_no_official_for_the_area(self, db_session, city) -> None:
        assignee_id, reason = gcce.pick_assignee(db_session, city["dept"].id, city["ward_b"].id)
        assert assignee_id is None
        assert "No active field official" in reason

    def test_inactive_officials_are_skipped(self, db_session, city, make_user) -> None:
        make_user(
            "gone@gov.in",
            role=UserRole.FIELD_OFFICIAL,
            ward_id=city["ward_a"].id,
            department_id=city["dept"].id,
            is_active=False,
        )
        assignee_id, _ = gcce.pick_assignee(db_session, city["dept"].id, city["ward_a"].id)
        assert assignee_id is None


class TestRouting:
    def test_full_route_assigns_and_explains(self, db_session, city, make_user) -> None:
        official = make_user(
            "off@gov.in",
            role=UserRole.FIELD_OFFICIAL,
            ward_id=city["ward_a"].id,
            department_id=city["dept"].id,
        )
        citizen = make_user("r1@example.com", ward_id=city["ward_a"].id)
        complaint = _complaint(db_session, citizen.id)

        decision = gcce.route_complaint(db_session, complaint)

        assert decision.category_id == city["category"].id
        assert decision.department_id == city["dept"].id
        assert decision.ward_id == city["ward_a"].id
        assert decision.assignee_id == official.id
        assert complaint.status == ComplaintStatus.ASSIGNED
        assert complaint.sla_due_at is not None
        # Every decision carries its reasoning - a supervisor must be able to
        # ask why this landed where it did.
        assert len(decision.reasons) >= 4

    def test_routes_without_an_assignee_when_nobody_covers_the_area(
        self, db_session, city, make_user
    ) -> None:
        citizen = make_user("r2@example.com", ward_id=city["ward_b"].id)
        complaint = _complaint(db_session, citizen.id)

        decision = gcce.route_complaint(db_session, complaint)

        assert decision.assignee_id is None
        # ROUTED, not ASSIGNED: it reached the right desk but nobody owns it yet.
        assert complaint.status == ComplaintStatus.ROUTED

    def test_routing_is_deterministic(self, db_session, city, make_user) -> None:
        make_user(
            "det@gov.in",
            role=UserRole.FIELD_OFFICIAL,
            ward_id=city["ward_a"].id,
            department_id=city["dept"].id,
        )
        citizen = make_user("r3@example.com", ward_id=city["ward_a"].id)

        first = gcce.route_complaint(db_session, _complaint(db_session, citizen.id, n=1))
        second = gcce.route_complaint(db_session, _complaint(db_session, citizen.id, n=2))

        assert (first.category_id, first.department_id, first.ward_id) == (
            second.category_id,
            second.department_id,
            second.ward_id,
        )

    def test_notifies_citizen_and_assignee(self, db_session, city, make_user) -> None:
        official = make_user(
            "n1@gov.in",
            role=UserRole.FIELD_OFFICIAL,
            ward_id=city["ward_a"].id,
            department_id=city["dept"].id,
        )
        citizen = make_user("r4@example.com", ward_id=city["ward_a"].id)
        gcce.route_complaint(db_session, _complaint(db_session, citizen.id))
        db_session.flush()

        recipients = {n.user_id for n in db_session.query(Notification).all()}
        assert recipients == {citizen.id, official.id}

    def test_writes_an_audit_event(self, db_session, city, make_user) -> None:
        citizen = make_user("r5@example.com", ward_id=city["ward_a"].id)
        gcce.route_complaint(db_session, _complaint(db_session, citizen.id))
        db_session.flush()

        event = (
            db_session.query(AuditEvent).filter(AuditEvent.action == "complaint.routed").one()
        )
        assert event.source == "gcce"
        assert "reasons" in event.payload

    def test_records_the_status_transition(self, db_session, city, make_user) -> None:
        citizen = make_user("r6@example.com", ward_id=city["ward_a"].id)
        complaint = _complaint(db_session, citizen.id)
        gcce.route_complaint(db_session, complaint)
        db_session.flush()
        db_session.refresh(complaint)

        assert len(complaint.history) == 1
        assert complaint.history[0].from_status == ComplaintStatus.SUBMITTED
        assert complaint.history[0].to_status == complaint.status


class TestPriority:
    def test_quiet_ward_gets_standard_priority(self, db_session, city, make_user) -> None:
        citizen = make_user("p1@example.com", ward_id=city["ward_a"].id)
        complaint = _complaint(db_session, citizen.id)
        priority, reason = gcce.derive_priority(db_session, complaint, city["ward_a"].id)
        assert priority == Priority.MEDIUM
        assert "Standard priority" in reason

    def test_saturated_ward_escalates(self, db_session, city, make_user) -> None:
        """A pothole in a ward with 30 open issues is a different problem from
        the same pothole in a quiet ward."""
        citizen = make_user("p2@example.com", ward_id=city["ward_a"].id)
        for n in range(30):
            _complaint(
                db_session,
                citizen.id,
                n=n,
                ward_id=city["ward_a"].id,
                status=ComplaintStatus.ASSIGNED,
            )
        db_session.flush()

        complaint = _complaint(db_session, citizen.id, n=99)
        priority, reason = gcce.derive_priority(db_session, complaint, city["ward_a"].id)
        assert priority == Priority.HIGH
        assert "Raised to high" in reason

    def test_closed_complaints_do_not_count_towards_load(
        self, db_session, city, make_user
    ) -> None:
        citizen = make_user("p3@example.com", ward_id=city["ward_a"].id)
        for n in range(40):
            _complaint(
                db_session,
                citizen.id,
                n=n,
                ward_id=city["ward_a"].id,
                status=ComplaintStatus.CLOSED,
            )
        db_session.flush()

        complaint = _complaint(db_session, citizen.id, n=99)
        priority, _ = gcce.derive_priority(db_session, complaint, city["ward_a"].id)
        assert priority == Priority.MEDIUM
