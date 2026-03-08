# minio/client.py - S3 backend (boto3)
import os
import boto3
from botocore.exceptions import ClientError

AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "ap-northeast-2")
DEFAULT_BUCKET = os.getenv("S3_BUCKET", "veradi-files")

_s3_client = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
)

_ensured_buckets: set[str] = set()


def ensure_bucket(bucket_name: str = DEFAULT_BUCKET) -> None:
    """Verify bucket exists. S3 buckets are created via Console/CLI, not by the app."""
    if not bucket_name:
        raise ValueError("Bucket name is empty. Set S3_BUCKET.")
    if bucket_name in _ensured_buckets:
        return
    try:
        _s3_client.head_bucket(Bucket=bucket_name)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code == "404":
            raise ValueError(
                f"S3 bucket '{bucket_name}' does not exist. Create it in AWS Console first."
            ) from e
        raise
    _ensured_buckets.add(bucket_name)


class _S3ResponseAdapter:
    """Adapter so boto3 get_object Body behaves like S3 response (read, close, release_conn)."""

    def __init__(self, body):
        self._body = body

    def read(self, size=None):
        return self._body.read(size)

    def close(self):
        self._body.close()

    def release_conn(self):
        pass  # boto3 manages connections


class _MinIOCompatClient:
    """Adapter exposing S3-compatible interface for drop-in replacement in routers."""

    def __init__(self, s3_client):
        self._client = s3_client

    def list_objects(self, bucket_name: str, prefix: str, recursive: bool = True):
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            for obj in page.get("Contents", []):
                yield type("Obj", (), {"object_name": obj["Key"]})()

    def remove_object(self, bucket_name: str, object_name: str):
        self._client.delete_object(Bucket=bucket_name, Key=object_name)

    def stat_object(self, bucket_name: str, object_name: str):
        r = self._client.head_object(Bucket=bucket_name, Key=object_name)
        return type("Stat", (), {"size": r.get("ContentLength", 0)})()

    def get_object(
        self,
        bucket_name: str,
        object_name: str,
        offset: int = 0,
        length: int | None = None,
    ):
        params = {"Bucket": bucket_name, "Key": object_name}
        if offset or length is not None:
            end = (offset + length - 1) if length else ""
            params["Range"] = f"bytes={offset}-{end}" if end else f"bytes={offset}-"
        r = self._client.get_object(**params)
        return _S3ResponseAdapter(r["Body"])


# Raw boto3 client for service.py (put_object, presign, etc.)
s3_client = _s3_client

# Adapter with S3-compatible interface for auth.py, reviews.py
minio_client = _MinIOCompatClient(_s3_client)
