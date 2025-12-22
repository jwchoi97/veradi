# models.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, func, Enum
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base
import enum

class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    subject = Column(String(100), nullable=False)
    description = Column(String(500))
    status = Column(String(20), default="OPEN")
    deadline = Column(DateTime)
    year = Column(String(10), nullable=True)
    file_key = Column(String(255))  # optional legacy; keep or drop
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    files = relationship("FileAsset", back_populates="project", cascade="all, delete-orphan")


class FileAsset(Base):
    __tablename__ = "files"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    file_key = Column(String(255), nullable=False, index=True)
    original_name = Column(String(255), nullable=False)
    mime_type = Column(String(100))
    size = Column(Integer)  # bytes
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    file_type = Column(String(32), nullable=True)

    project = relationship("Project", back_populates="files")




class SignupRequest(Base):
    __tablename__ = "signup_requests"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    note = Column(Text, nullable=True)

    status = Column(String(20), nullable=False, default="pending")  # pending/approved/rejected
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by = relationship("User", foreign_keys=[approved_by_user_id])

# User Management #
class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    LEAD = "LEAD"
    MEMBER = "MEMBER"

class Department(str, enum.Enum):
    ADMIN = "ADMIN"
    PHYSICS_1 = "PHYSICS_1"
    CHEMISTRY_1 = "CHEMISTRY_1"
    BIOLOGY_1 = "BIOLOGY_1"
    EARTH_1 = "EARTH_1"
    CHEMISTRY_2 = "CHEMISTRY_2"
    SOCIOCULTURE = "SOCIOCULTURE"
    MATH = "MATH"

# class User(Base):
#     __tablename__ = "users"

#     id = Column(Integer, primary_key=True, index=True)
#     email = Column(String(255), unique=True, index=True, nullable=False)
#     password_hash = Column(String(255), nullable=False)

#     is_admin = Column(Boolean, nullable=False, default=False)
#     is_active = Column(Boolean, nullable=False, default=True)

#     created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)

    role = Column(Enum(UserRole), nullable=False, default=UserRole.MEMBER)
    department = Column(Enum(Department), nullable=False)

    phone_number = Column(String(32), unique=True, index=True, nullable=False)
    phone_verified = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

