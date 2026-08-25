"""Append-only audit log with a hash chain.

Each event's hash covers its own canonical content plus the previous event's
hash. Recomputing the chain detects any row that was edited or removed after
the fact, which is the integrity property the plan wanted without a blockchain.
"""
import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditEvent

GENESIS = "0" * 64


def _canonical(
    *,
    actor_id: int | None,
    action: str,
    entity_type: str,
    entity_id: str,
    payload: dict[str, Any],
    source: str,
    prev_hash: str,
) -> str:
    """Stable string form of an event.

    sort_keys and separators matter: the same event must serialise byte-identically
    every time or verification will report false tampering.
    """
    return json.dumps(
        {
            "actor_id": actor_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "payload": payload,
            "source": source,
            "prev_hash": prev_hash,
        },
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def _latest_hash(db: Session) -> str:
    row = db.execute(
        select(AuditEvent.hash).order_by(AuditEvent.id.desc()).limit(1)
    ).scalar_one_or_none()
    return row or GENESIS


def record(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: str | int,
    payload: dict[str, Any] | None = None,
    actor_id: int | None = None,
    actor_label: str | None = None,
    source: str = "api",
) -> AuditEvent:
    """Append one event. Flushes so the row gets an id, but does not commit —
    the caller's transaction decides whether the whole action stands or rolls
    back together with its audit entry.
    """
    payload = payload or {}
    prev_hash = _latest_hash(db)
    digest = hashlib.sha256(
        _canonical(
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            payload=payload,
            source=source,
            prev_hash=prev_hash,
        ).encode("utf-8")
    ).hexdigest()

    event = AuditEvent(
        actor_id=actor_id,
        actor_label=actor_label,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        payload=payload,
        source=source,
        prev_hash=prev_hash,
        hash=digest,
    )
    db.add(event)
    db.flush()
    return event


def verify_chain(db: Session) -> dict[str, Any]:
    """Walk the whole chain and report the first row that doesn't verify."""
    events = db.execute(select(AuditEvent).order_by(AuditEvent.id.asc())).scalars().all()
    expected_prev = GENESIS

    for event in events:
        if event.prev_hash != expected_prev:
            return {
                "valid": False,
                "checked": len(events),
                "broken_at_id": event.id,
                "reason": "prev_hash does not match the preceding event",
            }
        recomputed = hashlib.sha256(
            _canonical(
                actor_id=event.actor_id,
                action=event.action,
                entity_type=event.entity_type,
                entity_id=event.entity_id,
                payload=event.payload,
                source=event.source,
                prev_hash=event.prev_hash,
            ).encode("utf-8")
        ).hexdigest()
        if recomputed != event.hash:
            return {
                "valid": False,
                "checked": len(events),
                "broken_at_id": event.id,
                "reason": "content does not match the stored hash",
            }
        expected_prev = event.hash

    return {"valid": True, "checked": len(events), "head": expected_prev}
