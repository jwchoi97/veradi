# routers/files.py
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from sqlalchemy.orm import Session

from ..mariadb.database import SessionLocal
from ..mariadb.models import Project, FileAsset

from ..minio.service import upload_stream, presign_download_url, delete_object

router = APIRouter(prefix="/projects", tags=["files"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/{project_id}/files")
async def upload_project_file(
    project_id: int,
    file: UploadFile = File(...),
    file_type: str = Form(...),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        up = upload_stream(
            project_id=project_id,
            fileobj=file.file,
            original_filename=file.filename,
            content_type=file.content_type,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await file.close()

    # NOTE: file_key now stores MinIO object key
    asset = FileAsset(
        project_id=project_id,
        file_key=up.object_key,
        original_name=file.filename,
        mime_type=file.content_type,
        size=None,  # Optional: set if you compute it
        file_type=file_type,  # <- save to DB
        # bucket=up.bucket,  # If your model has it
        # etag=up.etag,      # If your model has it
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)

    return {"id": asset.id, "file_key": asset.file_key}

@router.get("/{project_id}/files")
def list_project_files(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return (
        db.query(FileAsset)
        .filter(FileAsset.project_id == project_id)
        .order_by(FileAsset.id.desc())
        .all()
    )

# ✅ Presigned download URL
@router.get("/{project_id}/files/{file_id}/download")
def download_project_file(project_id: int, file_id: int, db: Session = Depends(get_db)):
    asset = (
        db.query(FileAsset)
        .filter(FileAsset.id == file_id, FileAsset.project_id == project_id)
        .first()
    )
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        url = presign_download_url(object_key=asset.file_key, expires_minutes=10)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"id": asset.id, "url": url, "expires_minutes": 10}

# 🔥 파일 삭제 (MinIO → DB)
@router.delete("/{project_id}/files/{file_id}", status_code=204)
def delete_project_file(
    project_id: int,
    file_id: int,
    db: Session = Depends(get_db),
):
    asset = (
        db.query(FileAsset)
        .filter(FileAsset.id == file_id, FileAsset.project_id == project_id)
        .first()
    )
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        delete_object(object_key=asset.file_key)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    db.delete(asset)
    db.commit()
    return
