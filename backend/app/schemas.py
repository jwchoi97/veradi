# FILE: backend/app/schemas.py

from pydantic import BaseModel, Field, StringConstraints, field_validator
from typing import Optional, List, Annotated
from datetime import datetime
from .mariadb.models import UserRole, Department


# -------- common string types (trim + non-empty) --------
ProjectNameStr = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
ProjectSubjectStr = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
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
    subject: ProjectSubjectStr

    description: Optional[str] = None
    category: ProjectCategoryStr = "기타"

    deadline: Optional[datetime] = None
    deadline_1: Optional[datetime] = None
    deadline_2: Optional[datetime] = None
    deadline_final: Optional[datetime] = None

    year: Optional[ProjectYearStr] = None


class ProjectCreate(ProjectBase):
    status: Optional[str] = "OPEN"

    # ✅ NEW: 소속 팀(권한 판단 기준)
    owner_department: Optional[Department] = None


class ProjectUpdate(BaseModel):
    name: Optional[ProjectNameStr] = None
    subject: Optional[ProjectSubjectStr] = None

    description: Optional[str] = None
    category: Optional[ProjectCategoryStr] = None

    deadline: Optional[datetime] = None
    deadline_1: Optional[datetime] = None
    deadline_2: Optional[datetime] = None
    deadline_final: Optional[datetime] = None

    status: Optional[str] = None
    year: Optional[ProjectYearStr] = None

    # (optional) allow admins to fix owner_department later if needed
    owner_department: Optional[Department] = None


class ProjectOut(ProjectBase):
    id: int
    status: str
    created_at: datetime
    updated_at: datetime
    files: List[FileOut] = Field(default_factory=list)

    # ✅ NEW
    owner_department: Optional[Department] = None

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

    # ✅ NEW (extra field, backward compatible)
    departments: List[Department] = Field(default_factory=list)


class SignupRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    name: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=8, max_length=128)
    password_confirm: str = Field(min_length=8)

    # legacy single (optional for backward compatibility)
    department: Optional[Department] = None

    # ✅ NEW: multi select
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

    # ✅ NEW
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

    # ✅ NEW
    departments: List[Department] = Field(default_factory=list)

    phone_number: Optional[str] = None

    class Config:
        from_attributes = True


class PendingUserListOut(BaseModel):
    total: int
    items: List[PendingUserOut]


class ApproveUserRequest(BaseModel):
    role: UserRole

    # ✅ NEW: admin can set/override departments on approval (optional)
    departments: Optional[List[Department]] = None


# # FILE: backend/app/schemas.py

# from pydantic import BaseModel, Field, StringConstraints
# from typing import Optional, List, Annotated
# from datetime import datetime
# from .mariadb.models import UserRole, Department


# # -------- common string types (trim + non-empty) --------
# ProjectNameStr = Annotated[
#     str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
# ]
# ProjectSubjectStr = Annotated[
#     str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
# ]
# ProjectYearStr = Annotated[
#     str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)
# ]

# # Project category is intended to be easily changeable later (not hard-enforced in DB)
# ProjectCategoryStr = Annotated[
#     str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)
# ]


# # -------- 파일 --------
# class FileOut(BaseModel):
#     id: int
#     project_id: int
#     file_key: str
#     original_name: str
#     mime_type: Optional[str] = None
#     size: Optional[int] = None
#     created_at: datetime
#     file_type: Optional[str] = None

#     class Config:
#         from_attributes = True  # orm_mode replacement


# class FileDownloadOut(BaseModel):
#     id: int
#     url: str
#     expires_minutes: int = 10


# # -------- 프로젝트 기본 --------
# class ProjectBase(BaseModel):
#     # REQUIRED + reject blank/whitespace-only (trim then min_length=1)
#     name: ProjectNameStr
#     subject: ProjectSubjectStr

#     description: Optional[str] = None

#     # NEW: category (default '기타' at server/model level)
#     category: ProjectCategoryStr = "기타"

#     # Legacy single deadline (kept for backward compatibility)
#     deadline: Optional[datetime] = None

#     # NEW multi deadlines
#     deadline_1: Optional[datetime] = None
#     deadline_2: Optional[datetime] = None
#     deadline_final: Optional[datetime] = None

#     # optional, but if provided reject blank/whitespace-only
#     year: Optional[ProjectYearStr] = None


# class ProjectCreate(ProjectBase):
#     status: Optional[str] = "OPEN"


# class ProjectUpdate(BaseModel):
#     # optional, but if provided reject blank/whitespace-only
#     name: Optional[ProjectNameStr] = None
#     subject: Optional[ProjectSubjectStr] = None

#     description: Optional[str] = None

#     # NEW: category (optional update)
#     category: Optional[ProjectCategoryStr] = None

#     # Legacy single deadline (kept for backward compatibility)
#     deadline: Optional[datetime] = None

#     # NEW multi deadlines
#     deadline_1: Optional[datetime] = None
#     deadline_2: Optional[datetime] = None
#     deadline_final: Optional[datetime] = None

#     status: Optional[str] = None
#     year: Optional[ProjectYearStr] = None


# class ProjectOut(ProjectBase):
#     id: int
#     status: str
#     created_at: datetime
#     updated_at: datetime
#     files: List[FileOut] = Field(default_factory=list)

#     class Config:
#         from_attributes = True


# class ProjectListOut(BaseModel):
#     total: int
#     items: List[ProjectOut]


# # --------- 계정 ----------
# class BootstrapAdminRequest(BaseModel):
#     username: str = Field(min_length=3, max_length=64)
#     password: str = Field(min_length=8, max_length=128)
#     phone_number: Optional[str] = Field(default=None, min_length=8, max_length=32)


# class LoginRequest(BaseModel):
#     username: str = Field(min_length=1, max_length=64)
#     password: str = Field(min_length=1, max_length=128)


# class LoginResponse(BaseModel):
#     id: int
#     username: str
#     name: str
#     role: UserRole
#     department: Department


# class SignupRequest(BaseModel):
#     username: str = Field(min_length=3, max_length=64)
#     name: str = Field(min_length=1, max_length=50)
#     password: str = Field(min_length=8, max_length=128)
#     password_confirm: str = Field(min_length=8)
#     department: Department
#     phone_number: str = Field(min_length=8, max_length=32)
#     # role: Optional[UserRole] = None  # server should ignore this for public signup


# class UserOut(BaseModel):
#     id: int
#     username: str
#     name: str
#     role: UserRole
#     department: Department
#     phone_number: Optional[str] = None
#     phone_verified: bool

#     class Config:
#         from_attributes = True


# class PendingUserOut(BaseModel):
#     id: int
#     username: str
#     name: str
#     role: UserRole
#     department: Department
#     phone_number: Optional[str] = None

#     class Config:
#         from_attributes = True


# class PendingUserListOut(BaseModel):
#     total: int
#     items: List[PendingUserOut]


# class ApproveUserRequest(BaseModel):
#     role: UserRole

