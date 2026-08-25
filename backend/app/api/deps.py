"""Shared FastAPI dependencies: current user, and role gates."""
from collections.abc import Callable

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)

CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise CREDENTIALS_ERROR

    try:
        payload = decode_token(credentials.credentials, expected_type="access")
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError) as exc:
        raise CREDENTIALS_ERROR from exc

    user = db.get(User, user_id)
    if user is None:
        raise CREDENTIALS_ERROR
    if not user.is_active:
        # Distinct from 401: the token is valid, the account is switched off.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="This account is inactive"
        )
    return user


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    """Dependency factory gating an endpoint to specific roles.

    Usage: `user: User = Depends(require_roles(UserRole.ADMIN))`
    """

    def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            allowed = ", ".join(r.value for r in roles)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires one of these roles: {allowed}",
            )
        return user

    return _checker


require_admin = require_roles(UserRole.ADMIN)
require_official = require_roles(UserRole.FIELD_OFFICIAL, UserRole.ADMIN)
require_citizen = require_roles(UserRole.CITIZEN)
