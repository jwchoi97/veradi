from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import extract

from ..mariadb.models import (
    Department,
    FileAsset,
    LaborAlpha,
    LaborManagerAssignment,
    LaborTeamRate,
    LaborTeamRateHistory,
    Project,
    ReviewSession,
    User,
    UserDepartment,
    UserRole,
)
from ..schemas import (
    LaborAccessibleTeamsOut,
    LaborAlphaUpdateRequest,
    LaborDepartmentSummaryOut,
    LaborMyEstimateDepartmentItemOut,
    LaborMyEstimateOut,
    LaborManagerAssignmentOut,
    LaborManagerAssignmentRequest,
    LaborMemberSummaryOut,
    LaborTeamRateUpdateRequest,
)
from .auth import get_current_user, get_db, require_admin

router = APIRouter(prefix="/labor", tags=["labor"])

UPLOAD_UNIT_WON = 70000
REVIEW_UNIT_WON = 70000
MIN_HISTORY_YEAR = 2026
MIN_HISTORY_MONTH = 1
MIN_HISTORY_AT = datetime(2026, 1, 1)


def _default_year() -> str:
    return str(datetime.utcnow().year)


def _department_label_sort_key(dep: Department) -> str:
    return dep.value


def _user_departments(user: User) -> set[Department]:
    deps = set(user.departments_set())
    if user.department:
        deps.add(user.department)
    return deps


def _is_assigned_labor_manager(db: Session, lead_user_id: int, department: Department) -> bool:
    row = (
        db.query(LaborManagerAssignment.id)
        .filter(
            LaborManagerAssignment.lead_user_id == lead_user_id,
            LaborManagerAssignment.department == department,
            LaborManagerAssignment.is_active.is_(True),
        )
        .first()
    )
    return row is not None


def _ensure_department_labor_access(db: Session, user: User, department: Department) -> None:
    if user.role == UserRole.ADMIN:
        return
    if user.role != UserRole.LEAD:
        raise HTTPException(status_code=403, detail="Labor access is allowed for ADMIN/LEAD only")
    if not _is_assigned_labor_manager(db, user.id, department):
        raise HTTPException(status_code=403, detail="You are not assigned to manage this department labor")


def _current_period() -> tuple[int, int]:
    now = datetime.utcnow()
    return now.year, now.month


def _period_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _ensure_not_future_period(year: int, month: int) -> None:
    cy, cm = _current_period()
    if (year, month) > (cy, cm):
        raise HTTPException(status_code=400, detail="Future period is not allowed")


def _ensure_supported_period(year: int, month: int) -> None:
    if (year, month) < (MIN_HISTORY_YEAR, MIN_HISTORY_MONTH):
        raise HTTPException(status_code=400, detail="Only 2026-01 or later is supported")


def _ensure_current_period_for_update(year: int, month: int) -> None:
    cy, cm = _current_period()
    if (year, month) != (cy, cm):
        raise HTTPException(status_code=403, detail="Only current month can be modified")


def _get_or_default_team_rates(db: Session, department: Department, year: int, month: int) -> tuple[int, int]:
    row = (
        db.query(LaborTeamRateHistory)
        .filter(
            LaborTeamRateHistory.department == department,
            LaborTeamRateHistory.year == _period_key(year, month),
        )
        .first()
    )
    if row is None:
        return UPLOAD_UNIT_WON, REVIEW_UNIT_WON
    return int(row.upload_unit_amount), int(row.review_unit_amount)


