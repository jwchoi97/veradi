# minio/service.py - S3 backend (boto3)
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Iterable
from urllib.parse import quote
import uuid
import json
import io

from botocore.exceptions import ClientError

from .client import s3_client, minio_client, ensure_bucket, DEFAULT_BUCKET


def _client_error_code(e: ClientError) -> str:
    return e.response.get("Error", {}).get("Code", "")


def _client_error_message(e: ClientError) -> str:
    return e.response.get("Error", {}).get("Message", str(e))


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
    Upload a file-like stream to S3.

    - fileobj: should be a readable binary stream (e.g., UploadFile.file)
    - Uses multipart upload for unknown length streams
    - If object_key is provided, it will be used as-is (recommended).
      Otherwise, falls back to build_object_key() legacy strategy.
    """
    ensure_bucket(bucket)

    final_key = object_key or build_object_key(project_id, original_filename)

    try:
        extra_args = {"ContentType": content_type or "application/octet-stream"}
        s3_client.upload_fileobj(
            fileobj,
            bucket,
            final_key,
            ExtraArgs=extra_args,
        )
    except ClientError as e:
        raise RuntimeError(f"S3 upload failed: {_client_error_code(e)} {_client_error_message(e)}") from e

    return UploadResult(
        bucket=bucket,
        object_key=final_key,
        etag=None,
        version_id=None,
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
    Create a short-lived download URL (client downloads directly from S3).

    If download_filename is provided, the browser will save the file using that name
    (Content-Disposition override via response headers).

    If inline=True, sets Content-Disposition to inline (for PDF viewers).
    """
    ensure_bucket(bucket)
    try:
        params = {"Bucket": bucket, "Key": object_key}
        if download_filename:
            quoted = quote(download_filename)
            disposition = "inline" if inline else "attachment"
            params["ResponseContentDisposition"] = f"{disposition}; filename*=UTF-8''{quoted}"
        if content_type:
            params["ResponseContentType"] = content_type

        return s3_client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires_minutes * 60,
        )
    except ClientError as e:
        raise RuntimeError(f"S3 presign failed: {_client_error_code(e)} {_client_error_message(e)}") from e


def delete_object(
    *,
    object_key: str,
    bucket: str = DEFAULT_BUCKET,
) -> None:
    ensure_bucket(bucket)
    try:
        minio_client.remove_object(bucket_name=bucket, object_name=object_key)
    except ClientError as e:
        raise RuntimeError(f"S3 delete failed: {_client_error_code(e)} {_client_error_message(e)}") from e


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
    except ClientError as e:
        raise RuntimeError(f"S3 delete prefix failed: {_client_error_code(e)} {_client_error_message(e)}") from e

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
        except ClientError as e:
            if ignore_missing and _client_error_code(e) in ("NoSuchKey", "404"):
                continue
            raise RuntimeError(f"S3 bulk delete failed: {_client_error_code(e)} {_client_error_message(e)}") from e

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
    Upload JSON data to S3 as a JSON file.
    """
    ensure_bucket(bucket)
    json_bytes = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    fileobj = io.BytesIO(json_bytes)

    try:
        result = s3_client.put_object(
            Bucket=bucket,
            Key=object_key,
            Body=fileobj,
            ContentType="application/json",
        )
        return UploadResult(
            bucket=bucket,
            object_key=object_key,
            etag=result.get("ETag"),
            version_id=result.get("VersionId"),
        )
    except ClientError as e:
        raise RuntimeError(f"S3 upload JSON failed: {_client_error_code(e)} {_client_error_message(e)}") from e


def get_json(
    *,
    object_key: str,
    bucket: str = DEFAULT_BUCKET,
) -> dict:
    """
    Get JSON data from S3.
    Returns empty dict if object doesn't exist.
    """
    ensure_bucket(bucket)
    try:
        response = minio_client.get_object(bucket_name=bucket, object_name=object_key)
        data = json.loads(response.read().decode("utf-8"))
        response.close()
        response.release_conn()
        return data
    except ClientError as e:
        if _client_error_code(e) in ("NoSuchKey", "404"):
            return {}
        raise RuntimeError(f"S3 get JSON failed: {_client_error_code(e)} {_client_error_message(e)}") from e

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
#     Upload a file-like stream to S3.

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
#         raise RuntimeError(f"S3 upload failed: {e.code} {e.message}") from e

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
#     Create a short-lived download URL (client downloads directly from S3).
#     """
#     ensure_bucket(bucket)
#     try:
#         return minio_client.presigned_get_object(
#             bucket_name=bucket,
#             object_name=object_key,
#             expires=timedelta(minutes=expires_minutes),
#         )
#     except S3Error as e:
#         raise RuntimeError(f"S3 presign failed: {e.code} {e.message}") from e


# def delete_object(
#     *,
#     object_key: str,
#     bucket: str = DEFAULT_BUCKET,
# ) -> None:
#     ensure_bucket(bucket)
#     try:
#         minio_client.remove_object(bucket_name=bucket, object_name=object_key)
#     except S3Error as e:
#         raise RuntimeError(f"S3 delete failed: {e.code} {e.message}") from e


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
#         raise RuntimeError(f"S3 delete prefix failed: {e.code} {e.message}") from e

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
#             raise RuntimeError(f"S3 bulk delete failed: {e.code} {e.message}") from e

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
