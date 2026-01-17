from __future__ import annotations

import os
from fastapi import HTTPException

from .mariadb.models import Project, User, UserRole, Department

_AUTHZ_DEBUG = os.getenv("AUTHZ_DEBUG", "").strip() == "1"


def ensure_admin(user: User) -> None:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")


def _normalize_department(v) -> Department | None:
    if isinstance(v, Department):
        return v
    if isinstance(v, str):
        try:
            return Department(v)
        except Exception:
            return None
    return None


def _allowed_departments(user: User) -> set[Department]:
    if user.role == UserRole.ADMIN:
        return set(Department)

    deps = user.departments_set()
    if deps:
        return deps

    if getattr(user, "department", None):
        return {user.department}

    return set()


def ensure_can_create_project(user: User, subject: Department) -> None:
    if user.role == UserRole.ADMIN:
        return

    if user.role != UserRole.LEAD:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    subj = _normalize_department(subject)
    allowed = _allowed_departments(user)

    if _AUTHZ_DEBUG:
        print(
            "[AUTHZ create]",
            "user_id=", getattr(user, "id", None),
            "role=", getattr(user, "role", None),
            "legacy=", getattr(user, "department", None),
            "allowed=", sorted([a.value for a in allowed]),
            "subject_in=", subject,
            "subject_norm=", subj,
        )

    if subj is None or subj not in allowed:
        raise HTTPException(status_code=403, detail="다른 과목 프로젝트는 생성할 수 없습니다.")


def ensure_can_manage_project(user: User, project: Project) -> None:
    if user.role == UserRole.ADMIN:
        return

    if user.role != UserRole.LEAD:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    subj_raw = getattr(project, "subject", None)
    subj = _normalize_department(subj_raw)
    allowed = _allowed_departments(user)

    if _AUTHZ_DEBUG:
        print(
            "[AUTHZ manage]",
            "user_id=", getattr(user, "id", None),
            "role=", getattr(user, "role", None),
            "legacy=", getattr(user, "department", None),
            "allowed=", sorted([a.value for a in allowed]),
            "project_id=", getattr(project, "id", None),
            "project_subject_raw=", subj_raw, type(subj_raw),
            "project_subject_norm=", subj,
        )

    if subj is None or subj not in allowed:
        raise HTTPException(status_code=403, detail="다른 과목 프로젝트는 관리할 수 없습니다.")
