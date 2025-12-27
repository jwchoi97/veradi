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
    PendingUserOut,
    PendingUserListOut,
    ApproveUserRequest
)
from ..security import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def require_admin(db: Session, x_user_id: str | None):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Missing X-User-Id")
    try:
        uid = int(x_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-User-Id")

    admin = db.query(User).filter(User.id == uid).first()
    if not admin or admin.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")

    return admin

def normalize_phone_digits(v: str) -> str:
    return "".join(ch for ch in v if ch.isdigit())


@router.post("/bootstrap-admin", status_code=201)
def bootstrap_admin(
    payload: BootstrapAdminRequest,
    x_bootstrap_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    expected_key = os.getenv("BOOTSTRAP_ADMIN_KEY")
    if not expected_key:
        raise HTTPException(status_code=500, detail="BOOTSTRAP_ADMIN_KEY is not set on server")

    if not x_bootstrap_key or not secrets.compare_digest(x_bootstrap_key, expected_key):
        raise HTTPException(status_code=401, detail="Invalid bootstrap key")

    admin_exists = db.query(User).filter(User.role == UserRole.ADMIN).first()
    if admin_exists:
        raise HTTPException(status_code=409, detail="Admin already exists")

    user_exists = db.query(User).filter(User.username == payload.username).first()
    if user_exists:
        raise HTTPException(status_code=409, detail="Username already exists")

    phone = getattr(payload, "phone_number", None)
    phone = normalize_phone_digits(phone) if phone else None

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=UserRole.ADMIN,
        department=Department.ADMIN,
        phone_number=phone,
        phone_verified=bool(phone),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

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

    # ✅ block until approved
    if user.role == UserRole.PENDING:
        raise HTTPException(status_code=403, detail="PENDING_APPROVAL")

    return LoginResponse(
        id=user.id,
        username=user.username,
        role=user.role,
        department=user.department,
    )


@router.post("/signup", response_model=UserOut, status_code=201)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    # ✅ password confirm check
    if payload.password != payload.password_confirm:
        raise HTTPException(status_code=400, detail="PASSWORD_MISMATCH")

    exists = db.query(User).filter(User.username == payload.username).first()
    if exists:
        raise HTTPException(status_code=409, detail="Username already exists")

    phone_digits = normalize_phone_digits(payload.phone_number)
    if len(phone_digits) < 10 or len(phone_digits) > 11:
        raise HTTPException(status_code=400, detail="INVALID_PHONE_NUMBER")

    exists_phone = db.query(User).filter(User.phone_number == phone_digits).first()
    if exists_phone:
        raise HTTPException(status_code=409, detail="Phone number already exists")

    # ✅ public signup: waiting for admin approval
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=UserRole.PENDING,
        department=payload.department,
        phone_number=phone_digits,
        phone_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@router.get("/pending", response_model=PendingUserListOut)
def list_pending(db: Session = Depends(get_db), x_user_id: str | None = Header(default=None)):
    require_admin(db, x_user_id)
    items = (
        db.query(User)
        .filter(User.role == UserRole.PENDING)
        .order_by(User.id.desc())
        .all()
    )
    return PendingUserListOut(
        total=len(items),
        items=[PendingUserOut.model_validate(u) for u in items],
    )

@router.post("/{user_id}/approve", response_model=PendingUserOut)
def approve_user(
    user_id: int,
    payload: ApproveUserRequest,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    require_admin(db, x_user_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != UserRole.PENDING:
        raise HTTPException(status_code=409, detail="User is not pending")

    # ✅ Only LEAD / MEMBER allowed here
    if payload.role not in (UserRole.LEAD, UserRole.MEMBER):
        raise HTTPException(status_code=400, detail="Invalid role for approval")

    user.role = payload.role
    db.commit()
    db.refresh(user)
    return PendingUserOut.model_validate(user)

@router.post("/{user_id}/reject", status_code=204)
def reject_user(
    user_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    # 관리자 권한 체크
    require_admin(db, x_user_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.role != UserRole.PENDING:
        raise HTTPException(status_code=409, detail="User is not pending")

    # ✅ 거절 = 완전 삭제 (재가입 가능)
    db.delete(user)
    db.commit()
    return
