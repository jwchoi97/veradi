from __future__ import annotations

"""
Derive "sidecar" object keys that live alongside the original PDF.

Goal:
- Keep original PDF at `file_asset.file_key`
- Store baked/annotated PDF next to it by postfixing the basename: `__baked.pdf`
- Store annotation JSON next to it by postfixing the basename: `__ann.json`
"""


BAKED_POSTFIX = "__baked"
ANNOTATIONS_POSTFIX = "__ann"
USER_SUFFIX_PREFIX = "_u"


def derive_baked_key(original_key: str, *, postfix: str = BAKED_POSTFIX, user_id: int | None = None) -> str:
    """
    Example:
      "foo/bar/name.pdf" -> "foo/bar/name__baked.pdf"
      with user_id=5 -> "foo/bar/name__baked_u5.pdf"
    """
    key = (original_key or "").strip()
    if not key:
        suffix = f"{USER_SUFFIX_PREFIX}{user_id}" if user_id is not None else ""
        return f"baked{postfix}{suffix}.pdf"

    dir_part, _, filename = key.rpartition("/")
    base = filename
    if base.lower().endswith(".pdf"):
        base = base[: -len(".pdf")]
    suffix = f"{USER_SUFFIX_PREFIX}{user_id}" if user_id is not None else ""
    baked_name = f"{base}{postfix}{suffix}.pdf"
    return f"{dir_part}/{baked_name}" if dir_part else baked_name


def derive_annotations_key(original_key: str, *, postfix: str = ANNOTATIONS_POSTFIX, user_id: int | None = None) -> str:
    """
    Example:
      "foo/bar/name.pdf" -> "foo/bar/name__ann.json"
      with user_id=5 -> "foo/bar/name__ann_u5.json"
    """
    key = (original_key or "").strip()
    if not key:
        suffix = f"{USER_SUFFIX_PREFIX}{user_id}" if user_id is not None else ""
        return f"annotations{postfix}{suffix}.json"

    dir_part, _, filename = key.rpartition("/")
    base = filename
    if "." in base:
        base = base.rsplit(".", 1)[0]
    suffix = f"{USER_SUFFIX_PREFIX}{user_id}" if user_id is not None else ""
    ann_name = f"{base}{postfix}{suffix}.json"
    return f"{dir_part}/{ann_name}" if dir_part else ann_name

