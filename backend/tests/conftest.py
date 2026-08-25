"""Test fixtures.

Tests run against SQLite in-memory, not Postgres: they exercise application
logic (auth, roles, GCCE routing, the audit chain), and binding them to a live
database would make `pytest` depend on Docker being up. Migrations are still
verified against real Postgres by running `alembic upgrade head`.
"""
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.enums import UserRole
from app.models.org import ComplaintCategory, Department, Ward
from app.models.user import User


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    # StaticPool + a shared in-memory URI keeps every connection on the same
    # database, which SQLite otherwise would not do.
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestSession()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def _override() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def city(db_session: Session) -> dict[str, object]:
    """A minimal city: one department, two wards, one category."""
    dept = Department(code="ELEC", name="Electrical")
    ward_a = Ward(ward_number=1, name="Shahpura", centroid_lat=23.1955, centroid_lon=77.4310)
    ward_b = Ward(ward_number=2, name="Arera Colony", centroid_lat=23.2120, centroid_lon=77.4290)
    db_session.add_all([dept, ward_a, ward_b])
    db_session.flush()

    category = ComplaintCategory(
        code="STREETLIGHT",
        name="Streetlight Not Working",
        department_id=dept.id,
        default_sla_hours=48,
        keywords="streetlight,street light,light,batti,pole,andhera",
    )
    db_session.add(category)
    db_session.flush()

    return {"dept": dept, "ward_a": ward_a, "ward_b": ward_b, "category": category}


@pytest.fixture
def make_user(db_session: Session):
    """Factory for users with a known password."""
    from app.core.security import hash_password

    def _make(
        email: str,
        role: UserRole = UserRole.CITIZEN,
        password: str = "testpass123",
        ward_id: int | None = None,
        department_id: int | None = None,
        is_active: bool = True,
    ) -> User:
        user = User(
            email=email,
            hashed_password=hash_password(password),
            full_name=email.split("@")[0].replace(".", " ").title(),
            role=role,
            ward_id=ward_id,
            department_id=department_id,
            is_active=is_active,
        )
        db_session.add(user)
        db_session.flush()
        return user

    return _make


@pytest.fixture
def auth_headers(client: TestClient):
    """Log a user in and return the Authorization header for them."""

    def _headers(email: str, password: str = "testpass123") -> dict[str, str]:
        res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
        assert res.status_code == 200, res.text
        return {"Authorization": f"Bearer {res.json()['access_token']}"}

    return _headers
