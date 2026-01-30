# minio/service.py
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Optional, Iterable
from urllib.parse import quote
import uuid
import json
import io

from minio.error import S3Error

from .client import minio_client, ensure_bucket, DEFAULT_BUCKET


@dataclass(frozen=True)
class UploadResult:
    bucket: str
    object_key: str
    etag: Optional[str]
    version_id: Optional[str]


def build_object_key(project_id: int, original_filename: str) -> str:
    """
    Default legacy key convention:
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
    object_key: Optional[str] = None,
) -> UploadResult:
    """
    Upload a file-like stream to MinIO.

    - fileobj: should be a readable binary stream (e.g., UploadFile.file)
    - Uses multipart upload for unknown length streams (length=-1)
    - If object_key is provided, it will be used as-is (recommended).
      Otherwise, falls back to build_object_key() legacy strategy.
    """
    ensure_bucket(bucket)

    final_key = object_key or build_object_key(project_id, original_filename)

    try:
        res = minio_client.put_object(
            bucket_name=bucket,
            object_name=final_key,
            data=fileobj,
            length=-1,
            part_size=part_size,
            content_type=content_type or "application/octet-stream",
        )
    except S3Error as e:
        raise RuntimeError(f"MinIO upload failed: {e.code} {e.message}") from e

    return UploadResult(
        bucket=bucket,
        object_key=final_key,
        etag=getattr(res, "etag", None),
        version_id=getattr(res, "version_id", None),
    )


def presign_download_url(
    *,
    object_key: str,
    bucket: str = DEFAULT_BUCKET,
    expires_minutes: int = 10,
    download_filename: Optional[str] = None,
    content_type: Optional[str] = None,
    inline: bool = False,
) -> str:
    """
    Create a short-lived download URL (client downloads directly from MinIO).

    If download_filename is provided, the browser will save the file using that name
    (Content-Disposition override via response headers).
    
    If inline=True, sets Content-Disposition to inline (for PDF viewers).
    """
    ensure_bucket(bucket)
    try:
        response_headers = {}

        if download_filename:
            # RFC 5987 filename* (UTF-8), safe for Korean/space chars
            quoted = quote(download_filename)
            disposition = "inline" if inline else "attachment"
            response_headers["response-content-disposition"] = (
                f"{disposition}; filename*=UTF-8''{quoted}"
            )

        if content_type:
            response_headers["response-content-type"] = content_type

        return minio_client.presigned_get_object(
            bucket_name=bucket,
            object_name=object_key,
            expires=timedelta(minutes=expires_minutes),
            response_headers=response_headers if response_headers else None,
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
    return delete_objects(object_keys=object_keys, bucket=bucket, ignore_missing=ignore_missing)


def upload_json(
    *,
    object_key: str,
    data: dict,
    bucket: str = DEFAULT_BUCKET,
) -> UploadResult:
    """
    Upload JSON data to MinIO as a JSON file.
    """
    ensure_bucket(bucket)
    json_bytes = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    fileobj = io.BytesIO(json_bytes)
    
    try:
        result = minio_client.put_object(
            bucket_name=bucket,
            object_name=object_key,
            data=fileobj,
            length=len(json_bytes),
            content_type="application/json",
        )
        return UploadResult(
            bucket=bucket,
            object_key=object_key,
            etag=result.etag,
            version_id=result.version_id,
        )
    except S3Error as e:
        raise RuntimeError(f"MinIO upload JSON failed: {e.code} {e.message}") from e


def get_json(
    *,
    object_key: str,
    bucket: str = DEFAULT_BUCKET,
) -> dict:
    """
    Get JSON data from MinIO.
    Returns empty dict if object doesn't exist.
    """
    ensure_bucket(bucket)
    try:
        response = minio_client.get_object(bucket_name=bucket, object_name=object_key)
        data = json.loads(response.read().decode("utf-8"))
        response.close()
        response.release_conn()
        return data
    except S3Error as e:
        if e.code in ("NoSuchKey", "NoSuchObject"):
            return {}
        raise RuntimeError(f"MinIO get JSON failed: {e.code} {e.message}") from e

# # minio/service.py
# from __future__ import annotations

# from dataclasses import dataclass
# from datetime import timedelta
# from pathlib import Path
# from typing import Optional, Iterable
# import uuid

# from minio.error import S3Error

# from .client import minio_client, ensure_bucket, DEFAULT_BUCKET


# @dataclass(frozen=True)
# class UploadResult:
#     bucket: str
#     object_key: str
#     etag: Optional[str]
#     version_id: Optional[str]


# def build_object_key(project_id: int, original_filename: str) -> str:
#     """
#     Default legacy key convention:
#       projects/{project_id}/{uuid}{ext}
#     """
#     ext = Path(original_filename).suffix
#     return f"projects/{project_id}/{uuid.uuid4().hex}{ext}"


