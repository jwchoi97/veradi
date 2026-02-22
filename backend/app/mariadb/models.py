from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base


# --------------------
# User Management
# --------------------

class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    LEAD = "LEAD"
    MEMBER = "MEMBER"
    PENDING = "PENDING"


# ✅ FIXED: exactly 7 subjects/teams (same concept)
class Department(str, enum.Enum):
    PHYSICS_1 = "PHYSICS_1"
    CHEMISTRY_1 = "CHEMISTRY_1"
    CHEMISTRY_2 = "CHEMISTRY_2"
    BIOLOGY_1 = "BIOLOGY_1"
    EARTH_1 = "EARTH_1"
    SOCIOCULTURE = "SOCIOCULTURE"
    MATH = "MATH"
    INTEGRATED_SCIENCE = "INTEGRATED_SCIENCE"
    INTEGRATED_SOCIAL = "INTEGRATED_SOCIAL"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    username = Column(String(64), unique=True, index=True, nullable=False)
    name = Column(String(50), nullable=True)
    password_hash = Column(String(255), nullable=False)

    role = Column(Enum(UserRole), nullable=False, default=UserRole.MEMBER)

    # ✅ Single department/team only (fixed 7)
    # NOTE: If your current DB column is NOT NULL, we'll handle ADMIN users in migration
    #       (either set a default department, or allow nullable for ADMIN).
    department = Column(Enum(Department), nullable=False, index=True)

    phone_number = Column(String(32), unique=True, index=True, nullable=False)
    phone_verified = Column(Boolean, nullable=False, default=False)

    # 프로필 사진 URL
    profile_image_url = Column(String(512), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # --- NEW: multi departments ---
    department_links = relationship(
        "UserDepartment",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def departments_set(self) -> set[Department]:
        # safe even if no links
        try:
            return set([link.department for link in (self.department_links or [])])
        except Exception:
            return set()


# --------------------
# Project / Files
# --------------------

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String(200), nullable=False)

    # ✅ Unified: subject/team == department (fixed 7)
    # NOTE: We will migrate old string subject + owner_department into this field.
    subject = Column(Enum(Department), nullable=False, index=True)

    description = Column(String(500))

    category = Column(String(50), nullable=False, default="기타")
    status = Column(String(20), nullable=False, default="OPEN")

    # Legacy single deadline
    deadline = Column(DateTime, nullable=True)

    # NEW multi deadlines
    deadline_1 = Column(DateTime, nullable=True)
    deadline_2 = Column(DateTime, nullable=True)
    deadline_final = Column(DateTime, nullable=True)

    year = Column(String(10), nullable=True)

    # Legacy field
    file_key = Column(String(255), nullable=True)

    # Storage identifier
    slug = Column(String(200), nullable=True, unique=True, index=True)

    # 개별 문항 목표 개수 (기본값 20)
    target_individual_items_count = Column(Integer, nullable=False, default=20)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    files = relationship(
        "FileAsset",
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class FileAsset(Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, index=True)

    project_id = Column(
        Integer,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    file_key = Column(String(1024), nullable=False, index=True)
    original_name = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=True)
    size = Column(Integer, nullable=True)
    file_type = Column(String(32), nullable=True)

    # 누가 업로드했는지 기록 (기여도 평가를 위해)
    uploaded_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="files")
    uploaded_by = relationship("User", foreign_keys=[uploaded_by_user_id])


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True, index=True)

    # 활동 타입: "file_upload", "file_delete", "review" (나중에 추가)
    activity_type = Column(String(32), nullable=False, index=True)

    # 프로젝트 (필수)
    project_id = Column(
        Integer,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 파일 정보 (nullable - 삭제된 파일도 참조 가능하도록)
    file_asset_id = Column(
        Integer,
        ForeignKey("files.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # 누가 활동을 했는지
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # 파일 정보 (삭제 후에도 보관하기 위해 별도 저장)
    file_name = Column(String(255), nullable=True)
    file_type = Column(String(32), nullable=True)

    # 간결한 설명
    description = Column(String(500), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    project = relationship("Project")
    file_asset = relationship("FileAsset", foreign_keys=[file_asset_id])
    user = relationship("User", foreign_keys=[user_id])


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)

    # 검토 대상 파일
    file_asset_id = Column(
        Integer,
        ForeignKey("files.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        unique=True,  # 파일당 하나의 검토만
    )

    # 검토 상태: "pending", "in_progress", "request_revision", "approved"
    status = Column(String(32), nullable=False, default="pending", index=True)

    # 검토자
    reviewer_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # 검토 시작 시각
    started_at = Column(DateTime, nullable=True)

    # 검토 완료 시각
    completed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    file_asset = relationship("FileAsset", foreign_keys=[file_asset_id])
    reviewer = relationship("User", foreign_keys=[reviewer_id])
    comments = relationship("ReviewComment", back_populates="review", cascade="all, delete-orphan")


class ReviewComment(Base):
    __tablename__ = "review_comments"

    id = Column(Integer, primary_key=True, index=True)

    # 검토
    review_id = Column(
        Integer,
        ForeignKey("reviews.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 코멘트 작성자
    author_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # 코멘트 타입: "text", "handwriting" (손글씨 이미지)
    comment_type = Column(String(32), nullable=False, default="text")

    # 텍스트 코멘트 내용
    text_content = Column(Text, nullable=True)

    # 손글씨 이미지 URL (MinIO에 저장)
    handwriting_image_url = Column(String(512), nullable=True)

    # 페이지 번호 (PDF의 경우)
    page_number = Column(Integer, nullable=True)

    # X, Y 좌표 (페이지 내 위치)
    x_position = Column(Integer, nullable=True)
    y_position = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    review = relationship("Review", back_populates="comments")
    author = relationship("User", foreign_keys=[author_id])


# --------------------
# Signup Request (legacy table)
# --------------------

class SignupRequest(Base):
    __tablename__ = "signup_requests"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    note = Column(Text, nullable=True)

    status = Column(String(20), nullable=False, default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by = relationship("User", foreign_keys=[approved_by_user_id])

# --------------------
# Password Change Request (pending approval)
# --------------------

class PasswordChangeRequest(Base):
    """비밀번호 변경 요청: 본인 확인 후 요청 → 관리자 승인 시 적용"""
    __tablename__ = "password_change_requests"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    new_password_hash = Column(String(255), nullable=False)

    status = Column(String(20), nullable=False, default="pending", index=True)  # pending, approved, rejected

    requested_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    approved_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    approved_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    approved_by = relationship("User", foreign_keys=[approved_by_user_id])


# --- NEW: link table for multi departments ---
class UserDepartment(Base):
    __tablename__ = "user_departments"
    __table_args__ = (
        UniqueConstraint("user_id", "department", name="uq_user_departments_user_id_department"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    department = Column(Enum(Department), nullable=False, index=True)

    #created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # relationship backref (User.side should also define relationship)
    user = relationship("User", back_populates="department_links")
