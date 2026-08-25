"""Auth and role enforcement."""
from fastapi.testclient import TestClient

from app.core.security import create_token, hash_password, verify_password
from app.models.enums import UserRole


class TestPasswordHashing:
    def test_roundtrip(self) -> None:
        hashed = hash_password("correct horse battery")
        assert hashed != "correct horse battery"
        assert verify_password("correct horse battery", hashed)
        assert not verify_password("wrong password", hashed)

    def test_rejects_over_72_bytes(self) -> None:
        """bcrypt truncates past 72 bytes. Silently accepting a longer password
        would mean only its first 72 bytes are ever checked."""
        import pytest

        with pytest.raises(ValueError):
            hash_password("a" * 73)

    def test_malformed_hash_fails_closed(self) -> None:
        assert not verify_password("anything", "not-a-bcrypt-hash")


class TestRegistration:
    def test_creates_a_citizen(self, client: TestClient) -> None:
        res = client.post(
            "/api/v1/auth/register",
            json={
                "email": "New.User@Example.com",
                "password": "testpass123",
                "full_name": "New User",
            },
        )
        assert res.status_code == 201, res.text
        body = res.json()
        assert body["user"]["role"] == "citizen"
        # Email is normalised, so Login with any casing works.
        assert body["user"]["email"] == "new.user@example.com"
        assert body["access_token"] and body["refresh_token"]

    def test_cannot_self_assign_a_role(self, client: TestClient) -> None:
        """Even if `role` is passed, registration must produce a citizen."""
        res = client.post(
            "/api/v1/auth/register",
            json={
                "email": "sneaky@example.com",
                "password": "testpass123",
                "full_name": "Sneaky Person",
                "role": "admin",
            },
        )
        assert res.status_code == 201
        assert res.json()["user"]["role"] == "citizen"

    def test_duplicate_email_conflicts(self, client: TestClient, make_user) -> None:
        make_user("taken@example.com")
        res = client.post(
            "/api/v1/auth/register",
            json={
                "email": "taken@example.com",
                "password": "testpass123",
                "full_name": "Someone Else",
            },
        )
        assert res.status_code == 409

    def test_short_password_rejected(self, client: TestClient) -> None:
        res = client.post(
            "/api/v1/auth/register",
            json={"email": "a@example.com", "password": "short", "full_name": "A B"},
        )
        assert res.status_code == 422


class TestLogin:
    def test_success(self, client: TestClient, make_user) -> None:
        make_user("user@example.com")
        res = client.post(
            "/api/v1/auth/login",
            json={"email": "user@example.com", "password": "testpass123"},
        )
        assert res.status_code == 200
        assert res.json()["user"]["email"] == "user@example.com"

    def test_wrong_password_and_unknown_email_are_indistinguishable(
        self, client: TestClient, make_user
    ) -> None:
        """Otherwise login doubles as a way to enumerate registered emails."""
        make_user("real@example.com")
        wrong_pw = client.post(
            "/api/v1/auth/login",
            json={"email": "real@example.com", "password": "nope"},
        )
        no_user = client.post(
            "/api/v1/auth/login",
            json={"email": "ghost@example.com", "password": "nope"},
        )
        assert wrong_pw.status_code == no_user.status_code == 401
        assert wrong_pw.json()["detail"] == no_user.json()["detail"]

    def test_inactive_account_blocked(self, client: TestClient, make_user) -> None:
        make_user("dormant@example.com", is_active=False)
        res = client.post(
            "/api/v1/auth/login",
            json={"email": "dormant@example.com", "password": "testpass123"},
        )
        assert res.status_code == 403


class TestTokens:
    def test_me_requires_a_token(self, client: TestClient) -> None:
        assert client.get("/api/v1/auth/me").status_code == 401

    def test_me_returns_the_signed_in_user(
        self, client: TestClient, make_user, auth_headers
    ) -> None:
        make_user("me@example.com")
        res = client.get("/api/v1/auth/me", headers=auth_headers("me@example.com"))
        assert res.status_code == 200
        assert res.json()["email"] == "me@example.com"

    def test_refresh_token_rejected_as_access_token(
        self, client: TestClient, make_user
    ) -> None:
        """A refresh token is long-lived; accepting it as a bearer token would
        hand out a session that never expires."""
        user = make_user("swap@example.com")
        refresh = create_token(str(user.id), "refresh")
        res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {refresh}"})
        assert res.status_code == 401

    def test_refresh_issues_a_new_access_token(self, client: TestClient, make_user) -> None:
        login = client.post(
            "/api/v1/auth/login",
            json={"email": make_user("r@example.com").email, "password": "testpass123"},
        )
        refresh = login.json()["refresh_token"]
        res = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
        assert res.status_code == 200
        assert res.json()["access_token"]

    def test_garbage_token_rejected(self, client: TestClient) -> None:
        res = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not.a.jwt"})
        assert res.status_code == 401


class TestRoleGates:
    def test_citizen_cannot_list_users(
        self, client: TestClient, make_user, auth_headers
    ) -> None:
        make_user("cit@example.com", role=UserRole.CITIZEN)
        res = client.get("/api/v1/users", headers=auth_headers("cit@example.com"))
        assert res.status_code == 403

    def test_official_cannot_list_users(
        self, client: TestClient, make_user, auth_headers
    ) -> None:
        make_user("off@example.com", role=UserRole.FIELD_OFFICIAL)
        res = client.get("/api/v1/users", headers=auth_headers("off@example.com"))
        assert res.status_code == 403

    def test_admin_can_list_users(
        self, client: TestClient, make_user, auth_headers
    ) -> None:
        make_user("adm@example.com", role=UserRole.ADMIN)
        res = client.get("/api/v1/users", headers=auth_headers("adm@example.com"))
        assert res.status_code == 200
        assert res.json()["total"] >= 1

    def test_admin_creating_official_needs_ward_and_department(
        self, client: TestClient, make_user, auth_headers, city
    ) -> None:
        """GCCE assigns work by department + ward. An official missing either
        would never receive a task, so the API refuses to create one."""
        make_user("adm2@example.com", role=UserRole.ADMIN)
        headers = auth_headers("adm2@example.com")

        incomplete = client.post(
            "/api/v1/users",
            headers=headers,
            json={
                "email": "half@drishti.gov.in",
                "password": "testpass123",
                "full_name": "Half Official",
                "role": "field_official",
            },
        )
        assert incomplete.status_code == 422

        complete = client.post(
            "/api/v1/users",
            headers=headers,
            json={
                "email": "full@drishti.gov.in",
                "password": "testpass123",
                "full_name": "Full Official",
                "role": "field_official",
                "ward_id": city["ward_a"].id,
                "department_id": city["dept"].id,
            },
        )
        assert complete.status_code == 201, complete.text
        assert complete.json()["role"] == "field_official"

    def test_admin_cannot_deactivate_themselves(
        self, client: TestClient, make_user, auth_headers
    ) -> None:
        admin = make_user("solo@example.com", role=UserRole.ADMIN)
        res = client.patch(
            f"/api/v1/users/{admin.id}",
            headers=auth_headers("solo@example.com"),
            json={"is_active": False},
        )
        assert res.status_code == 400
