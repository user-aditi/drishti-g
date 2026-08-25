"""Admin-side user management: provisioning officials, listing, deactivating."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.security import hash_password
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.common import Page
from app.schemas.user import UserCreate, UserOut, UserUpdate
from app.services import audit

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=Page[UserOut])
def list_users(
    role: UserRole | None = None,
    ward_id: int | None = None,
    department_id: int | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Page[UserOut]:
    filters = []
    if role is not None:
        filters.append(User.role == role)
    if ward_id is not None:
        filters.append(User.ward_id == ward_id)
    if department_id is not None:
        filters.append(User.department_id == department_id)

    total = db.execute(
        select(func.count()).select_from(User).where(*filters)
    ).scalar_one()
    rows = (
        db.execute(
            select(User)
            .where(*filters)
            .order_by(User.id)
            .offset((page - 1) * size)
            .limit(size)
        )
        .scalars()
        .all()
    )
    return Page(
        items=[UserOut.model_validate(u) for u in rows], total=total, page=page, size=size
    )


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> User:
    """Create an account with any role. This is the only path to an official or
    admin account - public registration always produces a citizen.
    """
    existing = db.execute(
        select(User).where(User.email == payload.email.lower())
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    if payload.role == UserRole.FIELD_OFFICIAL and (
        payload.department_id is None or payload.ward_id is None
    ):
        # GCCE picks assignees by department + ward. An official missing either
        # would never receive work, so refuse rather than create a dead account.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A field official needs both a department_id and a ward_id",
        )

    user = User(
        email=payload.email.lower(),
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        phone=payload.phone,
        role=payload.role,
        ward_id=payload.ward_id,
        department_id=payload.department_id,
    )
    db.add(user)
    db.flush()

    audit.record(
        db,
        action="user.created",
        entity_type="user",
        entity_id=user.id,
        payload={"email": user.email, "role": user.role.value},
        actor_id=admin.id,
        actor_label=admin.full_name,
    )
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    changes = payload.model_dump(exclude_unset=True)
    if user.id == admin.id and changes.get("is_active") is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account",
        )

    for key, value in changes.items():
        setattr(user, key, value)

    audit.record(
        db,
        action="user.updated",
        entity_type="user",
        entity_id=user.id,
        payload={"changes": changes},
        actor_id=admin.id,
        actor_label=admin.full_name,
    )
    db.commit()
    db.refresh(user)
    return user
