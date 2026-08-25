"""Seed a demo city: departments, wards, categories, users, and contractors.

Idempotent - it looks up by natural key before inserting, so running it twice
does not duplicate anything. Run with:

    python -m app.seed
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.neo4j import close_driver, get_driver, init_constraints
from app.db.session import SessionLocal
from app.models.enums import UserRole
from app.models.org import ComplaintCategory, Department, Ward
from app.models.user import User
from app.models.works import Contractor
from app.services import audit
from app.services.graph_sync import full_sync

logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")
logger = logging.getLogger("seed")

DEFAULT_PASSWORD = "drishti123"

DEPARTMENTS = [
    ("PWD", "Public Works", "Roads, footpaths, drains, and civil works"),
    ("ELEC", "Electrical", "Street lighting and municipal electrical assets"),
    ("SWM", "Solid Waste Management", "Garbage collection and sanitation"),
    ("WATER", "Water Supply", "Water supply lines, leaks, and quality"),
    ("HEALTH", "Public Health", "Sanitation inspections and public health"),
]

# Coordinates are around Bhopal, so the nearest-centroid routing in GCCE has
# realistic distances to work with rather than points on a grid.
WARDS = [
    (1, "Shahpura", "South", 48000, 23.1955, 77.4310),
    (2, "Arera Colony", "South", 52000, 23.2120, 77.4290),
    (3, "MP Nagar", "Central", 61000, 23.2330, 77.4340),
    (4, "Kolar", "South-East", 74000, 23.1640, 77.4370),
    (5, "Old City", "North", 68000, 23.2599, 77.4126),
    (6, "Bairagarh", "West", 39000, 23.2790, 77.3350),
]

# keywords feed GCCE's fallback categoriser. Hinglish terms are included from
# the start because that is how complaints actually arrive.
CATEGORIES = [
    ("POTHOLE", "Pothole / Damaged Road", "PWD", 72,
     "pothole,gaddha,road,sadak,damaged road,broken road,tar"),
    ("STREETLIGHT", "Streetlight Not Working", "ELEC", 48,
     "streetlight,street light,light,batti,lamp,pole,dark,andhera"),
    ("GARBAGE", "Garbage Not Collected", "SWM", 24,
     "garbage,kachra,waste,trash,dustbin,rubbish,dump,safai"),
    ("DRAIN", "Blocked Drain / Sewage", "PWD", 48,
     "drain,nali,sewage,overflow,blockage,gutter,choked"),
    ("WATER_LEAK", "Water Leakage", "WATER", 24,
     "water,pani,leak,leakage,pipeline,burst,tap,supply"),
    ("MOSQUITO", "Mosquito / Sanitation Hazard", "HEALTH", 96,
     "mosquito,machhar,breeding,stagnant,dengue,sanitation,hygiene"),
]

CONTRACTORS = [
    ("CTR-001", "Narmada Infra Pvt Ltd", False),
    ("CTR-002", "Vindhya Constructions", False),
    ("CTR-003", "Satpura Civil Works", True),
]


def _get_or_create_department(db: Session, code: str, name: str, desc: str) -> Department:
    dept = db.execute(select(Department).where(Department.code == code)).scalar_one_or_none()
    if dept is None:
        dept = Department(code=code, name=name, description=desc)
        db.add(dept)
        db.flush()
        logger.info("created department %s", code)
    return dept


def _get_or_create_ward(db: Session, number: int, *rest) -> Ward:
    ward = db.execute(select(Ward).where(Ward.ward_number == number)).scalar_one_or_none()
    if ward is None:
        name, zone, population, lat, lon = rest
        ward = Ward(
            ward_number=number,
            name=name,
            zone=zone,
            population=population,
            centroid_lat=lat,
            centroid_lon=lon,
        )
        db.add(ward)
        db.flush()
        logger.info("created ward %s (%s)", number, name)
    return ward


def _get_or_create_user(
    db: Session,
    email: str,
    full_name: str,
    role: UserRole,
    ward_id: int | None = None,
    department_id: int | None = None,
) -> User:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        user = User(
            email=email,
            hashed_password=hash_password(DEFAULT_PASSWORD),
            full_name=full_name,
            role=role,
            ward_id=ward_id,
            department_id=department_id,
        )
        db.add(user)
        db.flush()
        logger.info("created %s %s", role.value, email)
    return user


def seed(db: Session) -> None:
    departments = {
        code: _get_or_create_department(db, code, name, desc)
        for code, name, desc in DEPARTMENTS
    }
    wards = {w[0]: _get_or_create_ward(db, *w) for w in WARDS}

    for code, name, dept_code, sla, keywords in CATEGORIES:
        existing = db.execute(
            select(ComplaintCategory).where(ComplaintCategory.code == code)
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                ComplaintCategory(
                    code=code,
                    name=name,
                    department_id=departments[dept_code].id,
                    default_sla_hours=sla,
                    keywords=keywords,
                )
            )
            logger.info("created category %s", code)
    db.flush()

    for code, name, blacklisted in CONTRACTORS:
        existing = db.execute(
            select(Contractor).where(Contractor.code == code)
        ).scalar_one_or_none()
        if existing is None:
            db.add(Contractor(code=code, name=name, is_blacklisted=blacklisted))
            logger.info("created contractor %s", code)
    db.flush()

    _get_or_create_user(db, "admin@drishti.gov.in", "Priya Sharma (Admin)", UserRole.ADMIN)

    # One official per department in wards 1-3, so GCCE has a real assignee to
    # pick for the common categories during a demo.
    officials = [
        ("pwd.ward1@drishti.gov.in", "Rakesh Verma", "PWD", 1),
        ("pwd.ward3@drishti.gov.in", "Sunil Yadav", "PWD", 3),
        ("elec.ward1@drishti.gov.in", "Anita Deshmukh", "ELEC", 1),
        ("elec.ward2@drishti.gov.in", "Mohan Patil", "ELEC", 2),
        ("swm.ward2@drishti.gov.in", "Farida Khan", "SWM", 2),
        ("water.ward3@drishti.gov.in", "Deepak Nair", "WATER", 3),
    ]
    for email, name, dept_code, ward_no in officials:
        _get_or_create_user(
            db,
            email,
            name,
            UserRole.FIELD_OFFICIAL,
            ward_id=wards[ward_no].id,
            department_id=departments[dept_code].id,
        )

    for email, name, ward_no in [
        ("citizen@example.com", "Meera Joshi", 1),
        ("citizen2@example.com", "Arjun Rao", 3),
    ]:
        _get_or_create_user(db, email, name, UserRole.CITIZEN, ward_id=wards[ward_no].id)

    audit.record(
        db,
        action="system.seeded",
        entity_type="system",
        entity_id="0",
        payload={"departments": len(DEPARTMENTS), "wards": len(WARDS)},
        actor_label="seed script",
        source="system",
    )
    db.commit()
    logger.info("Postgres seed complete.")


def main() -> None:
    db = SessionLocal()
    try:
        seed(db)
        try:
            init_constraints()
            with get_driver().session() as graph:
                counts = full_sync(db, graph)
            logger.info("Neo4j projection: %s", counts)
        except Exception as exc:  # noqa: BLE001
            # Postgres is the system of record. A graph that failed to sync is
            # rebuildable via POST /graph/sync, so do not fail the whole seed.
            logger.warning("Neo4j sync skipped: %s", exc)
    finally:
        db.close()
        close_driver()

    logger.info("Demo accounts (password: %s):", DEFAULT_PASSWORD)
    logger.info("  admin@drishti.gov.in      - Administrator")
    logger.info("  elec.ward1@drishti.gov.in - Field Official (Electrical, Ward 1)")
    logger.info("  citizen@example.com       - Citizen (Ward 1)")


if __name__ == "__main__":
    main()
