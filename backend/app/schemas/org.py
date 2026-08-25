from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class DepartmentOut(ORMModel):
    id: int
    code: str
    name: str
    description: str | None


class WardOut(ORMModel):
    id: int
    ward_number: int
    name: str
    zone: str | None
    population: int | None
    centroid_lat: float | None
    centroid_lon: float | None


class CategoryOut(ORMModel):
    id: int
    code: str
    name: str
    department_id: int
    default_sla_hours: int


class DepartmentCreate(BaseModel):
    code: str = Field(max_length=16)
    name: str = Field(max_length=128)
    description: str | None = None


class WardCreate(BaseModel):
    ward_number: int
    name: str = Field(max_length=128)
    zone: str | None = None
    population: int | None = None
    centroid_lat: float | None = None
    centroid_lon: float | None = None
