"""Registration, login, token refresh, and profile."""
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.security import create_token, decode_token, hash_password, verify_password
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.user import (
    AccessToken,
    LoginRequest,
    RefreshRequest,
    TokenPair,
    UserOut,
    UserRegister,
)
from app.services import audit

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_pair(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(str(user.id), "access", role=user.role.value),
        refresh_token=create_token(str(user.id), "refresh"),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserOut.model_validate(user),
    )


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
def register(payload: UserRegister, db: Session = Depends(get_db)) -> TokenPair:
    """Public self-registration. Always creates a citizen.

    Official and admin accounts are provisioned by an admin, never here.
    """
    existing = db.execute(
        select(User).where(User.email == payload.email.lower())
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    user = User(
        email=payload.email.lower(),
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        phone=payload.phone,
        role=UserRole.CITIZEN,
        ward_id=payload.ward_id,
    )
    db.add(user)
    db.flush()

    audit.record(
        db,
        action="user.registered",
        entity_type="user",
        entity_id=user.id,
        payload={"email": user.email, "role": user.role.value},
        actor_id=user.id,
        actor_label=user.full_name,
    )
    db.commit()
    db.refresh(user)
    return _token_pair(user)


@router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenPair:
    user = db.execute(
        select(User).where(User.email == payload.email.lower())
    ).scalar_one_or_none()

    # One message for both "no such user" and "wrong password", so the endpoint
    # cannot be used to discover which emails are registered.
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password"
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="This account is inactive"
        )

    audit.record(
        db,
        action="user.login",
        entity_type="user",
        entity_id=user.id,
        payload={"email": user.email},
        actor_id=user.id,
        actor_label=user.full_name,
    )
    db.commit()
    return _token_pair(user)


@router.post("/refresh", response_model=AccessToken)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> AccessToken:
    try:
        claims = decode_token(payload.refresh_token, expected_type="refresh")
        user_id = int(claims["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        ) from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )

    return AccessToken(
        access_token=create_token(str(user.id), "access", role=user.role.value),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user
