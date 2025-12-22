# minio/service.py
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Optional
import uuid

from minio.error import S3Error
from typing import Iterable  # add at top with other imports

from .client import minio_client, ensure_bucket, DEFAULT_BUCKET

@dataclass(frozen=True)
class UploadResult:
    bucket: str
    object_key: str
    etag: Optional[str]
    version_id: Optional[str]

def build_object_key(project_id: int, original_filename: str) -> str:
    """
    Key convention:
      projects/{project_id}/{uuid}{ext}
    """
    ext = Path(original_filename).suffix
    return f"projects/{project_id}/{uuid.uuid4().hex}{ext}"

def upload_stream(
    *,
    project_id: int,
    fileobj,
    original_filename: str,
    content_type: Optional[str],
    bucket: str = DEFAULT_BUCKET,
    part_size: int = 10 * 1024 * 1024,
) -> UploadResult:
    """
    Upload a file-like stream to MinIO.

    - fileobj: should be a readable binary stream (e.g., UploadFile.file)
    - Uses multipart upload for unknown length streams (length=-1)
    """
    ensure_bucket(bucket)

    object_key = build_object_key(project_id, original_filename)

    try:
        res = minio_client.put_object(
            bucket_name=bucket,
            object_name=object_key,
            data=fileobj,
            length=-1,
            part_size=part_size,
            content_type=content_type or "application/octet-stream",
        )
    except S3Error as e:
        # Let caller map to HTTPException if needed
        raise RuntimeError(f"MinIO upload failed: {e.code} {e.message}") from e

    return UploadResult(
        bucket=bucket,
        object_key=object_key,
        etag=getattr(res, "etag", None),
        version_id=getattr(res, "version_id", None),
    )

def presign_download_url(
    *,
    object_key: str,
    bucket: str = DEFAULT_BUCKET,
    expires_minutes: int = 10,
) -> str:
    """
    Create a short-lived download URL (client downloads directly from MinIO).
    """
    ensure_bucket(bucket)
    try:
        return minio_client.presigned_get_object(
            bucket_name=bucket,
            object_name=object_key,
            expires=timedelta(minutes=expires_minutes),
        )
    except S3Error as e:
        raise RuntimeError(f"MinIO presign failed: {e.code} {e.message}") from e

def delete_object(
    *,
    object_key: str,
    bucket: str = DEFAULT_BUCKET,
) -> None:
    ensure_bucket(bucket)
    try:
        minio_client.remove_object(bucket_name=bucket, object_name=object_key)
    except S3Error as e:
        raise RuntimeError(f"MinIO delete failed: {e.code} {e.message}") from e

def delete_project_prefix(
    *,
    project_id: int,
    bucket: str = DEFAULT_BUCKET,
) -> int:
    """
    Delete all objects under projects/{project_id}/ prefix.
    Returns number of deleted objects (best-effort).
    """
    ensure_bucket(bucket)
    prefix = f"projects/{project_id}/"

    deleted = 0
    try:
        objects = minio_client.list_objects(bucket_name=bucket, prefix=prefix, recursive=True)
        for obj in objects:
            minio_client.remove_object(bucket_name=bucket, object_name=obj.object_name)
            deleted += 1
    except S3Error as e:
        raise RuntimeError(f"MinIO delete prefix failed: {e.code} {e.message}") from e

    return deleted

def delete_objects(
    *,
    object_keys: Iterable[str],
    bucket: str = DEFAULT_BUCKET,
    ignore_missing: bool = True,
) -> int:
    """
    Delete multiple objects by object keys.
    Returns number of successfully deleted objects.

    - ignore_missing=True: if an object does not exist, continue (best-effort)
    """
    ensure_bucket(bucket)

    deleted = 0
    for key in object_keys:
        if not key:
            continue
        try:
            minio_client.remove_object(bucket_name=bucket, object_name=key)
            deleted += 1
        except S3Error as e:
            # Common "not found" cases may vary by server; best-effort option:
            if ignore_missing and (e.code in ("NoSuchKey", "NoSuchObject")):
                continue
            raise RuntimeError(f"MinIO bulk delete failed: {e.code} {e.message}") from e

    return deleted


def delete_project_files_by_keys(
    *,
    project_id: int,
    object_keys: Iterable[str],
    bucket: str = DEFAULT_BUCKET,
    ignore_missing: bool = True,
) -> int:
    """
    Convenience wrapper for deleting all files that belong to a project,
    based on object_key list fetched from DB.
    """
    # Optional sanity check: keys should start with the project's prefix
    # prefix = f"projects/{project_id}/"
    # filtered = [k for k in object_keys if k and k.startswith(prefix)]
    # return delete_objects(object_keys=filtered, bucket=bucket, ignore_missing=ignore_missing)

    return delete_objects(object_keys=object_keys, bucket=bucket, ignore_missing=ignore_missing)
