from __future__ import annotations

import os
import secrets
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Header, UploadFile, File
from sqlalchemy.orm import Session

from ..mariadb.database import SessionLocal
from ..mariadb.models import User, UserRole, Department, UserDepartment, PasswordChangeRequest
from ..schemas import (
    SignupRequest,
    UserOut,
    UserUpdate,
    UserContributionStats,
    ActivityItem,
    BootstrapAdminRequest,
    LoginRequest,
    LoginResponse,
    PendingUserOut,
    PendingUserListOut,
    ApproveUserRequest,
    AdminUserUpdateRequest,
    ForgotPasswordVerifyRequest,
    ForgotPasswordResetRequest,
    PasswordChangeRequestOut,
    PasswordChangeRequestListOut,
)
from ..mariadb.models import FileAsset, Project, Activity
from sqlalchemy import func, extract
from datetime import datetime, timezone
from ..security import hash_password, verify_password
from ..minio.service import upload_stream, presign_download_url, delete_object

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
    """
    Prefer `departments` (multi). Fallback to legacy `department`.
    Must end up with at least 1.
    """
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

    # ADMIN is role, but keep it allowed if ever sent (safe)
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
    # departments_set() should exist on User model (your earlier code 기준)
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
        # NOTE: Department enum has no ADMIN; role controls admin permission.
        # Keep a valid Department value to satisfy NOT NULL column.
        department=Department.PHYSICS_1,
        phone_number=phone or "0000000000",
        phone_verified=bool(phone),
        name=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Keep legacy/multi department data consistent
    _set_user_departments(db, user, [user.department])
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


@router.post("/forgot-password/verify")
def forgot_password_verify(payload: ForgotPasswordVerifyRequest, db: Session = Depends(get_db)):
    """아이디와 가입 시 등록한 전화번호가 일치하는지 확인. 일치하면 비밀번호 재설정 단계로 진행 가능."""
    user = db.query(User).filter(User.username == payload.username).first()
    phone_digits = normalize_phone_digits(payload.phone_number)
    if len(phone_digits) < 10 or len(phone_digits) > 11:
        raise HTTPException(status_code=400, detail="INVALID_PHONE_NUMBER")
    if not user or user.phone_number != phone_digits:
        raise HTTPException(status_code=400, detail="아이디와 등록된 전화번호가 일치하지 않습니다.")
    return {"ok": True}


@router.post("/forgot-password/reset")
def forgot_password_reset(payload: ForgotPasswordResetRequest, db: Session = Depends(get_db)):
    """아이디·전화번호 확인 후 비밀번호 변경 요청 생성. 관리자 승인 시 적용됩니다."""
    if payload.new_password != payload.new_password_confirm:
        raise HTTPException(status_code=400, detail="PASSWORD_MISMATCH")
    user = db.query(User).filter(User.username == payload.username).first()
    phone_digits = normalize_phone_digits(payload.phone_number)
    if len(phone_digits) < 10 or len(phone_digits) > 11:
        raise HTTPException(status_code=400, detail="INVALID_PHONE_NUMBER")
    if not user or user.phone_number != phone_digits:
        raise HTTPException(status_code=400, detail="아이디와 등록된 전화번호가 일치하지 않습니다.")
    new_hash = hash_password(payload.new_password)
    req = PasswordChangeRequest(
        user_id=user.id,
        new_password_hash=new_hash,
        status="pending",
    )
    db.add(req)
    db.commit()
    return {"ok": True, "message": "비밀번호 변경 요청이 접수되었습니다. 관리자 승인 후 새 비밀번호가 적용됩니다."}


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


# -------- 비밀번호 변경 요청 (승인 대기) --------

def _password_change_request_out(req: PasswordChangeRequest, user: User) -> PasswordChangeRequestOut:
    return PasswordChangeRequestOut(
        id=req.id,
        user_id=req.user_id,
        username=user.username,
        name=user.name,
        phone_number=user.phone_number or "",
        requested_at=req.requested_at,
    )


