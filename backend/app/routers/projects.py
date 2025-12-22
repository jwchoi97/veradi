# routers/projects.py
from fastapi import APIRouter, Depends, status, Response, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..mariadb.database import SessionLocal
from ..mariadb.models import Project, FileAsset
from ..minio.service import delete_project_files_by_keys
from ..schemas import ProjectCreate, ProjectUpdate, ProjectOut, ProjectListOut  # 🔹 여기서 import

router = APIRouter(prefix="/projects", tags=["projects"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("", response_model=ProjectOut, status_code=201)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    item = Project(
        name=payload.name,
        subject=payload.subject,
        description=payload.description,
        deadline=payload.deadline,
        status=payload.status or "OPEN",
        year=payload.year,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item

@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    # 1) Project exists?
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 2) Fetch all files for that project (DB is the source of truth)
    files = db.query(FileAsset).filter(FileAsset.project_id == project_id).all()
    object_keys = [f.file_key for f in files if f.file_key]

    # 3) Delete objects from MinIO first (avoid orphan objects)
    if object_keys:
        try:
            delete_project_files_by_keys(
                project_id=project_id,
                object_keys=object_keys,
                ignore_missing=True,  # best-effort
            )
        except RuntimeError as e:
            # Stop here so we don't delete DB rows while objects remain
            raise HTTPException(status_code=500, detail=str(e))

    # 4) Delete DB rows (files -> project)
    for f in files:
        db.delete(f)
    db.delete(project)

    db.commit()
    return

@router.get("", response_model=List[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.id.desc()).all()


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
