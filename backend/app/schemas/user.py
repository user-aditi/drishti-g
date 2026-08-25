from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.enums import UserRole
from app.schemas.common import ORMModel

# bcrypt truncates past 72 bytes, so the max here is a real limit, not a guess.
PASSWORD_MIN = 8
PASSWORD_MAX = 72


class UserBase(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=128)
    phone: str | None = Field(default=None, max_length=20)


class UserRegister(UserBase):
    """Public self-registration. Always creates a CITIZEN.

    Official and admin accounts are created by an admin through /users, never
    here — otherwise anyone could sign up as an admin.
    """

    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
    ward_id: int | None = None

    @field_validator("password")
    @classmethod
    def _fits_bcrypt(cls, v: str) -> str:
        if len(v.encode("utf-8")) > PASSWORD_MAX:
            raise ValueError("Password must be at most 72 bytes")
        return v


class UserCreate(UserRegister):
    """Admin-side creation, where the role can be chosen."""

    role: UserRole = UserRole.CITIZEN
    department_id: int | None = None


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=128)
    phone: str | None = Field(default=None, max_length=20)
    ward_id: int | None = None
    department_id: int | None = None
    is_active: bool | None = None


class UserOut(ORMModel):
    id: int
    email: EmailStr
    full_name: str
    phone: str | None
    role: UserRole
    is_active: bool
    ward_id: int | None
    department_id: int | None
    created_at: datetime


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class RefreshRequest(BaseModel):
    refresh_token: str


class AccessToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