@router.get("/pending-password-changes", response_model=PasswordChangeRequestListOut)
def list_pending_password_changes(
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """Admin only. List pending password change requests."""
    require_admin(db, x_user_id)
    items = (
        db.query(PasswordChangeRequest)
        .filter(PasswordChangeRequest.status == "pending")
        .order_by(PasswordChangeRequest.id.desc())
        .all()
    )
    out = []
    for req in items:
        user = db.query(User).filter(User.id == req.user_id).first()
        if user:
            out.append(_password_change_request_out(req, user))
    return PasswordChangeRequestListOut(total=len(out), items=out)


@router.post("/pending-password-changes/{request_id}/approve", status_code=200)
def approve_pending_password_change(
    request_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """Admin only. Apply the new password and mark request as approved."""
    require_admin(db, x_user_id)
    req = db.query(PasswordChangeRequest).filter(
        PasswordChangeRequest.id == request_id,
        PasswordChangeRequest.status == "pending",
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Pending password change request not found")
    user = db.query(User).filter(User.id == req.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = req.new_password_hash
    db.add(user)
    req.status = "approved"
    req.approved_by_user_id = int(x_user_id)
    req.approved_at = datetime.now(timezone.utc)
    db.add(req)
    db.commit()
    return {"ok": True, "message": "비밀번호가 변경되었습니다."}


@router.post("/pending-password-changes/{request_id}/reject", status_code=200)
def reject_pending_password_change(
    request_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """Admin only. Reject the password change request."""
    require_admin(db, x_user_id)
    req = db.query(PasswordChangeRequest).filter(
        PasswordChangeRequest.id == request_id,
        PasswordChangeRequest.status == "pending",
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Pending password change request not found")
    req.status = "rejected"
    req.approved_by_user_id = int(x_user_id)
    req.approved_at = datetime.now(timezone.utc)
    db.add(req)
    db.commit()
    return {"ok": True, "message": "비밀번호 변경 요청을 거절했습니다."}


@router.get("/users", response_model=List[UserOut])
def list_all_users(
    department: Department | None = None,
    role: UserRole | None = None,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """Admin only. List all registered users. Optional filters: department (소속 팀), role (부여된 역할)."""
    require_admin(db, x_user_id)

    query = db.query(User).order_by(User.id.asc())
    if role is not None:
        query = query.filter(User.role == role)
    if department is not None:
        query = query.filter(User.department == department)

    items = query.all()
    return [_user_out(u) for u in items]


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """Admin only. Permanently delete a user from the DB."""
    require_admin(db, x_user_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Cannot delete ADMIN account")

    db.delete(user)
    db.commit()
    return


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: AdminUserUpdateRequest,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """Admin only. Update user role and/or departments."""
    require_admin(db, x_user_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.role is not None:
        if user.role == UserRole.ADMIN:
            raise HTTPException(status_code=403, detail="Cannot change ADMIN role")
        if payload.role == UserRole.ADMIN:
            raise HTTPException(status_code=403, detail="Cannot assign ADMIN role via this endpoint")
        user.role = payload.role
        db.add(user)
    if payload.departments is not None:
        if len(payload.departments) == 0:
            raise HTTPException(status_code=400, detail="At least one department required")
        _set_user_departments(db, user, payload.departments)

    db.commit()
    db.refresh(user)
    return _user_out(user)


def _coerce_user_role_for_approval(v) -> UserRole:
    if isinstance(v, UserRole):
        return v
    if isinstance(v, str):
        try:
            return UserRole(v)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid role for approval")
    raise HTTPException(status_code=400, detail="Invalid role for approval")


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

    # ✅ 소속팀은 승인에서 결정하지 않음: payload.departments 들어와도 기본 무시
    # (정책 바꾸고 싶으면 여기서만 처리하면 됨)

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


@router.get("/me", response_model=UserOut)
def get_current_user_info(
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """현재 로그인한 유저 정보를 조회합니다."""
    user = get_current_user(db, x_user_id)
    return _user_out(user)


@router.patch("/me", response_model=UserOut)
def update_current_user_info(
    payload: UserUpdate,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """현재 로그인한 유저 정보를 업데이트합니다."""
    user = get_current_user(db, x_user_id)

    if payload.name is not None:
        user.name = payload.name

    if payload.phone_number is not None:
        phone_digits = normalize_phone_digits(payload.phone_number)
        if len(phone_digits) < 10 or len(phone_digits) > 11:
            raise HTTPException(status_code=400, detail="INVALID_PHONE_NUMBER")
        
        # 전화번호가 변경되는 경우, 중복 체크
        if phone_digits != user.phone_number:
            exists_phone = db.query(User).filter(User.phone_number == phone_digits).first()
            if exists_phone:
                raise HTTPException(status_code=409, detail="Phone number already exists")
            user.phone_number = phone_digits
            user.phone_verified = False  # 전화번호 변경 시 인증 해제

    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.get("/me/contributions")
def get_user_contributions(
    year: str | None = None,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """유저의 년도별 기여도를 조회합니다."""
    user = get_current_user(db, x_user_id)

    # 모든 파일에서 해당 유저가 업로드한 파일들
    base_query = db.query(FileAsset).filter(FileAsset.uploaded_by_user_id == user.id)

    # 년도 필터링 (프로젝트의 year 기준)
    if year:
        projects = db.query(Project).filter(Project.year == year).all()
        project_ids = [p.id for p in projects]
        base_query = base_query.filter(FileAsset.project_id.in_(project_ids))

    all_files = base_query.all()

    # 프로젝트 정보 가져오기
    project_ids = list(set([f.project_id for f in all_files]))
    projects = db.query(Project).filter(Project.id.in_(project_ids)).all()
    project_by_id = {p.id: p for p in projects}

    # 년도별 통계
    year_stats: dict[str, dict[str, int]] = {}

    for file in all_files:
        project = project_by_id.get(file.project_id)
        if not project or not project.year:
            continue

        year_str = project.year
        if year_str not in year_stats:
            year_stats[year_str] = {
                "individual_items_count": 0,
                "content_files_count": 0,
                "total_files_count": 0,
            }

        year_stats[year_str]["total_files_count"] += 1

        file_type = (file.file_type or "").strip()
        if file_type == "개별문항":
            year_stats[year_str]["individual_items_count"] += 1
        elif file_type in ["문제지", "해설지", "정오표"]:
            year_stats[year_str]["content_files_count"] += 1

    # 응답 형식으로 변환
    result = []
    for year_str, stats in sorted(year_stats.items()):
        result.append(
            {
                "year": year_str,
                "individual_items_count": stats["individual_items_count"],
                "content_files_count": stats["content_files_count"],
                "total_files_count": stats["total_files_count"],
            }
        )

    return result


@router.post("/me/profile-image")
async def upload_profile_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """프로필 이미지를 업로드합니다."""
    from ..minio.client import minio_client, ensure_bucket, DEFAULT_BUCKET
    from minio.error import S3Error
    
    user = get_current_user(db, x_user_id)

    # 이미지 파일만 허용
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    original_name = file.filename or "profile.jpg"
    
    # 파일명에서 특수문자 제거 (안전한 파일명 생성)
    safe_name = "".join(c for c in original_name if c.isalnum() or c in (".", "-", "_"))[:100]
    if not safe_name or not safe_name.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")):
        # 확장자가 없으면 기본 확장자 추가
        safe_name = f"profile_{user.id}.jpg"
    
    # 프로필 이미지용 object_key 생성 (user_id 기준)
    object_key = f"profiles/user_{user.id}/{safe_name}"
    
    # 기존 프로필 이미지가 있다면 해당 경로의 모든 파일 삭제
    profile_prefix = f"profiles/user_{user.id}/"
    if user.profile_image_url:
        try:
            ensure_bucket(DEFAULT_BUCKET)
            objects = minio_client.list_objects(
                bucket_name=DEFAULT_BUCKET,
                prefix=profile_prefix,
                recursive=True
            )
            for obj in objects:
                try:
                    minio_client.remove_object(
                        bucket_name=DEFAULT_BUCKET,
                        object_name=obj.object_name
                    )
                except S3Error:
                    # 파일이 없거나 삭제 실패해도 계속 진행 (best-effort)
                    pass
        except (S3Error, RuntimeError):
            # 삭제 실패해도 새 파일 업로드는 진행 (best-effort)
            pass

    try:
        up = upload_stream(
            project_id=user.id,  # 임시로 user.id 사용
            fileobj=file.file,
            original_filename=original_name,
            content_type=file.content_type,
            object_key=object_key,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await file.close()

    # URL 생성 (presigned URL - 최대 7일)
    try:
        # MinIO/S3 presigned URL은 최대 7일까지만 지원하므로 7일로 제한
        profile_url = presign_download_url(
            object_key=up.object_key,
            expires_minutes=60 * 24 * 7,  # 7일
            download_filename=original_name,
            content_type=file.content_type,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # 유저 프로필 이미지 URL 업데이트
    user.profile_image_url = profile_url
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"profile_image_url": profile_url}


@router.get("/activities", response_model=list[ActivityItem])
def get_recent_activities(
    limit: int = 10,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """최근 활동 이력을 조회합니다."""
    user = get_current_user(db, x_user_id)

    # Activity 테이블에서 최근 활동 조회 (업로드/삭제 포함)
    recent_activities = (
        db.query(Activity)
        .join(Project, Activity.project_id == Project.id)
        .outerjoin(User, Activity.user_id == User.id)
        .order_by(Activity.created_at.desc())
        .limit(limit)
        .all()
    )

    activities = []
    for activity in recent_activities:
        project = activity.project
        activity_user = activity.user
        
        # type 변환: "file_upload" -> "file_upload", "file_delete" -> "file_delete"
        activity_type = activity.activity_type
        
        # timestamp를 UTC timezone-aware로 변환
        # activity.created_at이 naive datetime이면 UTC로 간주
        timestamp = activity.created_at
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        
        activities.append(
            ActivityItem(
                id=activity.id,
                type=activity_type,  # "file_upload" or "file_delete"
                timestamp=timestamp,
                user_name=activity_user.name if activity_user else None,
                project_name=project.name,
                project_year=project.year,
                file_name=activity.file_name,
                file_type=activity.file_type,
                description=activity.description or "",
            )
        )

    return activities


@router.delete("/me/profile-image", status_code=204)
def delete_profile_image(
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """프로필 이미지를 제거하고 기본 아바타로 되돌립니다."""
    from ..minio.client import minio_client, ensure_bucket, DEFAULT_BUCKET
    from minio.error import S3Error
    
    user = get_current_user(db, x_user_id)

    # 프로필 이미지 파일이 있다면 MinIO에서도 삭제
    profile_prefix = f"profiles/user_{user.id}/"
    try:
        ensure_bucket(DEFAULT_BUCKET)
        objects = minio_client.list_objects(
            bucket_name=DEFAULT_BUCKET,
            prefix=profile_prefix,
            recursive=True
        )
        for obj in objects:
            try:
                minio_client.remove_object(
                    bucket_name=DEFAULT_BUCKET,
                    object_name=obj.object_name
                )
            except S3Error:
                # 파일이 없거나 삭제 실패해도 계속 진행 (best-effort)
                pass
    except (S3Error, RuntimeError):
        # 삭제 실패해도 DB 업데이트는 진행 (best-effort)
        pass

    # 프로필 이미지 URL을 null로 설정
    user.profile_image_url = None
    db.add(user)
    db.commit()

    return

