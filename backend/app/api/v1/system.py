"""Health, audit-chain verification, and graph rebuild.

These are the endpoints that let a supervisor (or a demo) confirm the system is
honest about its own state.
"""
from fastapi import APIRouter, Depends
from neo4j import Session as GraphSession
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.config import settings
from app.db.neo4j import get_graph, graph_healthy
from app.db.session import get_db
from app.models.user import User
from app.services import audit
from app.services.graph_sync import full_sync

router = APIRouter(tags=["system"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, object]:
    """Unauthenticated liveness check reporting each dependency separately, so a
    failure points at which one is down.
    """
    try:
        db.execute(text("SELECT 1"))
        postgres = {"ok": True, "detail": "ok"}
    except Exception as exc:  # noqa: BLE001 - health check reports any failure
        postgres = {"ok": False, "detail": str(exc)}

    neo_ok, neo_detail = graph_healthy()
    return {
        "status": "ok" if postgres["ok"] and neo_ok else "degraded",
        "environment": settings.ENVIRONMENT,
        "postgres": postgres,
        "neo4j": {"ok": neo_ok, "detail": neo_detail},
    }


@router.get("/audit/verify")
def verify_audit_chain(
    db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> dict[str, object]:
    """Recompute the whole hash chain and report the first break, if any."""
    return audit.verify_chain(db)


@router.post("/graph/sync")
def rebuild_graph(
    db: Session = Depends(get_db),
    graph: GraphSession = Depends(get_graph),
    _: User = Depends(require_admin),
) -> dict[str, object]:
    """Rebuild the Neo4j projection from Postgres. Idempotent."""
    return {"synced": full_sync(db, graph)}
