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


def derive_baked_key(original_key: str, *, postfix: str = BAKED_POSTFIX) -> str:
    """
    Example:
      "foo/bar/name.pdf" -> "foo/bar/name__baked.pdf"
    """
    key = (original_key or "").strip()
    if not key:
        return f"baked{postfix}.pdf"

    dir_part, _, filename = key.rpartition("/")
    base = filename
    if base.lower().endswith(".pdf"):
        base = base[: -len(".pdf")]
    baked_name = f"{base}{postfix}.pdf"
    return f"{dir_part}/{baked_name}" if dir_part else baked_name


def derive_annotations_key(original_key: str, *, postfix: str = ANNOTATIONS_POSTFIX) -> str:
    """
    Example:
      "foo/bar/name.pdf" -> "foo/bar/name__ann.json"
    """
    key = (original_key or "").strip()
    if not key:
        return f"annotations{postfix}.json"

    dir_part, _, filename = key.rpartition("/")
    base = filename
    if "." in base:
        base = base.rsplit(".", 1)[0]
    ann_name = f"{base}{postfix}.json"
    return f"{dir_part}/{ann_name}" if dir_part else ann_name

