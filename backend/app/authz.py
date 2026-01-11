# FILE: backend/app/authz.py

from __future__ import annotations

from fastapi import HTTPException
from .mariadb.models import User, UserRole, Department, Project


def ensure_admin(user: User) -> None:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")


def ensure_can_create_project(user: User, owner_department: Department | None) -> None:
    if user.role == UserRole.ADMIN:
        return
    if user.role != UserRole.LEAD:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    if owner_department is None:
        raise HTTPException(status_code=400, detail="owner_department is required")

    if owner_department not in user.departments_set():
        raise HTTPException(status_code=403, detail="다른 팀(과목) 프로젝트는 생성할 수 없습니다.")


def ensure_can_manage_project(user: User, project: Project) -> None:
    if user.role == UserRole.ADMIN:
        return
    if user.role != UserRole.LEAD:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    owner = project.owner_department
    if owner is None:
        raise HTTPException(status_code=403, detail="프로젝트 소속(팀) 정보가 없어 관리할 수 없습니다.")

    if owner not in user.departments_set():
        raise HTTPException(status_code=403, detail="다른 팀(과목) 프로젝트는 관리할 수 없습니다.")
