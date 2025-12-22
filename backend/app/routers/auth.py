# routers/auth.py
from __future__ import annotations

import os
import secrets
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session

from ..mariadb.database import SessionLocal
from ..mariadb.models import User, UserRole, Department
from ..schemas import (
    SignupRequest,
    UserOut,
    BootstrapAdminRequest,
    LoginRequest,
    LoginResponse,
)
from ..security import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/bootstrap-admin", status_code=201)
def bootstrap_admin(
    payload: BootstrapAdminRequest,
    x_bootstrap_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    One-time bootstrap endpoint to create the first ADMIN account.
    Protected by BOOTSTRAP_ADMIN_KEY header and locks forever after an admin exists.
    """
    expected_key = os.getenv("BOOTSTRAP_ADMIN_KEY")
    if not expected_key:
        raise HTTPException(status_code=500, detail="BOOTSTRAP_ADMIN_KEY is not set on server")

    if not x_bootstrap_key or not secrets.compare_digest(x_bootstrap_key, expected_key):
        raise HTTPException(status_code=401, detail="Invalid bootstrap key")

    # Block if any admin already exists
    admin_exists = db.query(User).filter(User.role == UserRole.ADMIN).first()
    if admin_exists:
        raise HTTPException(status_code=409, detail="Admin already exists")

    # Prevent duplicate username
    user_exists = db.query(User).filter(User.username == payload.username).first()
    if user_exists:
        raise HTTPException(status_code=409, detail="Username already exists")

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=UserRole.ADMIN,
        department=Department.ADMIN,
        phone_number=getattr(payload, "phone_number", None),
        phone_verified=bool(getattr(payload, "phone_number", None)),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Keep response minimal and aligned with your current schema
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "department": user.department,
    }


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Return fields that exist in the new model (no is_admin)
    return LoginResponse(
        id=user.id,
        username=user.username,
        role=user.role,
        department=user.department,
    )


@router.post("/signup", response_model=UserOut, status_code=201)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    # Public signup: force MEMBER to prevent privilege escalation
    role = UserRole.MEMBER

    exists = db.query(User).filter(User.username == payload.username).first()
    if exists:
        raise HTTPException(status_code=409, detail="Username already exists")

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=role,
        department=payload.department,
        phone_number=payload.phone_number,
        phone_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