@router.get("/teams", response_model=LaborAccessibleTeamsOut)
def get_accessible_labor_teams(
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    user = get_current_user(db, x_user_id)
    if user.role == UserRole.ADMIN:
        teams = sorted(list(Department), key=_department_label_sort_key)
        return LaborAccessibleTeamsOut(teams=teams)

    if user.role != UserRole.LEAD:
        raise HTTPException(status_code=403, detail="Labor access is allowed for ADMIN/LEAD only")

    rows = (
        db.query(LaborManagerAssignment.department)
        .filter(
            LaborManagerAssignment.lead_user_id == user.id,
            LaborManagerAssignment.is_active.is_(True),
        )
        .all()
    )
    assigned = sorted({row[0] for row in rows}, key=_department_label_sort_key)
    return LaborAccessibleTeamsOut(teams=assigned)


@router.get("/assignments", response_model=list[LaborManagerAssignmentOut])
def list_labor_assignments(
    department: Department | None = Query(default=None),
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    require_admin(db, x_user_id)
    query = (
        db.query(LaborManagerAssignment)
        .filter(LaborManagerAssignment.is_active.is_(True))
        .order_by(LaborManagerAssignment.department.asc(), LaborManagerAssignment.id.asc())
    )
    if department is not None:
        query = query.filter(LaborManagerAssignment.department == department)
    rows = query.all()
    out: list[LaborManagerAssignmentOut] = []
    for row in rows:
        lead = db.query(User).filter(User.id == row.lead_user_id).first()
        assigned_by = db.query(User).filter(User.id == row.assigned_by_user_id).first() if row.assigned_by_user_id else None
        out.append(
            LaborManagerAssignmentOut(
                id=row.id,
                department=row.department,
                lead_user_id=row.lead_user_id,
                lead_user_name=lead.name if lead and lead.name else (lead.username if lead else None),
                assigned_by_user_id=row.assigned_by_user_id,
                assigned_by_user_name=(
                    assigned_by.name if assigned_by and assigned_by.name else (assigned_by.username if assigned_by else None)
                ),
                is_active=row.is_active,
                created_at=row.created_at,
            )
        )
    return out


@router.post("/assignments", response_model=LaborManagerAssignmentOut, status_code=201)
def create_labor_assignment(
    payload: LaborManagerAssignmentRequest,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    admin = require_admin(db, x_user_id)

    lead = db.query(User).filter(User.id == payload.lead_user_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead user not found")
    if lead.role != UserRole.LEAD:
        raise HTTPException(status_code=400, detail="Only LEAD users can be assigned")

    if payload.department not in _user_departments(lead):
        raise HTTPException(status_code=400, detail="Lead user does not belong to the selected department")

    exists = (
        db.query(LaborManagerAssignment)
        .filter(
            LaborManagerAssignment.department == payload.department,
            LaborManagerAssignment.lead_user_id == payload.lead_user_id,
            LaborManagerAssignment.is_active.is_(True),
        )
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail="Assignment already exists")

    assignment = LaborManagerAssignment(
        department=payload.department,
        lead_user_id=payload.lead_user_id,
        assigned_by_user_id=admin.id,
        is_active=True,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return LaborManagerAssignmentOut(
        id=assignment.id,
        department=assignment.department,
        lead_user_id=assignment.lead_user_id,
        lead_user_name=lead.name or lead.username,
        assigned_by_user_id=assignment.assigned_by_user_id,
        assigned_by_user_name=admin.name or admin.username,
        is_active=assignment.is_active,
        created_at=assignment.created_at,
    )


@router.delete("/assignments", status_code=204)
def delete_labor_assignment(
    department: Department = Query(...),
    lead_user_id: int = Query(...),
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    require_admin(db, x_user_id)
    assignment = (
        db.query(LaborManagerAssignment)
        .filter(
            LaborManagerAssignment.department == department,
            LaborManagerAssignment.lead_user_id == lead_user_id,
            LaborManagerAssignment.is_active.is_(True),
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    assignment.is_active = False
    db.add(assignment)
    db.commit()
    return


def _build_upload_set_counts(
    db: Session,
    department: Department,
    year: int,
    month: int,
    member_ids: list[int],
) -> dict[int, int]:
    counts: dict[int, int] = {mid: 0 for mid in member_ids}
    if not member_ids:
        return counts

    rows = (
        db.query(
            FileAsset.uploaded_by_user_id,
            FileAsset.project_id,
            FileAsset.set_index,
            FileAsset.original_name,
        )
        .join(Project, FileAsset.project_id == Project.id)
        .filter(
            FileAsset.uploaded_by_user_id.in_(member_ids),
            FileAsset.file_type == "개별문항",
            FileAsset.set_index.isnot(None),
            Project.subject == department,
            FileAsset.created_at >= MIN_HISTORY_AT,
            extract("year", FileAsset.created_at) == year,
            extract("month", FileAsset.created_at) == month,
        )
        .all()
    )

    grouped: dict[tuple[int, int, int], set[str]] = defaultdict(set)
    for uploader_id, project_id, set_index, original_name in rows:
        if uploader_id is None or set_index is None:
            continue
        ext = ""
        if original_name and "." in original_name:
            ext = original_name.rsplit(".", 1)[-1].lower()
        grouped[(uploader_id, project_id, set_index)].add(ext)

    for (uploader_id, _project_id, _set_index), exts in grouped.items():
        if "pdf" in exts and "hwp" in exts:
            counts[uploader_id] = counts.get(uploader_id, 0) + 1
    return counts


def _build_content_review_counts(
    db: Session,
    department: Department,
    year: int,
    month: int,
    member_ids: list[int],
) -> dict[int, int]:
    counts: dict[int, int] = {mid: 0 for mid in member_ids}
    if not member_ids:
        return counts

    rows = (
        db.query(ReviewSession.user_id, ReviewSession.id)
        .join(FileAsset, ReviewSession.file_asset_id == FileAsset.id)
        .join(Project, FileAsset.project_id == Project.id)
        .filter(
            ReviewSession.user_id.in_(member_ids),
            ReviewSession.status == "approved",
            FileAsset.file_type != "개별문항",
            Project.subject == department,
            ReviewSession.completed_at.isnot(None),
            ReviewSession.completed_at >= MIN_HISTORY_AT,
            extract("year", ReviewSession.completed_at) == year,
            extract("month", ReviewSession.completed_at) == month,
        )
        .all()
    )
    for user_id, _session_id in rows:
        if user_id is None:
            continue
        counts[user_id] = counts.get(user_id, 0) + 1
    return counts


@router.get("/{department}/members", response_model=LaborDepartmentSummaryOut)
def get_department_labor_member_summary(
    department: Department,
    year: str | None = Query(default=None),
    month: int | None = Query(default=None, ge=1, le=12),
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    user = get_current_user(db, x_user_id)
    _ensure_department_labor_access(db, user, department)
    now = datetime.utcnow()
    target_year_str = (year or "").strip() or str(now.year)
    try:
        target_year_int = int(target_year_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid year")
    target_month = month if month is not None else now.month
    _ensure_supported_period(target_year_int, target_month)
    _ensure_not_future_period(target_year_int, target_month)
    period_key = _period_key(target_year_int, target_month)
    upload_unit_amount, review_unit_amount = _get_or_default_team_rates(db, department, target_year_int, target_month)

    members = (
        db.query(User)
        .join(UserDepartment, UserDepartment.user_id == User.id)
        .filter(
            UserDepartment.department == department,
            User.role == UserRole.MEMBER,
        )
        .order_by(User.name.asc(), User.id.asc())
        .all()
    )
    member_ids = [m.id for m in members]

    upload_counts = _build_upload_set_counts(db, department, target_year_int, target_month, member_ids)
    review_counts = _build_content_review_counts(db, department, target_year_int, target_month, member_ids)

    alpha_rows = []
    if member_ids:
        alpha_rows = (
            db.query(LaborAlpha)
            .filter(
                LaborAlpha.department == department,
                LaborAlpha.year == period_key,
                LaborAlpha.member_user_id.in_(member_ids),
            )
            .all()
        )
    alpha_map = {row.member_user_id: row.alpha_amount for row in alpha_rows}

    items: list[LaborMemberSummaryOut] = []
    for m in members:
        upload_set_count = int(upload_counts.get(m.id, 0))
        content_review_count = int(review_counts.get(m.id, 0))
        alpha_amount = int(alpha_map.get(m.id, 0))
        upload_amount = upload_set_count * upload_unit_amount
        review_amount = content_review_count * (review_unit_amount + alpha_amount)
        items.append(
            LaborMemberSummaryOut(
                member_user_id=m.id,
                member_name=m.name or m.username,
                member_username=m.username,
                upload_set_count=upload_set_count,
                content_review_approved_count=content_review_count,
                alpha_amount=alpha_amount,
                upload_amount=upload_amount,
                review_amount=review_amount,
                total_amount=upload_amount + review_amount,
            )
        )

    return LaborDepartmentSummaryOut(
        department=department,
        year=str(target_year_int),
        month=target_month,
        can_edit=(target_year_int, target_month) == _current_period(),
        upload_unit_amount=upload_unit_amount,
        review_unit_amount=review_unit_amount,
        members=items,
    )


@router.get("/me/estimate", response_model=LaborMyEstimateOut)
def get_my_current_month_labor_estimate(
    year: str | None = Query(default=None),
    month: int | None = Query(default=None, ge=1, le=12),
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """
    로그인 유저의 지정 월(기본: 이번달) 예상 인건비를 반환합니다.
    부서(과목)별 금액과 전체 합계를 함께 제공합니다.
    """
    user = get_current_user(db, x_user_id)
    now = datetime.utcnow()
    target_year_str = (year or "").strip() or str(now.year)
    try:
        target_year_int = int(target_year_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid year")
    target_month = month if month is not None else now.month
    _ensure_supported_period(target_year_int, target_month)
    _ensure_not_future_period(target_year_int, target_month)
    period_key = _period_key(target_year_int, target_month)

    departments = set(user.departments_set())
    if user.department:
        departments.add(user.department)

    items: list[LaborMyEstimateDepartmentItemOut] = []
    for department in sorted(departments, key=_department_label_sort_key):
        upload_unit_amount, review_unit_amount = _get_or_default_team_rates(
            db, department, target_year_int, target_month
        )

        upload_set_count = int(
            _build_upload_set_counts(
                db=db,
                department=department,
                year=target_year_int,
                month=target_month,
                member_ids=[user.id],
            ).get(user.id, 0)
        )
        content_review_count = int(
            _build_content_review_counts(
                db=db,
                department=department,
                year=target_year_int,
                month=target_month,
                member_ids=[user.id],
            ).get(user.id, 0)
        )

        alpha_row = (
            db.query(LaborAlpha)
            .filter(
                LaborAlpha.department == department,
                LaborAlpha.year == period_key,
                LaborAlpha.member_user_id == user.id,
            )
            .first()
        )
        alpha_amount = int(alpha_row.alpha_amount) if alpha_row is not None else 0

        upload_amount = upload_set_count * upload_unit_amount
        review_amount = content_review_count * (review_unit_amount + alpha_amount)
        items.append(
            LaborMyEstimateDepartmentItemOut(
                department=department,
                upload_set_count=upload_set_count,
                content_review_approved_count=content_review_count,
                alpha_amount=alpha_amount,
                upload_unit_amount=upload_unit_amount,
                review_unit_amount=review_unit_amount,
                upload_amount=upload_amount,
                review_amount=review_amount,
                total_amount=upload_amount + review_amount,
            )
        )

    total_amount = sum(item.total_amount for item in items)
    return LaborMyEstimateOut(
        year=str(target_year_int),
        month=target_month,
        departments=items,
        total_amount=total_amount,
    )


@router.put("/{department}/members/{member_id}/alpha", response_model=dict)
def update_member_alpha(
    department: Department,
    member_id: int,
    payload: LaborAlphaUpdateRequest,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    user = get_current_user(db, x_user_id)
    _ensure_department_labor_access(db, user, department)
    try:
        target_year_int = int(payload.year.strip())
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid year")
    _ensure_supported_period(target_year_int, payload.month)
    _ensure_not_future_period(target_year_int, payload.month)
    _ensure_current_period_for_update(target_year_int, payload.month)
    target_period_key = _period_key(target_year_int, payload.month)

    member = db.query(User).filter(User.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.role != UserRole.MEMBER:
        raise HTTPException(status_code=400, detail="Alpha can be set for MEMBER only")

    member_in_dept = (
        db.query(UserDepartment.id)
        .filter(
            UserDepartment.user_id == member_id,
            UserDepartment.department == department,
        )
        .first()
    )
    if member_in_dept is None:
        raise HTTPException(status_code=400, detail="Member does not belong to this department")

    row = (
        db.query(LaborAlpha)
        .filter(
            LaborAlpha.year == target_period_key,
            LaborAlpha.department == department,
            LaborAlpha.member_user_id == member_id,
        )
        .first()
    )
    if row is None:
        row = LaborAlpha(
            year=target_period_key,
            department=department,
            member_user_id=member_id,
            alpha_amount=payload.alpha_amount,
            updated_by_user_id=user.id,
        )
    else:
        row.alpha_amount = payload.alpha_amount
        row.updated_by_user_id = user.id
    db.add(row)
    db.commit()
    return {"ok": True}


@router.put("/{department}/rates", response_model=dict)
def upsert_department_team_rates(
    department: Department,
    payload: LaborTeamRateUpdateRequest,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    user = get_current_user(db, x_user_id)
    _ensure_department_labor_access(db, user, department)
    try:
        target_year_int = int(payload.year.strip())
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid year")
    _ensure_supported_period(target_year_int, payload.month)
    _ensure_not_future_period(target_year_int, payload.month)
    _ensure_current_period_for_update(target_year_int, payload.month)
    target_period_key = _period_key(target_year_int, payload.month)
    row = (
        db.query(LaborTeamRateHistory)
        .filter(
            LaborTeamRateHistory.department == department,
            LaborTeamRateHistory.year == target_period_key,
        )
        .first()
    )
    if row is None:
        row = LaborTeamRateHistory(
            year=target_period_key,
            department=department,
            upload_unit_amount=payload.upload_unit_amount,
            review_unit_amount=payload.review_unit_amount,
            updated_by_user_id=user.id,
        )
    else:
        row.upload_unit_amount = payload.upload_unit_amount
        row.review_unit_amount = payload.review_unit_amount
        row.updated_by_user_id = user.id
    db.add(row)
    db.commit()
    return {"ok": True}
