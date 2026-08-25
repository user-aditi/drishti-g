"""The audit chain must detect tampering. That property is the whole reason it
exists, so it is tested by actually tampering with it."""
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.audit import AuditEvent
from app.services import audit


def _write_three(db: Session) -> None:
    audit.record(db, action="a.one", entity_type="thing", entity_id=1, payload={"n": 1})
    audit.record(db, action="a.two", entity_type="thing", entity_id=2, payload={"n": 2})
    audit.record(db, action="a.three", entity_type="thing", entity_id=3, payload={"n": 3})
    db.commit()


def test_first_event_links_to_genesis(db_session: Session) -> None:
    event = audit.record(db_session, action="x", entity_type="t", entity_id=1)
    db_session.commit()
    assert event.prev_hash == audit.GENESIS
    assert len(event.hash) == 64


def test_events_chain_together(db_session: Session) -> None:
    _write_three(db_session)
    events = db_session.query(AuditEvent).order_by(AuditEvent.id).all()
    assert events[1].prev_hash == events[0].hash
    assert events[2].prev_hash == events[1].hash


def test_empty_chain_is_valid(db_session: Session) -> None:
    result = audit.verify_chain(db_session)
    assert result["valid"] is True
    assert result["checked"] == 0


def test_intact_chain_verifies(db_session: Session) -> None:
    _write_three(db_session)
    result = audit.verify_chain(db_session)
    assert result["valid"] is True
    assert result["checked"] == 3


def test_edited_payload_is_detected(db_session: Session) -> None:
    _write_three(db_session)
    target = db_session.query(AuditEvent).order_by(AuditEvent.id).all()[1]

    # Rewrite history the way someone covering their tracks would: change the
    # content, leave the stored hash alone.
    db_session.execute(
        text("UPDATE audit_events SET payload = :p WHERE id = :i"),
        {"p": '{"n": 999}', "i": target.id},
    )
    db_session.commit()
    db_session.expire_all()

    result = audit.verify_chain(db_session)
    assert result["valid"] is False
    assert result["broken_at_id"] == target.id
    assert "hash" in result["reason"]


def test_deleted_row_is_detected(db_session: Session) -> None:
    _write_three(db_session)
    events = db_session.query(AuditEvent).order_by(AuditEvent.id).all()
    middle, last = events[1], events[2]

    db_session.execute(text("DELETE FROM audit_events WHERE id = :i"), {"i": middle.id})
    db_session.commit()
    db_session.expire_all()

    result = audit.verify_chain(db_session)
    assert result["valid"] is False
    # The row after the hole is where the break surfaces.
    assert result["broken_at_id"] == last.id


def test_login_writes_an_audit_event(client, make_user, db_session: Session) -> None:
    make_user("audited@example.com")
    client.post(
        "/api/v1/auth/login",
        json={"email": "audited@example.com", "password": "testpass123"},
    )
    actions = [e.action for e in db_session.query(AuditEvent).all()]
    assert "user.login" in actions
