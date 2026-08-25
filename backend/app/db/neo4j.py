"""Neo4j driver lifecycle and schema constraints.

The graph is the coordination substrate for GCCE: it stores how departments,
wards, officials, complaints, contractors and projects relate, so routing and
GRIE's propagation queries are graph traversals rather than recursive SQL.
Postgres remains the system of record; the graph is a projection of it.
"""
import logging
from collections.abc import Generator
from typing import Any

from neo4j import Driver, GraphDatabase, Session as Neo4jSession

from app.core.config import settings

logger = logging.getLogger(__name__)

_driver: Driver | None = None

# Uniqueness constraints double as indexes, so MERGE on these stays cheap.
CONSTRAINTS = [
    "CREATE CONSTRAINT dept_id IF NOT EXISTS FOR (d:Department) REQUIRE d.id IS UNIQUE",
    "CREATE CONSTRAINT ward_id IF NOT EXISTS FOR (w:Ward) REQUIRE w.id IS UNIQUE",
    "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE",
    "CREATE CONSTRAINT category_id IF NOT EXISTS FOR (c:Category) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT complaint_id IF NOT EXISTS FOR (x:Complaint) REQUIRE x.id IS UNIQUE",
    "CREATE CONSTRAINT contractor_id IF NOT EXISTS FOR (c:Contractor) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE",
]


def get_driver() -> Driver:
    global _driver
    if _driver is None:
        _driver = GraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
        )
    return _driver


def close_driver() -> None:
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None


def get_graph() -> Generator[Neo4jSession, None, None]:
    """FastAPI dependency yielding a Neo4j session."""
    session = get_driver().session()
    try:
        yield session
    finally:
        session.close()


def init_constraints() -> None:
    """Idempotent — safe to run on every startup."""
    with get_driver().session() as session:
        for stmt in CONSTRAINTS:
            session.run(stmt)
    logger.info("Neo4j constraints ensured (%d)", len(CONSTRAINTS))


def graph_healthy() -> tuple[bool, str]:
    """Used by /health. Never raises; reports the failure instead."""
    try:
        with get_driver().session() as session:
            session.run("RETURN 1").single()
        return True, "ok"
    except Exception as exc:  # noqa: BLE001 - health check reports any failure
        return False, str(exc)


def run_write(query: str, **params: Any) -> None:
    with get_driver().session() as session:
        session.run(query, **params)
