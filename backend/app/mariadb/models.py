# FILE: backend/app/mariadb/models.py

from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    Text,
    func,
    Enum,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base
import enum


# --------------------
# User Management
# --------------------

class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    LEAD = "LEAD"
    MEMBER = "MEMBER"
    PENDING = "PENDING"


class Department(str, enum.Enum):
    ADMIN = "ADMIN"
    PHYSICS_1 = "PHYSICS_1"
    CHEMISTRY_1 = "CHEMISTRY_1"
    BIOLOGY_1 = "BIOLOGY_1"
    EARTH_1 = "EARTH_1"
    CHEMISTRY_2 = "CHEMISTRY_2"
    SOCIOCULTURE = "SOCIOCULTURE"
    MATH = "MATH"


class UserDepartment(Base):
    """
    NEW: user <-> department (many-to-many)
    - We keep legacy User.department for now (no migration yet).
    """
    __tablename__ = "user_departments"
    __table_args__ = (
        UniqueConstraint("user_id", "department", name="uq_user_departments_user_department"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    department = Column(Enum(Department), nullable=False, index=True)

    user = relationship("User", back_populates="department_links")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    username = Column(String(64), unique=True, index=True, nullable=False)
    name = Column(String(50), nullable=True)
    password_hash = Column(String(255), nullable=False)

    role = Column(Enum(UserRole), nullable=False, default=UserRole.MEMBER)

    # LEGACY (kept for now)
    # NOTE: currently in your DB this is NOT NULL, so we keep it as-is until migration.
    department = Column(Enum(Department), nullable=False)

    # NEW multi-departments
    department_links = relationship(
        "UserDepartment",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    phone_number = Column(String(32), unique=True, index=True, nullable=False)
    phone_verified = Column(Boolean, nullable=False, default=False)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        onupdate=func.now(),
    )

    def departments_set(self) -> set[Department]:
        deps = {link.department for link in (self.department_links or [])}
        if deps:
            return deps
        return {self.department} if self.department is not None else set()


# --------------------
# Project / Files
# --------------------

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String(200), nullable=False)
    subject = Column(String(100), nullable=False)
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

    # ✅ NEW: project team ownership (authorization key)
    owner_department = Column(Enum(Department), nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

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
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by = relationship("User", foreign_keys=[approved_by_user_id])



# # FILE: backend/app/mariadb/models.py

# from sqlalchemy import (
#     Column,
#     Integer,
#     String,
#     Boolean,
#     DateTime,
#     ForeignKey,
#     Text,
#     func,
#     Enum,
# )
# from sqlalchemy.orm import relationship
# from datetime import datetime
# from .database import Base
# import enum


# # --------------------
# # Project / Files
# # --------------------

# class Project(Base):
#     __tablename__ = "projects"

#     id = Column(Integer, primary_key=True, index=True)

#     name = Column(String(200), nullable=False)
#     subject = Column(String(100), nullable=False)
#     description = Column(String(500))

#     # NEW: category (default '기타')
#     category = Column(String(50), nullable=False, default="기타")

#     status = Column(String(20), nullable=False, default="OPEN")

#     # Legacy single deadline (kept for backward compatibility; will be migrated to deadline_final)
#     deadline = Column(DateTime, nullable=True)

#     # NEW multi deadlines
#     deadline_1 = Column(DateTime, nullable=True)
#     deadline_2 = Column(DateTime, nullable=True)
#     deadline_final = Column(DateTime, nullable=True)

#     year = Column(String(10), nullable=True)

#     # Legacy field (optional, safe to keep for backward compatibility)
#     file_key = Column(String(255), nullable=True)

#     # Human-friendly stable identifier for storage paths
#     slug = Column(String(200), nullable=True, unique=True, index=True)

#     created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
#     updated_at = Column(
#         DateTime,
#         default=datetime.utcnow,
#         onupdate=datetime.utcnow,
#         nullable=False,
#     )

#     files = relationship(
#         "FileAsset",
#         back_populates="project",
#         cascade="all, delete-orphan",
#         passive_deletes=True,
#     )

# class FileAsset(Base):
#     __tablename__ = "files"

#     id = Column(Integer, primary_key=True, index=True)

#     project_id = Column(
#         Integer,
#         ForeignKey("projects.id", ondelete="CASCADE"),
#         nullable=False,
#         index=True,
#     )

#     # MinIO object key (path)
#     file_key = Column(String(1024), nullable=False, index=True)

#     original_name = Column(String(255), nullable=False)
#     mime_type = Column(String(100), nullable=True)
#     size = Column(Integer, nullable=True)  # bytes
#     file_type = Column(String(32), nullable=True)

#     created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

#     # Relationship: FileAsset -> Project
#     project = relationship("Project", back_populates="files")


# # --------------------
# # Signup Request
# # --------------------

# class SignupRequest(Base):
#     __tablename__ = "signup_requests"

#     id = Column(Integer, primary_key=True, index=True)
#     email = Column(String(255), unique=True, index=True, nullable=False)
#     note = Column(Text, nullable=True)

#     status = Column(String(20), nullable=False, default="pending")  # pending/approved/rejected
#     created_at = Column(
#         DateTime(timezone=True),
#         server_default=func.now(),
#         nullable=False,
#     )

#     approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
#     approved_by = relationship("User", foreign_keys=[approved_by_user_id])


# # --------------------
# # User Management
# # --------------------

# class UserRole(str, enum.Enum):
#     ADMIN = "ADMIN"
#     LEAD = "LEAD"
#     MEMBER = "MEMBER"
#     PENDING = "PENDING"


# class Department(str, enum.Enum):
#     ADMIN = "ADMIN"
#     PHYSICS_1 = "PHYSICS_1"
#     CHEMISTRY_1 = "CHEMISTRY_1"
#     BIOLOGY_1 = "BIOLOGY_1"
#     EARTH_1 = "EARTH_1"
#     CHEMISTRY_2 = "CHEMISTRY_2"
#     SOCIOCULTURE = "SOCIOCULTURE"
#     MATH = "MATH"


# class User(Base):
#     __tablename__ = "users"

#     id = Column(Integer, primary_key=True, index=True)

#     username = Column(String(64), unique=True, index=True, nullable=False)
#     name = Column(String(50), nullable=True)
#     password_hash = Column(String(255), nullable=False)

#     role = Column(Enum(UserRole), nullable=False, default=UserRole.MEMBER)
#     department = Column(Enum(Department), nullable=False)

#     phone_number = Column(String(32), unique=True, index=True, nullable=False)
#     phone_verified = Column(Boolean, nullable=False, default=False)

#     created_at = Column(
#         DateTime(timezone=True),
#         server_default=func.now(),
#         nullable=False,
#     )
#     updated_at = Column(
#         DateTime(timezone=True),
#         onupdate=func.now(),
#     )
