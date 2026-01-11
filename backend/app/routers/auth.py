from __future__ import annotations

import os
import secrets
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session

from ..mariadb.database import SessionLocal
from ..mariadb.models import User, UserRole, Department, UserDepartment
from ..schemas import (
    SignupRequest,
    UserOut,
    BootstrapAdminRequest,
    LoginRequest,
    LoginResponse,
    PendingUserOut,
    PendingUserListOut,
    ApproveUserRequest,
)
from ..security import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(db: Session, x_user_id: str | None) -> User:
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Missing X-User-Id")
    try:
        uid = int(x_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-User-Id")

    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid user")
    if user.role == UserRole.PENDING:
        raise HTTPException(status_code=403, detail="PENDING_APPROVAL")
    return user


def require_admin(db: Session, x_user_id: str | None):
    user = get_current_user(db, x_user_id)
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def normalize_phone_digits(v: str) -> str:
    return "".join(ch for ch in v if ch.isdigit())


def _resolve_departments_from_signup(payload: SignupRequest) -> list[Department]:
    # Prefer new multi field, fallback to legacy single.
    deps = payload.departments or []
    if not deps and payload.department is not None:
        deps = [payload.department]

    # remove duplicates preserving order
    seen = set()
    out: list[Department] = []
    for d in deps:
        if d in seen:
            continue
        seen.add(d)
        out.append(d)

    if not out:
        raise HTTPException(status_code=400, detail="DEPARTMENT_REQUIRED")
    return out


def _set_user_departments(db: Session, user: User, deps: list[Department]) -> None:
    # hard replace links
    db.query(UserDepartment).filter(UserDepartment.user_id == user.id).delete()
    db.add_all([UserDepartment(user_id=user.id, department=d) for d in deps])

    # keep legacy single as "primary" (first)
    user.department = deps[0]
    db.add(user)


def _user_out(u: User) -> UserOut:
    out = UserOut.model_validate(u)
    out.departments = list(u.departments_set())
    return out


def _pending_out(u: User) -> PendingUserOut:
    out = PendingUserOut.model_validate(u)
    out.departments = list(u.departments_set())
    return out


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
        phone_number=phone or "0000000000",
        phone_verified=bool(phone),
        name=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # also set multi departments (ADMIN)
    _set_user_departments(db, user, [Department.ADMIN])
    db.commit()
    db.refresh(user)

    return {
        "id": user.id,
        "username": user.username,
        "name": user.name,
        "role": user.role,
        "department": user.department,
    }


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if user.role == UserRole.PENDING:
        raise HTTPException(status_code=403, detail="PENDING_APPROVAL")

    return LoginResponse(
        id=user.id,
        username=user.username,
        name=user.name,
        role=user.role,
        department=user.department,
        departments=list(user.departments_set()),
    )


@router.post("/signup", response_model=UserOut, status_code=201)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
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

    deps = _resolve_departments_from_signup(payload)

    user = User(
        username=payload.username,
        name=payload.name,
        password_hash=hash_password(payload.password),
        role=UserRole.PENDING,
        department=deps[0],  # legacy primary
        phone_number=phone_digits,
        phone_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    _set_user_departments(db, user, deps)
    db.commit()
    db.refresh(user)

    return _user_out(user)


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
        items=[_pending_out(u) for u in items],
    )


def _coerce_user_role_for_approval(v) -> UserRole:
    """
    Accept both enum and string values from the request payload.
    This prevents false "Invalid role for approval" when the schema sends strings.
    """
    if isinstance(v, UserRole):
        return v
    if isinstance(v, str):
        try:
            return UserRole(v)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid role for approval")
    raise HTTPException(status_code=400, detail="Invalid role for approval")


def _coerce_departments_list(v) -> list[Department]:
    """
    Accept list[Department] or list[str] and normalize to list[Department].
    """
    if v is None:
        return []
    if not isinstance(v, list):
        raise HTTPException(status_code=400, detail="departments must be a list")

    out: list[Department] = []
    for d in v:
        if isinstance(d, Department):
            out.append(d)
            continue
        if isinstance(d, str):
            try:
                out.append(Department(d))
                continue
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid department")
        raise HTTPException(status_code=400, detail="Invalid department")
    return out


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

    role = _coerce_user_role_for_approval(getattr(payload, "role", None))
    if role not in (UserRole.LEAD, UserRole.MEMBER):
        raise HTTPException(status_code=400, detail="Invalid role for approval")

    user.role = role
    db.add(user)

    # Optional: set departments on approval
    if getattr(payload, "departments", None) is not None:
        # Normalize + dedup preserving order
        raw_deps = _coerce_departments_list(payload.departments)
        seen = set()
        deps: list[Department] = []
        for d in raw_deps:
            if d in seen:
                continue
            seen.add(d)
            deps.append(d)
        if not deps:
            raise HTTPException(status_code=400, detail="departments cannot be empty")
        _set_user_departments(db, user, deps)

    db.commit()
    db.refresh(user)
    return _pending_out(user)


@router.post("/{user_id}/reject", status_code=204)
def reject_user(
    user_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    require_admin(db, x_user_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.role != UserRole.PENDING:
        raise HTTPException(status_code=409, detail="User is not pending")

    db.delete(user)
    db.commit()
    return


# # FILE: backend/app/routers/auth.py
# from __future__ import annotations

# import os
# import secrets
# from fastapi import APIRouter, Depends, HTTPException, Header
# from sqlalchemy.orm import Session

# from ..mariadb.database import SessionLocal
# from ..mariadb.models import User, UserRole, Department, UserDepartment
# from ..schemas import (
#     SignupRequest,
#     UserOut,
#     BootstrapAdminRequest,
#     LoginRequest,
#     LoginResponse,
#     PendingUserOut,
#     PendingUserListOut,
#     ApproveUserRequest,
# )
# from ..security import hash_password, verify_password

# router = APIRouter(prefix="/auth", tags=["auth"])


# def get_db():
#     db = SessionLocal()
#     try:
#         yield db
#     finally:
#         db.close()


# def get_current_user(db: Session, x_user_id: str | None) -> User:
#     if not x_user_id:
#         raise HTTPException(status_code=401, detail="Missing X-User-Id")
#     try:
#         uid = int(x_user_id)
#     except ValueError:
#         raise HTTPException(status_code=400, detail="Invalid X-User-Id")

#     user = db.query(User).filter(User.id == uid).first()
#     if not user:
#         raise HTTPException(status_code=401, detail="Invalid user")
#     if user.role == UserRole.PENDING:
#         raise HTTPException(status_code=403, detail="PENDING_APPROVAL")
#     return user


# def require_admin(db: Session, x_user_id: str | None):
#     user = get_current_user(db, x_user_id)
#     if user.role != UserRole.ADMIN:
#         raise HTTPException(status_code=403, detail="Admin only")
#     return user


# def normalize_phone_digits(v: str) -> str:
#     return "".join(ch for ch in v if ch.isdigit())


# def _resolve_departments_from_signup(payload: SignupRequest) -> list[Department]:
#     # Prefer new multi field, fallback to legacy single.
#     deps = payload.departments or []
#     if not deps and payload.department is not None:
#         deps = [payload.department]

#     # remove duplicates preserving order
#     seen = set()
#     out: list[Department] = []
#     for d in deps:
#         if d in seen:
#             continue
#         seen.add(d)
#         out.append(d)

#     if not out:
#         raise HTTPException(status_code=400, detail="DEPARTMENT_REQUIRED")
#     return out


# def _set_user_departments(db: Session, user: User, deps: list[Department]) -> None:
#     # hard replace links
#     db.query(UserDepartment).filter(UserDepartment.user_id == user.id).delete()
#     db.add_all([UserDepartment(user_id=user.id, department=d) for d in deps])

#     # keep legacy single as "primary" (first)
#     user.department = deps[0]
#     db.add(user)


# def _user_out(u: User) -> UserOut:
#     out = UserOut.model_validate(u)
#     out.departments = list(u.departments_set())
#     return out


# def _pending_out(u: User) -> PendingUserOut:
#     out = PendingUserOut.model_validate(u)
#     out.departments = list(u.departments_set())
#     return out


# @router.post("/bootstrap-admin", status_code=201)
# def bootstrap_admin(
#     payload: BootstrapAdminRequest,
#     x_bootstrap_key: str | None = Header(default=None),
#     db: Session = Depends(get_db),
# ):
#     expected_key = os.getenv("BOOTSTRAP_ADMIN_KEY")
#     if not expected_key:
#         raise HTTPException(status_code=500, detail="BOOTSTRAP_ADMIN_KEY is not set on server")

#     if not x_bootstrap_key or not secrets.compare_digest(x_bootstrap_key, expected_key):
#         raise HTTPException(status_code=401, detail="Invalid bootstrap key")

#     admin_exists = db.query(User).filter(User.role == UserRole.ADMIN).first()
#     if admin_exists:
#         raise HTTPException(status_code=409, detail="Admin already exists")

#     user_exists = db.query(User).filter(User.username == payload.username).first()
#     if user_exists:
#         raise HTTPException(status_code=409, detail="Username already exists")

#     phone = getattr(payload, "phone_number", None)
#     phone = normalize_phone_digits(phone) if phone else None

#     user = User(
#         username=payload.username,
#         password_hash=hash_password(payload.password),
#         role=UserRole.ADMIN,
#         department=Department.ADMIN,
#         phone_number=phone or "0000000000",
#         phone_verified=bool(phone),
#         name=None,
#     )
#     db.add(user)
#     db.commit()
#     db.refresh(user)

#     # also set multi departments (ADMIN)
#     _set_user_departments(db, user, [Department.ADMIN])
#     db.commit()
#     db.refresh(user)

#     return {
#         "id": user.id,
#         "username": user.username,
#         "name": user.name,
#         "role": user.role,
#         "department": user.department,
#     }


# @router.post("/login", response_model=LoginResponse)
# def login(payload: LoginRequest, db: Session = Depends(get_db)):
#     user = db.query(User).filter(User.username == payload.username).first()
#     if not user or not verify_password(payload.password, user.password_hash):
#         raise HTTPException(status_code=401, detail="Invalid credentials")

#     if user.role == UserRole.PENDING:
#         raise HTTPException(status_code=403, detail="PENDING_APPROVAL")

#     return LoginResponse(
#         id=user.id,
#         username=user.username,
#         name=user.name,
#         role=user.role,
#         department=user.department,
#         departments=list(user.departments_set()),
#     )


# @router.post("/signup", response_model=UserOut, status_code=201)
# def signup(payload: SignupRequest, db: Session = Depends(get_db)):
#     if payload.password != payload.password_confirm:
#         raise HTTPException(status_code=400, detail="PASSWORD_MISMATCH")

#     exists = db.query(User).filter(User.username == payload.username).first()
#     if exists:
#         raise HTTPException(status_code=409, detail="Username already exists")

#     phone_digits = normalize_phone_digits(payload.phone_number)
#     if len(phone_digits) < 10 or len(phone_digits) > 11:
#         raise HTTPException(status_code=400, detail="INVALID_PHONE_NUMBER")

#     exists_phone = db.query(User).filter(User.phone_number == phone_digits).first()
#     if exists_phone:
#         raise HTTPException(status_code=409, detail="Phone number already exists")

#     deps = _resolve_departments_from_signup(payload)

#     user = User(
#         username=payload.username,
#         name=payload.name,
#         password_hash=hash_password(payload.password),
#         role=UserRole.PENDING,
#         department=deps[0],  # legacy primary
#         phone_number=phone_digits,
#         phone_verified=False,
#     )
#     db.add(user)
#     db.commit()
#     db.refresh(user)

#     _set_user_departments(db, user, deps)
#     db.commit()
#     db.refresh(user)

#     return _user_out(user)


# @router.get("/pending", response_model=PendingUserListOut)
# def list_pending(db: Session = Depends(get_db), x_user_id: str | None = Header(default=None)):
#     require_admin(db, x_user_id)

#     items = (
#         db.query(User)
#         .filter(User.role == UserRole.PENDING)
#         .order_by(User.id.desc())
#         .all()
#     )

#     return PendingUserListOut(
#         total=len(items),
#         items=[_pending_out(u) for u in items],
#     )


# @router.post("/{user_id}/approve", response_model=PendingUserOut)
# def approve_user(
#     user_id: int,
#     payload: ApproveUserRequest,
#     db: Session = Depends(get_db),
#     x_user_id: str | None = Header(default=None),
# ):
#     require_admin(db, x_user_id)

#     user = db.query(User).filter(User.id == user_id).first()
#     if not user:
#         raise HTTPException(status_code=404, detail="User not found")
#     if user.role != UserRole.PENDING:
#         raise HTTPException(status_code=409, detail="User is not pending")

#     if payload.role not in (UserRole.LEAD, UserRole.MEMBER):
#         raise HTTPException(status_code=400, detail="Invalid role for approval")

#     user.role = payload.role
#     db.add(user)

#     # Optional: set departments on approval
#     if payload.departments is not None:
#         # dedup preserving order
#         seen = set()
#         deps: list[Department] = []
#         for d in payload.departments:
#             if d in seen:
#                 continue
#             seen.add(d)
#             deps.append(d)
#         if not deps:
#             raise HTTPException(status_code=400, detail="departments cannot be empty")
#         _set_user_departments(db, user, deps)

#     db.commit()
#     db.refresh(user)
#     return _pending_out(user)


# @router.post("/{user_id}/reject", status_code=204)
# def reject_user(
#     user_id: int,
#     db: Session = Depends(get_db),
#     x_user_id: str | None = Header(default=None),
# ):
#     require_admin(db, x_user_id)

#     user = db.query(User).filter(User.id == user_id).first()
#     if not user:
#         raise HTTPException(status_code=404, detail="User not found")

#     if user.role != UserRole.PENDING:
#         raise HTTPException(status_code=409, detail="User is not pending")

#     db.delete(user)
#     db.commit()
#     return

