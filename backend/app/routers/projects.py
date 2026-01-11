# FILE: backend/app/routers/projects.py

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List

from ..mariadb.database import SessionLocal
from ..mariadb.models import Project, FileAsset, User, UserRole
from ..minio.service import delete_project_files_by_keys
from ..schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectOut,
)
from ..authz import ensure_can_create_project, ensure_can_manage_project
from .auth import get_current_user

router = APIRouter(prefix="/projects", tags=["projects"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    user = get_current_user(db, x_user_id)

    # ADMIN/LEAD only + department constraint for LEAD
    ensure_can_create_project(user, payload.owner_department)

    item = Project(
        name=payload.name,
        subject=payload.subject,
        description=payload.description,
        category=payload.category or "기타",
        deadline=payload.deadline,
        deadline_1=payload.deadline_1,
        deadline_2=payload.deadline_2,
        deadline_final=payload.deadline_final,
        status=payload.status or "OPEN",
        year=payload.year,

        # ✅ NEW
        owner_department=payload.owner_department,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    user = get_current_user(db, x_user_id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # ADMIN: any / LEAD: only own departments
    ensure_can_manage_project(user, project)

    files = db.query(FileAsset).filter(FileAsset.project_id == project_id).all()
    object_keys = [f.file_key for f in files if f.file_key]

    if object_keys:
        try:
            delete_project_files_by_keys(
                project_id=project_id,
                object_keys=object_keys,
                ignore_missing=True,
            )
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=str(e))

    for f in files:
        db.delete(f)
    db.delete(project)

    db.commit()
    return


@router.get("", response_model=List[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    q = (
        db.query(Project)
        .filter(func.length(func.trim(Project.name)) > 0)
        .filter(func.length(func.trim(Project.subject)) > 0)
        .order_by(Project.id.desc())
    )
    return q.all()


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.name or not project.name.strip():
        raise HTTPException(status_code=500, detail="Project has invalid name in DB")
    if not project.subject or not project.subject.strip():
        raise HTTPException(status_code=500, detail="Project has invalid subject in DB")

    return project


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    user = get_current_user(db, x_user_id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # ✅ Update 권한도 동일하게 묶음 (생성/삭제와 같은 정책)
    # ADMIN: any / LEAD: only own departments
    ensure_can_manage_project(user, project)

    if payload.name is not None:
        project.name = payload.name
    if payload.subject is not None:
        project.subject = payload.subject
    if payload.description is not None:
        project.description = payload.description
    if payload.status is not None:
        project.status = payload.status
    if payload.year is not None:
        project.year = payload.year

    if payload.category is not None:
        project.category = payload.category

    if payload.deadline is not None:
        project.deadline = payload.deadline

    if payload.deadline_1 is not None:
        project.deadline_1 = payload.deadline_1
    if payload.deadline_2 is not None:
        project.deadline_2 = payload.deadline_2
    if payload.deadline_final is not None:
        project.deadline_final = payload.deadline_final

    # optional fix
    if payload.owner_department is not None:
        # only ADMIN can change ownership (safe guard)
        if user.role != UserRole.ADMIN:
            raise HTTPException(status_code=403, detail="Admin only")
        project.owner_department = payload.owner_department

    db.add(project)
    db.commit()
    db.refresh(project)
    return project

