"""Departments, wards, and complaint categories.

Reads are open to any signed-in user - a citizen filing a complaint needs the
ward list. Writes are admin-only.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.session import get_db
from app.models.org import ComplaintCategory, Department, Ward
from app.models.user import User
from app.schemas.org import (
    CategoryOut,
    DepartmentCreate,
    DepartmentOut,
    WardCreate,
    WardOut,
)
from app.services import audit

router = APIRouter(tags=["org"])


@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
) -> list[Department]:
    return list(db.execute(select(Department).order_by(Department.name)).scalars().all())


@router.post(
    "/departments", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED
)
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Department:
    if db.execute(
        select(Department).where(Department.code == payload.code)
    ).scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A department with code '{payload.code}' already exists",
        )

    dept = Department(**payload.model_dump())
    db.add(dept)
    db.flush()
    audit.record(
        db,
        action="department.created",
        entity_type="department",
        entity_id=dept.id,
        payload=payload.model_dump(),
        actor_id=admin.id,
        actor_label=admin.full_name,
    )
    db.commit()
    db.refresh(dept)
    return dept


@router.get("/wards", response_model=list[WardOut])
def list_wards(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
) -> list[Ward]:
    return list(db.execute(select(Ward).order_by(Ward.ward_number)).scalars().all())


@router.post("/wards", response_model=WardOut, status_code=status.HTTP_201_CREATED)
def create_ward(
    payload: WardCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Ward:
    if db.execute(
        select(Ward).where(Ward.ward_number == payload.ward_number)
    ).scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ward number {payload.ward_number} already exists",
        )

    ward = Ward(**payload.model_dump())
    db.add(ward)
    db.flush()
    audit.record(
        db,
        action="ward.created",
        entity_type="ward",
        entity_id=ward.id,
        payload=payload.model_dump(),
        actor_id=admin.id,
        actor_label=admin.full_name,
    )
    db.commit()
    db.refresh(ward)
    return ward


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(
    department_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[ComplaintCategory]:
    stmt = select(ComplaintCategory).order_by(ComplaintCategory.name)
    if department_id is not None:
        stmt = stmt.where(ComplaintCategory.department_id == department_id)
    return list(db.execute(stmt).scalars().all())
