from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class ORMModel(BaseModel):
    # protected_namespaces=() lets fields like `model_version` through without
    # pydantic warning about its reserved `model_` prefix.
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    size: int


class Message(BaseModel):
    detail: str
