# app/schemas.py
from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List
from datetime import datetime
from .mariadb.models import UserRole, Department


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
        from_attributes = True  # orm_mode 대체

class FileDownloadOut(BaseModel):
    id: int
    url: str
    expires_minutes: int = 10

# -------- 프로젝트 기본 --------
class ProjectBase(BaseModel):
    name: str = Field(..., max_length=200)
    subject: str = Field(..., max_length=100)
    description: Optional[str] = None
    deadline: Optional[datetime] = None
    year: Optional[str] = Field(default=None, max_length=10)


class ProjectCreate(ProjectBase):
    status: Optional[str] = "OPEN"


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    subject: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    deadline: Optional[datetime] = None
    status: Optional[str] = None
    year: Optional[str] = Field(default=None, max_length=10)


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
    role: UserRole
    department: Department


class SignupRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    department: Department
    phone_number: str = Field(min_length=8, max_length=32)
    role: Optional[UserRole] = None  # server should ignore this for public signup


class UserOut(BaseModel):
    id: int
    username: str
    role: UserRole
    department: Department
    phone_number: Optional[str] = None
    phone_verified: bool

    class Config:
        from_attributes = True
