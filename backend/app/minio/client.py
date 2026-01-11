# minio/client.py
import os
from minio import Minio

def _env_bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "y", "on")

def _normalize_endpoint(raw: str | None) -> str:
    if not raw:
        raise ValueError("MINIO_ENDPOINT is required (host[:port] only)")
    raw = raw.strip()
    raw = raw.replace("https://", "").replace("http://", "")
    raw = raw.split("/", 1)[0]
    raw = raw.split("?", 1)[0]
    return raw

#MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT")
MINIO_ENDPOINT = _normalize_endpoint(os.getenv("MINIO_ENDPOINT"))
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY")
MINIO_SECURE = _env_bool("MINIO_SECURE")

DEFAULT_BUCKET = os.getenv("MINIO_BUCKET")

minio_client = Minio(
    MINIO_ENDPOINT,
    access_key=MINIO_ACCESS_KEY,
    secret_key=MINIO_SECRET_KEY,
    secure=MINIO_SECURE,
)

def ensure_bucket(bucket_name: str = DEFAULT_BUCKET) -> None:
    if not bucket_name:
        raise ValueError("Bucket name is empty. Set MINIO_BUCKET.")
    if not minio_client.bucket_exists(bucket_name):
        minio_client.make_bucket(bucket_name)
