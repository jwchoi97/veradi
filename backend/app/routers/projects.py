from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List

from ..authz import ensure_can_create_project, ensure_can_manage_project
from ..mariadb.database import SessionLocal
from ..mariadb.models import FileAsset, Project, Review, UserRole
from ..minio.service import delete_project_files_by_keys
from ..utils.storage_derivation import derive_annotations_key, derive_baked_key
from ..schemas import ProjectCreate, ProjectOut, ProjectUpdate
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

    # ✅ Policy:
    # - ADMIN: can create any subject
    # - LEAD: can create only their own department(=subject)
    ensure_can_create_project(user, payload.subject)

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
        target_individual_items_count=payload.target_individual_items_count or 20,
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

    # ✅ Policy:
    # - ADMIN: can delete any
    # - LEAD: can delete only projects with subject == their department
    ensure_can_manage_project(user, project)

    files = db.query(FileAsset).filter(FileAsset.project_id == project_id).all()
    file_ids = [f.id for f in files]
    reviews = db.query(Review).filter(Review.file_asset_id.in_(file_ids)).all() if file_ids else []
    review_by_file_id = {r.file_asset_id: r for r in reviews}

    # Delete original objects + derived sidecars for each project file.
    object_keys: list[str] = []
    for f in files:
        k = (f.file_key or "").strip()
        if not k:
            continue
        object_keys.append(k)
        object_keys.append(derive_baked_key(k))
        object_keys.append(derive_annotations_key(k))
        # Backward-compat: older builds stored annotations under review namespace.
        r = review_by_file_id.get(f.id)
        if r:
            object_keys.append(f"reviews/{r.id}/annotations.json")

    # Dedup while preserving order
    seen: set[str] = set()
    deduped: list[str] = []
    for k in object_keys:
        k = (k or "").strip()
        if not k or k in seen:
            continue
        seen.add(k)
        deduped.append(k)

    if deduped:
        try:
            delete_project_files_by_keys(
                project_id=project_id,
                object_keys=deduped,
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
        # subject is Enum now, so string trim/length doesn't apply.
        # During migration there might be NULL rows; filter them out.
        .filter(Project.subject.isnot(None))
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
    if project.subject is None:
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

    # ✅ Update also follows same management policy
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

    if payload.target_individual_items_count is not None:
        project.target_individual_items_count = payload.target_individual_items_count

    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}/individual-items/count")
def get_project_individual_items_count(
    project_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """프로젝트별 개별 문항 개수를 반환합니다."""
    user = get_current_user(db, x_user_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ensure_can_manage_project(user, project)

    # file_type이 "개별문항"인 파일들의 개수를 세기
    count = (
        db.query(func.count(FileAsset.id))
        .filter(
            FileAsset.project_id == project_id,
            FileAsset.file_type == "개별문항"
        )
        .scalar()
    )

    return {"project_id": project_id, "individual_items_count": count or 0}

