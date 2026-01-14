# FILE: backend/app/schemas.py

from __future__ import annotations

from datetime import datetime
from typing import Annotated, List, Optional

from pydantic import BaseModel, Field, StringConstraints, field_validator

from .mariadb.models import Department, UserRole


# -------- common string types (trim + non-empty) --------
ProjectNameStr = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
ProjectYearStr = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)
]
ProjectCategoryStr = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)
]


# -------- 파일 --------
class FileOut(BaseModel):
    id: int
    project_id: int
    file_key: str
    original_name: str
    mime_type: Optional[str] = None
    size: Optional[int] = None
    created_at: datetime
    file_type: Optional[str] = None

    class Config:
        from_attributes = True


class FileDownloadOut(BaseModel):
    id: int
    url: str
    expires_minutes: int = 10


# -------- 프로젝트 기본 --------
class ProjectBase(BaseModel):
    name: ProjectNameStr

    # subject/team == Department enum
    subject: Department

    description: Optional[str] = None
    category: ProjectCategoryStr = "기타"

    deadline: Optional[datetime] = None
    deadline_1: Optional[datetime] = None
    deadline_2: Optional[datetime] = None
    deadline_final: Optional[datetime] = None

    year: Optional[ProjectYearStr] = None


class ProjectCreate(ProjectBase):
    status: Optional[str] = "OPEN"


class ProjectUpdate(BaseModel):
    name: Optional[ProjectNameStr] = None
    subject: Optional[Department] = None

    description: Optional[str] = None
    category: Optional[ProjectCategoryStr] = None

    deadline: Optional[datetime] = None
    deadline_1: Optional[datetime] = None
    deadline_2: Optional[datetime] = None
    deadline_final: Optional[datetime] = None

    status: Optional[str] = None
    year: Optional[ProjectYearStr] = None


class ProjectOut(ProjectBase):
    id: int
    status: str
    created_at: datetime
    updated_at: datetime
    files: List[FileOut] = Field(default_factory=list)

    class Config:
        from_attributes = True


class ProjectListOut(BaseModel):
    total: int
    items: List[ProjectOut]


# --------- 계정 ----------
class BootstrapAdminRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    phone_number: Optional[str] = Field(default=None, min_length=8, max_length=32)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class LoginResponse(BaseModel):
    id: int
    username: str
    name: str
    role: UserRole

    # legacy single
    department: Department

    # NEW multi (backward compatible)
    departments: List[Department] = Field(default_factory=list)


class SignupRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    name: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=8, max_length=128)
    password_confirm: str = Field(min_length=8)

    # legacy single (optional for backward compatibility)
    department: Optional[Department] = None

    # ✅ NEW: multi-select at signup
    departments: Optional[List[Department]] = None

    phone_number: str = Field(min_length=8, max_length=32)

    @field_validator("departments")
    @classmethod
    def _dedup_departments(cls, v: Optional[List[Department]]):
        if not v:
            return v
        seen = set()
        out: List[Department] = []
        for d in v:
            if d in seen:
                continue
            seen.add(d)
            out.append(d)
        return out


class UserOut(BaseModel):
    id: int
    username: str
    name: str
    role: UserRole

    # legacy single
    department: Department

    # NEW multi
    departments: List[Department] = Field(default_factory=list)

    phone_number: Optional[str] = None
    phone_verified: bool

    class Config:
        from_attributes = True


class PendingUserOut(BaseModel):
    id: int
    username: str
    name: str
    role: UserRole

    # legacy single
    department: Department

    # NEW multi
    departments: List[Department] = Field(default_factory=list)

    phone_number: Optional[str] = None

    class Config:
        from_attributes = True


class PendingUserListOut(BaseModel):
    total: int
    items: List[PendingUserOut]


class ApproveUserRequest(BaseModel):
    role: UserRole

    # ✅ 승인에서는 소속팀 결정 안함(기본 None). (원하면 서버에서 무시해도 됨)
    departments: Optional[List[Department]] = None

