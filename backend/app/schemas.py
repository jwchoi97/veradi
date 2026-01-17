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
    uploaded_by_user_id: Optional[int] = None  # 누가 업로드했는지 기록

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

    # 개별 문항 목표 개수 (기본값 20)
    target_individual_items_count: Optional[int] = 20


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

    # 개별 문항 목표 개수
    target_individual_items_count: Optional[int] = None


class ProjectOut(ProjectBase):
    id: int
    status: str
    created_at: datetime
    updated_at: datetime
    files: List[FileOut] = Field(default_factory=list)
    target_individual_items_count: int  # ProjectBase에서 상속되지만 명시적으로 포함

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
    profile_image_url: Optional[str] = None

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=50)
    phone_number: Optional[str] = Field(None, min_length=8, max_length=32)


class UserContributionStats(BaseModel):
    year: str
    individual_items_count: int  # 개별 문항 업로드 개수
    content_files_count: int  # 콘텐츠 업로드 개수 (문제지, 해설지, 정오표 등)
    total_files_count: int  # 전체 파일 개수


class ActivityItem(BaseModel):
    id: int
    type: str  # "file_upload", "file_delete", "review" (나중에 추가)
    timestamp: datetime
    user_name: str | None
    project_name: str
    project_year: str | None
    file_name: str | None
    file_type: str | None
    description: str  # 간결한 설명

    class Config:
        from_attributes = True


class ReviewCommentOut(BaseModel):
    id: int
    review_id: int
    author_id: int | None
    author_name: str | None
    comment_type: str  # "text" or "handwriting"
    text_content: str | None
    handwriting_image_url: str | None
    page_number: int | None
    x_position: int | None
    y_position: int | None
    created_at: datetime

    class Config:
        from_attributes = True


class ReviewCommentCreate(BaseModel):
    comment_type: str = "text"  # "text" or "handwriting"
    text_content: str | None = None
    handwriting_image_url: str | None = None
    page_number: int | None = None
    x_position: int | None = None
    y_position: int | None = None


class ReviewOut(BaseModel):
    id: int
    file_asset_id: int
    project_id: int | None = None
    file_name: str | None = None
    project_name: str | None = None
    project_year: str | None = None
    status: str  # "pending", "in_progress", "request_revision", "approved"
    reviewer_id: int | None
    reviewer_name: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    comments: list[ReviewCommentOut] = []

    class Config:
        from_attributes = True


class ReviewStatusUpdate(BaseModel):
    status: str  # "in_progress", "request_revision", "approved"


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

