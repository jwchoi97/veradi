from __future__ import annotations

import io
import re
import urllib.request
import zipfile
from typing import Dict, List, Tuple

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Body, Header
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..authz import ensure_can_manage_project
from ..mariadb.database import SessionLocal
from ..mariadb.models import Project, FileAsset, Activity, Review
from ..minio.service import upload_stream, presign_download_url, delete_objects
from ..utils.storage_derivation import derive_annotations_key, derive_baked_key
from ..utils.storage_naming import build_project_slug, build_file_key
from .auth import get_current_user

router = APIRouter(prefix="/projects", tags=["files"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _sanitize_path_segment(s: str) -> str:
    s = (s or "").strip()
    if not s:
        return "UNKNOWN"
    s = re.sub(r'[\\/:*?"<>|]+', "_", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:120] if len(s) > 120 else s


def _project_folder_base(p: Project) -> str:
    # No project_id prefix (user-facing)
    year = getattr(p, "year", None) or "-"
    subject = getattr(p, "subject", None) or "-"
    name = getattr(p, "name", None) or "PROJECT"
    base = f"{year}_{subject}_{name}"
    return _sanitize_path_segment(base)


def _download_presigned_bytes(url: str) -> bytes:
    # timeout: avoid hanging the API worker on slow/bad storage URL
    with urllib.request.urlopen(url, timeout=15) as resp:
        return resp.read()


def _build_unique_project_folder_map(projects: List[Project]) -> Dict[int, str]:
    """
    If multiple projects have identical folder base names, suffix them with:
      base, base (2), base (3), ...
    Rule: lower project.id gets lower suffix number (i.e., comes first).
    """
    groups: Dict[str, List[Project]] = {}
    for p in projects:
        base = _project_folder_base(p)
        groups.setdefault(base, []).append(p)

    folder_by_pid: Dict[int, str] = {}
    for base, plist in groups.items():
        plist_sorted = sorted(plist, key=lambda x: x.id)
        for idx, p in enumerate(plist_sorted):
            if idx == 0:
                folder_by_pid[p.id] = base
            else:
                folder_by_pid[p.id] = f"{base} ({idx + 1})"
    return folder_by_pid


@router.post("/files/bulk-download")
def bulk_download_files_zip(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    user = get_current_user(db, x_user_id)

    file_ids = payload.get("file_ids")
    if not isinstance(file_ids, list) or not file_ids:
        raise HTTPException(status_code=400, detail="file_ids is required")
    # keep UX: allow reasonable batches, but block abuse
    if len(file_ids) > 200:
        raise HTTPException(status_code=413, detail="Too many files (max 200)")

    assets: List[FileAsset] = db.query(FileAsset).filter(FileAsset.id.in_(file_ids)).all()
    if not assets:
        raise HTTPException(status_code=404, detail="No files found")

    assets_by_id = {a.id: a for a in assets}
    ordered_assets: List[FileAsset] = [assets_by_id[i] for i in file_ids if i in assets_by_id]
    if not ordered_assets:
        raise HTTPException(status_code=404, detail="No files found")

    project_ids = sorted({a.project_id for a in ordered_assets})
    projects: List[Project] = db.query(Project).filter(Project.id.in_(project_ids)).all()
    project_by_id = {p.id: p for p in projects}

    # ✅ AuthZ: must be able to manage each involved project
    for p in projects:
        ensure_can_manage_project(user, p)

    # Build unique folder names per project (dedup by base name, suffix by id order)
    folder_by_pid = _build_unique_project_folder_map(projects)

    buf = io.BytesIO()
    used_paths: Dict[str, int] = {}

    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for asset in ordered_assets:
            proj = project_by_id.get(asset.project_id)
            if proj:
                folder = folder_by_pid.get(proj.id) or _project_folder_base(proj)
            else:
                folder = "UNKNOWN_PROJECT"

            orig_name = asset.original_name or f"file_{asset.id}"
            safe_name = _sanitize_path_segment(orig_name)

            # Avoid losing extension on weird sanitize
            if "." not in safe_name and "." in orig_name:
                safe_name = safe_name + "." + orig_name.split(".")[-1]

            # Avoid collisions inside same folder
            zip_path = f"{folder}/{safe_name}"
            if zip_path in used_paths:
                used_paths[zip_path] += 1
                n = used_paths[zip_path]
                if "." in safe_name:
                    base, ext = safe_name.rsplit(".", 1)
                    zip_path = f"{folder}/{base} ({n}).{ext}"
                else:
                    zip_path = f"{folder}/{safe_name} ({n})"
            else:
                used_paths[zip_path] = 1

            try:
                url = presign_download_url(
                    object_key=asset.file_key,
                    expires_minutes=30,
                    download_filename=asset.original_name,
                    content_type=asset.mime_type,
                )
                data = _download_presigned_bytes(url)
            except RuntimeError as e:
                raise HTTPException(status_code=500, detail=str(e))
            except Exception:
                raise HTTPException(status_code=500, detail="Failed to download object from storage")

            zf.writestr(zip_path, data)

    buf.seek(0)
    headers = {
        "Content-Disposition": 'attachment; filename="files.zip"',
        "Content-Type": "application/zip",
    }
    return StreamingResponse(buf, media_type="application/zip", headers=headers)


@router.post("/{project_id}/files")
async def upload_project_file(
    project_id: int,
    file: UploadFile = File(...),
    file_type: str = Form(...),
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    user = get_current_user(db, x_user_id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ensure_can_manage_project(user, project)

    if not getattr(project, "slug", None):
        project.slug = build_project_slug(
            name=project.name,
            year=getattr(project, "year", None),
            subject=getattr(project, "subject", None),
            project_id=project.id,
        )
        db.add(project)
        db.commit()
        db.refresh(project)

    original_name = file.filename or "file"
    object_key = build_file_key(
        project_slug=project.slug,
        deadline=getattr(project, "deadline", None),
        file_type=file_type,
        original_name=original_name,
    )

    try:
        up = upload_stream(
            project_id=project_id,
            fileobj=file.file,
            original_filename=original_name,
            content_type=file.content_type,
            object_key=object_key,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await file.close()

    asset = FileAsset(
        project_id=project_id,
        file_key=up.object_key,
        original_name=original_name,
        mime_type=file.content_type,
        size=None,
        file_type=file_type,
        uploaded_by_user_id=user.id,  # 누가 업로드했는지 기록
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)

    # Activity 레코드 생성 (업로드)
    file_type_label = file_type or "파일"
    description = f"{original_name} ({file_type_label})"
    activity = Activity(
        activity_type="file_upload",
        project_id=project_id,
        file_asset_id=asset.id,
        user_id=user.id,
        file_name=original_name,
        file_type=file_type,
        description=description,
    )
    db.add(activity)
    db.commit()

    return {"id": asset.id, "file_key": asset.file_key, "original_name": asset.original_name}


@router.get("/{project_id}/files")
def list_project_files(
    project_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    user = get_current_user(db, x_user_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ensure_can_manage_project(user, project)

    return (
        db.query(FileAsset)
        .filter(FileAsset.project_id == project_id)
        .order_by(FileAsset.id.desc())
        .all()
    )


@router.get("/{project_id}/files/{file_id}/download")
def download_project_file(
    project_id: int,
    file_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    user = get_current_user(db, x_user_id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    ensure_can_manage_project(user, project)

    asset = (
        db.query(FileAsset)
        .filter(FileAsset.id == file_id, FileAsset.project_id == project_id)
        .first()
    )
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        url = presign_download_url(
            object_key=asset.file_key,
            expires_minutes=10,
            download_filename=asset.original_name,
            content_type=asset.mime_type,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"id": asset.id, "url": url, "expires_minutes": 10, "filename": asset.original_name}


@router.delete("/{project_id}/files/{file_id}", status_code=204)
def delete_project_file(
    project_id: int,
    file_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    user = get_current_user(db, x_user_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    ensure_can_manage_project(user, project)

    asset = (
        db.query(FileAsset)
        .filter(FileAsset.id == file_id, FileAsset.project_id == project_id)
        .first()
    )
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")

    # Look up review for legacy annotation cleanup (best-effort).
    review = db.query(Review).filter(Review.file_asset_id == asset.id).first()

    # Activity 레코드 생성 (삭제 전에 기록)
    file_type_label = asset.file_type or "파일"
    description = f"{asset.original_name} ({file_type_label})"
    activity = Activity(
        activity_type="file_delete",
        project_id=project_id,
        file_asset_id=asset.id,  # 삭제 전이므로 참조 가능
        user_id=user.id,
        file_name=asset.original_name,
        file_type=asset.file_type,
        description=description,
    )
    db.add(activity)

    try:
        # Delete original + derived sidecars (baked PDF + annotations JSON).
        # Best-effort: ignore missing objects (e.g. never baked / never annotated).
        keys = [
            asset.file_key,
            derive_baked_key(asset.file_key),
            derive_annotations_key(asset.file_key),
        ]
        # Backward-compat: older builds stored annotations under review namespace.
        if review:
            keys.append(f"reviews/{review.id}/annotations.json")

        # Dedup while preserving order
        seen: set[str] = set()
        deduped: list[str] = []
        for k in keys:
            k = (k or "").strip()
            if not k or k in seen:
                continue
            seen.add(k)
            deduped.append(k)

        delete_objects(object_keys=deduped, ignore_missing=True)
    except RuntimeError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    db.delete(asset)
    db.commit()
    return
