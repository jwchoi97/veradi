# FILE: backend/app/mariadb/models.py

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

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="files")


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