# def upload_stream(
#     *,
#     project_id: int,
#     fileobj,
#     original_filename: str,
#     content_type: Optional[str],
#     bucket: str = DEFAULT_BUCKET,
#     part_size: int = 10 * 1024 * 1024,
#     object_key: Optional[str] = None,
# ) -> UploadResult:
#     """
#     Upload a file-like stream to MinIO.

#     - fileobj: should be a readable binary stream (e.g., UploadFile.file)
#     - Uses multipart upload for unknown length streams (length=-1)
#     - If object_key is provided, it will be used as-is (recommended).
#       Otherwise, falls back to build_object_key() legacy strategy.
#     """
#     ensure_bucket(bucket)

#     final_key = object_key or build_object_key(project_id, original_filename)

#     try:
#         res = minio_client.put_object(
#             bucket_name=bucket,
#             object_name=final_key,
#             data=fileobj,
#             length=-1,
#             part_size=part_size,
#             content_type=content_type or "application/octet-stream",
#         )
#     except S3Error as e:
#         raise RuntimeError(f"MinIO upload failed: {e.code} {e.message}") from e

#     return UploadResult(
#         bucket=bucket,
#         object_key=final_key,
#         etag=getattr(res, "etag", None),
#         version_id=getattr(res, "version_id", None),
#     )


# def presign_download_url(
#     *,
#     object_key: str,
#     bucket: str = DEFAULT_BUCKET,
#     expires_minutes: int = 10,
# ) -> str:
#     """
#     Create a short-lived download URL (client downloads directly from MinIO).
#     """
#     ensure_bucket(bucket)
#     try:
#         return minio_client.presigned_get_object(
#             bucket_name=bucket,
#             object_name=object_key,
#             expires=timedelta(minutes=expires_minutes),
#         )
#     except S3Error as e:
#         raise RuntimeError(f"MinIO presign failed: {e.code} {e.message}") from e


# def delete_object(
#     *,
#     object_key: str,
#     bucket: str = DEFAULT_BUCKET,
# ) -> None:
#     ensure_bucket(bucket)
#     try:
#         minio_client.remove_object(bucket_name=bucket, object_name=object_key)
#     except S3Error as e:
#         raise RuntimeError(f"MinIO delete failed: {e.code} {e.message}") from e


# def delete_project_prefix(
#     *,
#     project_id: int,
#     bucket: str = DEFAULT_BUCKET,
# ) -> int:
#     """
#     Delete all objects under projects/{project_id}/ prefix.
#     Returns number of deleted objects (best-effort).
#     """
#     ensure_bucket(bucket)
#     prefix = f"projects/{project_id}/"

#     deleted = 0
#     try:
#         objects = minio_client.list_objects(bucket_name=bucket, prefix=prefix, recursive=True)
#         for obj in objects:
#             minio_client.remove_object(bucket_name=bucket, object_name=obj.object_name)
#             deleted += 1
#     except S3Error as e:
#         raise RuntimeError(f"MinIO delete prefix failed: {e.code} {e.message}") from e

#     return deleted


# def delete_objects(
#     *,
#     object_keys: Iterable[str],
#     bucket: str = DEFAULT_BUCKET,
#     ignore_missing: bool = True,
# ) -> int:
#     """
#     Delete multiple objects by object keys.
#     Returns number of successfully deleted objects.

#     - ignore_missing=True: if an object does not exist, continue (best-effort)
#     """
#     ensure_bucket(bucket)

#     deleted = 0
#     for key in object_keys:
#         if not key:
#             continue
#         try:
#             minio_client.remove_object(bucket_name=bucket, object_name=key)
#             deleted += 1
#         except S3Error as e:
#             if ignore_missing and (e.code in ("NoSuchKey", "NoSuchObject")):
#                 continue
#             raise RuntimeError(f"MinIO bulk delete failed: {e.code} {e.message}") from e

#     return deleted


# def delete_project_files_by_keys(
#     *,
#     project_id: int,
#     object_keys: Iterable[str],
#     bucket: str = DEFAULT_BUCKET,
#     ignore_missing: bool = True,
# ) -> int:
#     """
#     Convenience wrapper for deleting all files that belong to a project,
#     based on object_key list fetched from DB.
#     """
#     return delete_objects(object_keys=object_keys, bucket=bucket, ignore_missing=ignore_missing)
