"""Projects Postgres rows into the Neo4j knowledge graph.

Postgres stays the system of record. The graph is a derived view whose only job
is to make "who is connected to what" cheap to traverse - which is what GCCE
needs for routing and GRIE needs for propagating risk from a project to its
contractor and ward.

Every write is a MERGE, so re-running a sync is safe and the graph can always be
rebuilt from Postgres if it drifts.
"""
from __future__ import annotations

import logging

from neo4j import Session as GraphSession
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.complaint import Complaint
from app.models.org import ComplaintCategory, Department, Ward
from app.models.user import User
from app.models.works import Contractor, Project

logger = logging.getLogger(__name__)


def sync_department(graph: GraphSession, dept: Department) -> None:
    graph.run(
        "MERGE (d:Department {id: $id}) SET d.code = $code, d.name = $name",
        id=dept.id,
        code=dept.code,
        name=dept.name,
    )


def sync_ward(graph: GraphSession, ward: Ward) -> None:
    graph.run(
        """
        MERGE (w:Ward {id: $id})
        SET w.number = $number, w.name = $name, w.zone = $zone,
            w.lat = $lat, w.lon = $lon
        """,
        id=ward.id,
        number=ward.ward_number,
        name=ward.name,
        zone=ward.zone,
        lat=ward.centroid_lat,
        lon=ward.centroid_lon,
    )


def sync_category(graph: GraphSession, category: ComplaintCategory) -> None:
    graph.run(
        """
        MERGE (c:Category {id: $id})
        SET c.code = $code, c.name = $name, c.sla_hours = $sla
        WITH c
        MATCH (d:Department {id: $dept_id})
        MERGE (c)-[:HANDLED_BY]->(d)
        """,
        id=category.id,
        code=category.code,
        name=category.name,
        sla=category.default_sla_hours,
        dept_id=category.department_id,
    )


def sync_user(graph: GraphSession, user: User) -> None:
    """Officials carry SERVES/MEMBER_OF edges; that is what makes assignee
    lookup a one-hop traversal instead of a filtered scan.
    """
    graph.run(
        """
        MERGE (u:User {id: $id})
        SET u.name = $name, u.role = $role, u.active = $active
        """,
        id=user.id,
        name=user.full_name,
        role=user.role.value,
        active=user.is_active,
    )
    if user.department_id is not None:
        graph.run(
            """
            MATCH (u:User {id: $id})
            WITH u
            MATCH (d:Department {id: $dept_id})
            MERGE (u)-[:MEMBER_OF]->(d)
            """,
            id=user.id,
            dept_id=user.department_id,
        )
    if user.ward_id is not None:
        graph.run(
            """
            MATCH (u:User {id: $id})
            WITH u
            MATCH (w:Ward {id: $ward_id})
            MERGE (u)-[:SERVES]->(w)
            """,
            id=user.id,
            ward_id=user.ward_id,
        )


def sync_contractor(graph: GraphSession, contractor: Contractor) -> None:
    graph.run(
        """
        MERGE (c:Contractor {id: $id})
        SET c.code = $code, c.name = $name, c.blacklisted = $blacklisted
        """,
        id=contractor.id,
        code=contractor.code,
        name=contractor.name,
        blacklisted=contractor.is_blacklisted,
    )


def sync_project(graph: GraphSession, project: Project) -> None:
    graph.run(
        "MERGE (p:Project {id: $id}) SET p.code = $code, p.name = $name",
        id=project.id,
        code=project.code,
        name=project.name,
    )
    if project.contractor_id is not None:
        graph.run(
            """
            MATCH (p:Project {id: $id})
            WITH p
            MATCH (c:Contractor {id: $cid})
            MERGE (c)-[:EXECUTES]->(p)
            """,
            id=project.id,
            cid=project.contractor_id,
        )
    if project.ward_id is not None:
        graph.run(
            """
            MATCH (p:Project {id: $id})
            WITH p
            MATCH (w:Ward {id: $wid})
            MERGE (p)-[:LOCATED_IN]->(w)
            """,
            id=project.id,
            wid=project.ward_id,
        )


def sync_complaint(graph: GraphSession, complaint: Complaint) -> None:
    """Called by GCCE after routing, so the graph reflects the decision it made."""
    graph.run(
        """
        MERGE (x:Complaint {id: $id})
        SET x.ref = $ref, x.status = $status, x.priority = $priority
        """,
        id=complaint.id,
        ref=complaint.reference_no,
        status=complaint.status.value,
        priority=complaint.priority.value,
    )
    edges = [
        (complaint.ward_id, "Ward", "OCCURRED_IN"),
        (complaint.department_id, "Department", "OWNED_BY"),
        (complaint.category_id, "Category", "OF_CATEGORY"),
        (complaint.citizen_id, "User", "FILED_BY"),
        (complaint.assigned_to_id, "User", "ASSIGNED_TO"),
    ]
    for target_id, label, rel in edges:
        if target_id is None:
            continue
        graph.run(
            f"""
            MATCH (x:Complaint {{id: $id}})
            WITH x
            MATCH (t:{label} {{id: $tid}})
            MERGE (x)-[:{rel}]->(t)
            """,
            id=complaint.id,
            tid=target_id,
        )


def full_sync(db: Session, graph: GraphSession) -> dict[str, int]:
    """Rebuild the whole projection from Postgres. Run after seeding, or any
    time the graph is suspected of having drifted.
    """
    counts: dict[str, int] = {}

    for name, model, fn in [
        ("departments", Department, sync_department),
        ("wards", Ward, sync_ward),
        ("categories", ComplaintCategory, sync_category),
        ("users", User, sync_user),
        ("contractors", Contractor, sync_contractor),
        ("projects", Project, sync_project),
        ("complaints", Complaint, sync_complaint),
    ]:
        rows = db.execute(select(model)).scalars().all()
        for row in rows:
            fn(graph, row)
        counts[name] = len(rows)

    logger.info("Graph full sync complete: %s", counts)
    return counts
