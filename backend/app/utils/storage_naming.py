# app/utils/storage_naming.py
# English only comments

from __future__ import annotations

import re
import secrets
from datetime import datetime
from typing import Optional

INVALID_KEY_CHARS = r'[\x00-\x1f\x7f]'  # control chars


def sanitize_filename(name: str, max_len: int = 120) -> str:
    """
    Make a filename safe to embed into an S3/MinIO object key.
    - Remove path separators and control characters
    - Collapse whitespace
    - Keep dots, underscores, hyphens
    """
    name = name.strip()

    # Remove directory traversal and separators
    name = name.replace("\\", "_").replace("/", "_")

    # Remove control characters
    name = re.sub(INVALID_KEY_CHARS, "", name)

    # Collapse whitespace
    name = re.sub(r"\s+", " ", name).strip()

    # Avoid empty names
    if not name:
        name = "file"

    # Limit length to keep keys manageable
    if len(name) > max_len:
        # Preserve extension if present
        if "." in name:
            base, ext = name.rsplit(".", 1)
            base = base[: max_len - (len(ext) + 1)]
            name = f"{base}.{ext}"
        else:
            name = name[:max_len]

    return name


def slugify_loose(text: str, max_len: int = 80) -> str:
    """
    Loose slug: keep alnum + Korean + spaces -> hyphens.
    This is not strict ASCII slugging; it's user-friendly.
    """
    text = text.strip()
    text = re.sub(r"\s+", " ", text)

    # Replace spaces with hyphens
    text = text.replace(" ", "-")

    # Remove characters that are problematic in URLs/keys (keep Korean)
    text = re.sub(r"[^0-9A-Za-z가-힣\-_]", "", text)

    # Collapse repeated hyphens
    text = re.sub(r"-{2,}", "-", text).strip("-_")

    if not text:
        text = "project"

    return text[:max_len]


def build_project_slug(name: str, year: Optional[str], subject: Optional[str], project_id: int) -> str:
    """
    Build a stable, readable slug. Includes project_id to guarantee uniqueness.
    """
    parts = []
    if year:
        parts.append(slugify_loose(year, 10))
    if subject:
        parts.append(slugify_loose(subject, 30))
    parts.append(slugify_loose(name, 60))
    parts.append(str(project_id))  # ensure uniqueness

    slug = "-".join([p for p in parts if p])
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug[:180]


def build_file_key(project_slug: str, deadline: Optional[datetime], file_type: str, original_name: str) -> str:
    """
    Build a human-readable object key for MinIO.
    """
    safe_name = sanitize_filename(original_name)
    deadline_part = deadline.strftime("%Y%m%d") if deadline else "no-deadline"
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    shortid = secrets.token_hex(3)  # 6 hex chars
    ft = (file_type or "FILE").strip().upper()
    return f"projects/{project_slug}/deadline-{deadline_part}/files/{ft}/{ts}_{shortid}_{safe_name}"
