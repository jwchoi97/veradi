from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Header, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from urllib.parse import quote
import io
import time

from ..mariadb.database import SessionLocal
from ..mariadb.models import FileAsset, Review, ReviewComment, User, Project
from ..schemas import ReviewOut, ReviewCommentOut, ReviewCommentCreate, ReviewCommentUpdate, ReviewStatusUpdate
from ..authz import ensure_can_manage_project
from .auth import get_current_user
from ..minio.service import upload_stream, presign_download_url, upload_json, get_json, DEFAULT_BUCKET
from ..minio.client import ensure_bucket, minio_client
from ..schemas import PDFAnnotation, PDFAnnotationsData, PDFAnnotationCreate
from ..utils.storage_derivation import derive_annotations_key, derive_baked_key
from minio.error import S3Error
import json
import uuid
import os
from functools import lru_cache

router = APIRouter(prefix="/reviews", tags=["reviews"])

_MISSING_SIZE = -1
_OBJECT_SIZE_CACHE: dict[str, tuple[int, float]] = {}
_OBJECT_SIZE_CACHE_TTL_SECONDS = 300  # 5 minutes
_OBJECT_MISS_TTL_SECONDS = 10  # short TTL for missing objects


def _probe_object_size_cached(object_key: str) -> int | None:
    """
    Best-effort object size probe with an in-process TTL cache.

    Why:
    - pdf.js can issue MANY Range requests; `stat_object` per request is expensive.
    - We only need size to serve Range responses correctly.

    Returns:
    - int size (>=0) when known
    - None when object doesn't exist or size can't be determined
    """
    key = (object_key or "").strip()
    if not key:
        return None

    now = time.time()
    cached = _OBJECT_SIZE_CACHE.get(key)
    if cached and cached[1] > now:
        size = cached[0]
        return None if size == _MISSING_SIZE else size

    try:
        stat = minio_client.stat_object(bucket_name=DEFAULT_BUCKET, object_name=key)
        size = int(getattr(stat, "size", 0) or 0)
        _OBJECT_SIZE_CACHE[key] = (size, now + _OBJECT_SIZE_CACHE_TTL_SECONDS)
        return size
    except S3Error as e:
        if e.code in ("NoSuchKey", "NoSuchObject"):
            _OBJECT_SIZE_CACHE[key] = (_MISSING_SIZE, now + _OBJECT_MISS_TTL_SECONDS)
            return None
        if e.code == "AccessDenied":
            # Treat as "unknown" (do not raise) to avoid breaking review UI.
            _OBJECT_SIZE_CACHE[key] = (_MISSING_SIZE, now + _OBJECT_MISS_TTL_SECONDS)
            return None
        raise


def _parse_color_to_rgb01(color: str | None) -> tuple[float, float, float] | None:
    """
    Accepts common formats seen in frontend payload:
    - "#RRGGBB"
    - "rgba(r,g,b,a)" / "rgb(r,g,b)"
    Returns (r,g,b) as floats in 0..1.
    """
    s = (color or "").strip()
    if not s:
        return None
    if s.startswith("#") and len(s) == 7:
        try:
            r = int(s[1:3], 16)
            g = int(s[3:5], 16)
            b = int(s[5:7], 16)
            return (r / 255.0, g / 255.0, b / 255.0)
        except Exception:
            return None
    if s.lower().startswith("rgb"):
        try:
            inner = s[s.find("(") + 1 : s.rfind(")")]
            parts = [p.strip() for p in inner.split(",")]
            if len(parts) < 3:
                return None
            r = float(parts[0])
            g = float(parts[1])
            b = float(parts[2])
            return (max(0.0, min(1.0, r / 255.0)), max(0.0, min(1.0, g / 255.0)), max(0.0, min(1.0, b / 255.0)))
        except Exception:
            return None
    return None


def _clamp01(v: float) -> float:
    try:
        x = float(v)
    except Exception:
        return 0.0
    return max(0.0, min(1.0, x))


def _read_object_bytes(object_key: str) -> bytes:
    ensure_bucket(DEFAULT_BUCKET)
    resp = minio_client.get_object(bucket_name=DEFAULT_BUCKET, object_name=object_key)
    try:
        return resp.read()
    finally:
        try:
            resp.close()
        except Exception:
            pass
        try:
            resp.release_conn()
        except Exception:
            pass


@lru_cache(maxsize=1)
def _get_bake_fontfile() -> str | None:
    """
    Return a TTF/OTF/TTC font file path to use for baking Unicode text.

    Why:
    - PyMuPDF base14 fonts (e.g. helv) do not contain Hangul glyphs.
    - If we bake with a non-Unicode font, text becomes '???' in the output PDF.

    Configuration:
    - Set env var `PDF_BAKE_FONT_FILE` to an absolute font path to override.
    """
    env = (os.getenv("PDF_BAKE_FONT_FILE") or "").strip()
    if env and os.path.isfile(env):
        return env

    # Common font locations (best-effort). We intentionally do not require these to exist.
    candidates = [
        # Windows (Korean)
        r"C:\Windows\Fonts\malgun.ttf",       # Malgun Gothic
        r"C:\Windows\Fonts\malgunsl.ttf",
        r"C:\Windows\Fonts\batang.ttc",
        # WSL (Windows fonts mounted under /mnt/c)
        "/mnt/c/Windows/Fonts/malgun.ttf",
        "/mnt/c/Windows/Fonts/malgunsl.ttf",
        "/mnt/c/Windows/Fonts/batang.ttc",
        # macOS
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
        "/Library/Fonts/AppleGothic.ttf",
        # Linux (Noto / common paths)
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJKkr-Regular.otf",
        "/usr/share/fonts/truetype/noto/NotoSansKR-Regular.otf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansKR-Regular.otf",
        "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
    ]
    for p in candidates:
        try:
            if p and os.path.isfile(p):
                return p
        except Exception:
            continue
    return None


def _register_bake_font(doc, *, fontfile: str | None) -> str:
    """
    Register a Unicode-capable font in the PDF document and return the fontname to use.
    Falls back to a built-in CJK font ('korea') if registration fails / no fontfile.
    """
    if not fontfile:
        # PyMuPDF bundles a CJK-capable font alias. This prevents Hangul from becoming "???" even
        # in minimal Linux containers with no system fonts installed.
        return "korea"

    # Pick a stable internal name. If it already exists, insert_font is typically idempotent.
    fontname = "bake_unicode"
    try:
        # PyMuPDF modern API
        doc.insert_font(fontname=fontname, fontfile=fontfile)
        return fontname
    except Exception:
        pass
    try:
        # Older PyMuPDF API
        doc.insertFont(fontname=fontname, fontfile=fontfile)
        return fontname
    except Exception:
        return "korea"


def _build_baked_pdf_bytes(*, original_pdf_bytes: bytes, annotations: list[dict]) -> bytes:
    """
    Bake Konva annotations into a PDF.

    Notes:
    - This uses normalized coordinates (v=2) when available.
    - It is intentionally best-effort: unsupported shapes are skipped rather than failing the request.
    """
    try:
        import fitz  # PyMuPDF
    except Exception as e:
        raise RuntimeError("PyMuPDF (fitz) is required for baking PDFs. Please install PyMuPDF.") from e

    doc = fitz.open(stream=original_pdf_bytes, filetype="pdf")
    # Register a font that can render Hangul/Unicode so baked text doesn't turn into "???".
    bake_fontfile = _get_bake_fontfile()
    bake_fontname = _register_bake_font(doc, fontfile=bake_fontfile)
    try:
        # PERF: Group by page so we only load each page once.
        by_page: dict[int, list[tuple[str, dict]]] = {}
        for ann in annotations:
            try:
                page_num = int(ann.get("page") or 1)
            except Exception:
                continue
            if page_num <= 0 or page_num > doc.page_count:
                continue
            try:
                payload = json.loads(ann.get("text") or "{}")
            except Exception:
                continue
            if not isinstance(payload, dict):
                continue
            typ = payload.get("type")
            if typ not in ("ink", "highlight", "freetext"):
                continue
            data = payload.get("data") or {}
            if not isinstance(data, dict):
                data = {}
            by_page.setdefault(page_num, []).append((typ, data))

        for page_num in sorted(by_page.keys()):
            page = doc.load_page(page_num - 1)
            rect = page.rect
            page_w = float(rect.width or 1.0)
            page_h = float(rect.height or 1.0)
            for typ, data in by_page.get(page_num, []):
                v = data.get("v")

            # ---------- ink ----------
            if typ == "ink":
                pts_norm = data.get("pointsNorm") if v == 2 else None
                if isinstance(pts_norm, list) and len(pts_norm) >= 4:
                    pts = []
                    for i in range(0, len(pts_norm) - 1, 2):
                        x = float(pts_norm[i] or 0.0) * page_w
                        y = float(pts_norm[i + 1] or 0.0) * page_h
                        pts.append(fitz.Point(x, y))
                    rgb = _parse_color_to_rgb01(data.get("color")) or (0.07, 0.09, 0.12)  # gray-900
                    width_norm = data.get("widthNorm")
                    if isinstance(width_norm, (int, float)):
                        width = max(0.25, float(width_norm) * page_h)
                    else:
                        # fallback: interpret width as "pt-ish"
                        width = max(0.6, float(data.get("width") or 2))
                    try:
                        page.draw_polyline(pts, color=rgb, width=width)
                    except Exception:
                        # last resort: draw segments
                        for a, b in zip(pts, pts[1:]):
                            try:
                                page.draw_line(a, b, color=rgb, width=width)
                            except Exception:
                                pass
                continue

            # ---------- highlight ----------
            if typ == "highlight":
                rgb = _parse_color_to_rgb01(data.get("color")) or (1.0, 0.94, 0.40)
                opacity = _clamp01(float(data.get("opacity") or 0.75))
                kind = data.get("kind")
                if v == 2 and kind == "stroke" and isinstance(data.get("pointsNorm"), list):
                    pts_norm = data.get("pointsNorm") or []
                    if len(pts_norm) >= 4:
                        pts = []
                        for i in range(0, len(pts_norm) - 1, 2):
                            x = float(pts_norm[i] or 0.0) * page_w
                            y = float(pts_norm[i + 1] or 0.0) * page_h
                            pts.append(fitz.Point(x, y))
                        width_norm = data.get("widthNorm")
                        if isinstance(width_norm, (int, float)):
                            width = max(0.5, float(width_norm) * page_h)
                        else:
                            width = max(1.0, float(data.get("width") or 12))
                        try:
                            # Draw highlight UNDER the existing page content so text stays crisp.
                            # (PDF rendering: later drawings overlay earlier content.)
                            page.draw_polyline(pts, color=rgb, width=width, stroke_opacity=opacity, overlay=False)
                        except TypeError:
                            try:
                                page.draw_polyline(pts, color=rgb, width=width, stroke_opacity=opacity)
                            except TypeError:
                                page.draw_polyline(pts, color=rgb, width=width)
                    continue
                # Multi-rect highlight (one drag => multiple segments)
                if isinstance(data.get("rectsNorm"), list):
                    try:
                        for rn in data.get("rectsNorm") or []:
                            if not isinstance(rn, dict):
                                continue
                            x = float(rn.get("x") or 0.0) * page_w
                            y = float(rn.get("y") or 0.0) * page_h
                            w = float(rn.get("width") or 0.0) * page_w
                            h = float(rn.get("height") or 0.0) * page_h
                            box = fitz.Rect(x, y, x + max(0.0, w), y + max(0.0, h))
                            try:
                                # Underlay highlight so it doesn't wash out text.
                                page.draw_rect(box, color=None, fill=rgb, fill_opacity=opacity, overlay=False)
                            except TypeError:
                                try:
                                    page.draw_rect(box, color=None, fill=rgb, fill_opacity=opacity)
                                except TypeError:
                                    page.draw_rect(box, color=None, fill=rgb)
                    except Exception:
                        pass
                    continue

                if isinstance(data.get("rectNorm"), dict):
                    rn = data.get("rectNorm") or {}
                    x = float(rn.get("x") or 0.0) * page_w
                    y = float(rn.get("y") or 0.0) * page_h
                    w = float(rn.get("width") or 0.0) * page_w
                    h = float(rn.get("height") or 0.0) * page_h
                    box = fitz.Rect(x, y, x + max(0.0, w), y + max(0.0, h))
                    try:
                        page.draw_rect(box, color=None, fill=rgb, fill_opacity=opacity, overlay=False)
                    except TypeError:
                        try:
                            page.draw_rect(box, color=None, fill=rgb, fill_opacity=opacity)
                        except TypeError:
                            page.draw_rect(box, color=None, fill=rgb)
                    continue
                continue

            # ---------- freetext ----------
            if typ == "freetext":
                rgb = _parse_color_to_rgb01(data.get("color")) or (0.07, 0.09, 0.12)
                font = bake_fontname or "helv"
                if v == 2 and data.get("kind") == "textbox":
                    x = float(data.get("xNorm") or 0.0) * page_w
                    y = float(data.get("yNorm") or 0.0) * page_h
                    w = float(data.get("widthNorm") or 0.25) * page_w
                    h = float(data.get("heightNorm") or 0.12) * page_h
                    fs = float(data.get("fontSizeNorm") or (16.0 / max(1.0, page_h))) * page_h
                    text = str(data.get("text") or "")
                    # richtext runs: fallback to plain concatenation if present
                    if not text and isinstance(data.get("runs"), list):
                        try:
                            text = "".join([str(r.get("text") or "") for r in (data.get("runs") or []) if isinstance(r, dict)])
                        except Exception:
                            text = ""
                    box = fitz.Rect(x, y, x + max(40.0, w), y + max(20.0, h))
                    try:
                        # Prefer passing `fontfile` directly to guarantee Unicode glyphs are embedded.
                        if bake_fontfile:
                            try:
                                page.insert_textbox(
                                    box,
                                    text,
                                    fontsize=max(6.0, fs),
                                    fontname=font,
                                    fontfile=bake_fontfile,
                                    color=rgb,
                                    align=0,
                                )
                            except TypeError:
                                page.insert_textbox(box, text, fontsize=max(6.0, fs), fontname=font, color=rgb, align=0)
                        else:
                            page.insert_textbox(box, text, fontsize=max(6.0, fs), fontname=font, color=rgb, align=0)
                    except Exception:
                        # fallback: insert at top-left
                        try:
                            if bake_fontfile:
                                try:
                                    page.insert_text(
                                        fitz.Point(x, y + max(6.0, fs)),
                                        text,
                                        fontsize=max(6.0, fs),
                                        fontname=font,
                                        fontfile=bake_fontfile,
                                        color=rgb,
                                    )
                                except TypeError:
                                    page.insert_text(
                                        fitz.Point(x, y + max(6.0, fs)),
                                        text,
                                        fontsize=max(6.0, fs),
                                        fontname=font,
                                        color=rgb,
                                    )
                            else:
                                page.insert_text(
                                    fitz.Point(x, y + max(6.0, fs)),
                                    text,
                                    fontsize=max(6.0, fs),
                                    fontname=font,
                                    color=rgb,
                                )
                        except Exception:
                            pass
                    continue

                # plain freetext (and richtext fallback)
                x = float(data.get("xNorm") or 0.0) * page_w if v == 2 else float(data.get("x") or 0.0)
                y = float(data.get("yNorm") or 0.0) * page_h if v == 2 else float(data.get("y") or 0.0)
                fs = float(data.get("fontSizeNorm") or (16.0 / max(1.0, page_h))) * page_h if v == 2 else float(data.get("fontSize") or 16.0)
                text = str(data.get("text") or "")
                if not text and isinstance(data.get("runs"), list):
                    try:
                        text = "".join([str(r.get("text") or "") for r in (data.get("runs") or []) if isinstance(r, dict)])
                    except Exception:
                        text = ""
                try:
                    if bake_fontfile:
                        try:
                            page.insert_text(
                                fitz.Point(x, y + max(6.0, fs)),
                                text,
                                fontsize=max(6.0, fs),
                                fontname=font,
                                fontfile=bake_fontfile,
                                color=rgb,
                            )
                        except TypeError:
                            page.insert_text(
                                fitz.Point(x, y + max(6.0, fs)),
                                text,
                                fontsize=max(6.0, fs),
                                fontname=font,
                                color=rgb,
                            )
                    else:
                        page.insert_text(fitz.Point(x, y + max(6.0, fs)), text, fontsize=max(6.0, fs), fontname=font, color=rgb)
                except Exception:
                    pass
                continue
            # unknown types are ignored

        baked = doc.tobytes()
        return baked
    finally:
        doc.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/files/{file_id}/view-url")
def get_file_view_url(
    file_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """파일 뷰어용 프록시 URL을 반환합니다 (CORS 문제 해결)."""
    user = get_current_user(db, x_user_id)

    file_asset = db.query(FileAsset).filter(FileAsset.id == file_id).first()
    if not file_asset:
        raise HTTPException(status_code=404, detail="File not found")

    project = file_asset.project
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 검토 권한 확인
    ensure_can_manage_project(user, project)

    # IMPORTANT:
    # Review viewer must render:
    # - original PDF as the base, and
    # - overlay annotations loaded from JSON.
    #
    # Baked PDF is intended for "read-only baked view" (e.g. from upload page status click),
    # and is served via /inline-url (presigned) or /proxy?variant=baked when explicitly requested.
    return {"url": f"/reviews/files/{file_id}/proxy?variant=original", "expires_minutes": 60}


@router.get("/files/{file_id}/inline-url")
def get_file_inline_url(
    file_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
    variant: str | None = Query(default=None, description="PDF variant: baked|original (default: prefer baked when exists)"),
):
    """
    새 탭/새 창에서 열 수 있는 presigned URL을 반환합니다.
    (네비게이션은 커스텀 헤더를 붙일 수 없으므로 /proxy 대신 사용)

    - baked PDF(__baked)가 있으면 baked를 우선 반환
    - 없으면 원본 PDF를 반환
    """
    user = get_current_user(db, x_user_id)

    file_asset = db.query(FileAsset).filter(FileAsset.id == file_id).first()
    if not file_asset:
        raise HTTPException(status_code=404, detail="File not found")

    project = file_asset.project
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ensure_can_manage_project(user, project)

    ensure_bucket(DEFAULT_BUCKET)

    preferred_key = file_asset.file_key
    baked_key = derive_baked_key(file_asset.file_key)
    v = (variant or "").strip().lower()
    if v == "original":
        preferred_key = file_asset.file_key
    elif v == "baked":
        preferred_key = baked_key
    else:
        # Default: prefer baked when it exists (read-only share UX),
        # but allow viewer to force `variant=original` to avoid double-annotating.
        try:
            minio_client.stat_object(bucket_name=DEFAULT_BUCKET, object_name=baked_key)
            preferred_key = baked_key
        except S3Error as e:
            # If it doesn't exist (or we can't probe it), fall back to original.
            if e.code not in ("NoSuchKey", "NoSuchObject", "AccessDenied"):
                raise

    try:
        url = presign_download_url(
            object_key=preferred_key,
            expires_minutes=60 * 12,
            download_filename=file_asset.original_name,
            content_type=file_asset.mime_type or "application/pdf",
            inline=True,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"url": url, "expires_minutes": 60 * 12}


@router.get("/files/{file_id}/proxy")
def proxy_file_for_viewer(
    file_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
    range_header: str | None = Header(default=None, alias="Range"),
    variant: str | None = Query(default=None, description="PDF variant: baked|original"),
    perf: int | None = Query(default=None, description="Perf debug: set to 1 to include timing headers/logs"),
):
    """파일을 프록시하여 CORS 문제를 해결합니다."""
    user = get_current_user(db, x_user_id)

    file_asset = db.query(FileAsset).filter(FileAsset.id == file_id).first()
    if not file_asset:
        raise HTTPException(status_code=404, detail="File not found")

    project = file_asset.project
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 검토 권한 확인
    ensure_can_manage_project(user, project)

    try:
        perf_enabled = perf == 1
        t_start = time.perf_counter() if perf_enabled else 0.0
        # Bucket existence should be ensured at startup / first use; cache prevents per-request MinIO calls.
        ensure_bucket(DEFAULT_BUCKET)

        # Decide which object to stream.
        # - `variant` is supplied by /view-url so we don't need to probe existence here.
        # - Still, we may need size for Range responses; use cached probe as fallback.
        preferred_key = file_asset.file_key
        if (variant or "").lower() == "baked":
            preferred_key = derive_baked_key(file_asset.file_key)

        # Avoid a MinIO stat call for every Range request:
        # Prefer DB-cached size when available; fall back to cached stat probe only when needed.
        total_size: int | None = None
        if preferred_key == file_asset.file_key:
            try:
                v = int(file_asset.size or 0)
                if v > 0:
                    total_size = v
            except Exception:
                total_size = None
        if total_size is None:
            total_size = _probe_object_size_cached(preferred_key)
        t_after_size = time.perf_counter() if perf_enabled else 0.0

        # Range 요청 지원 (pdf.js가 부분 다운로드를 사용함)
        # IMPORTANT: only support Range when object size is known.
        supports_range = isinstance(total_size, int) and total_size > 0
        start = 0
        end = (total_size - 1) if supports_range else 0
        is_partial = False

        if range_header and supports_range:
            # Example: "bytes=0-1023"
            try:
                unit, value = range_header.split("=", 1)
                unit = unit.strip().lower()
                if unit != "bytes":
                    raise ValueError("Unsupported range unit")
                value = value.strip()
                if "," in value:
                    # multi-range는 지원하지 않음
                    raise ValueError("Multiple ranges not supported")
                start_s, end_s = value.split("-", 1)
                if start_s:
                    start = int(start_s)
                if end_s:
                    end = int(end_s)
                else:
                    end = total_size - 1
                if start < 0 or end < start or end >= total_size:
                    raise ValueError("Invalid range")
                is_partial = True
            except Exception:
                raise HTTPException(status_code=416, detail="Invalid Range")

        length = (end - start) + 1 if is_partial else None
        t_before_get = time.perf_counter() if perf_enabled else 0.0
        response = minio_client.get_object(
            bucket_name=DEFAULT_BUCKET,
            object_name=preferred_key,
            offset=start if is_partial else 0,
            length=length,
        )
        t_after_get = time.perf_counter() if perf_enabled else 0.0
        
        # 파일 스트림을 반환
        def generate():
            try:
                while True:
                    # Bigger chunks significantly reduce Python/ASGI overhead and improve throughput.
                    chunk = response.read(512 * 1024)  # 512KB chunks
                    if not chunk:
                        break
                    yield chunk
            finally:
                response.close()
                response.release_conn()

        # Content-Type과 Content-Disposition 설정
        quoted_filename = quote(file_asset.original_name)
        headers = {
            "Content-Type": file_asset.mime_type or "application/pdf",
            "Content-Disposition": f"inline; filename*=UTF-8''{quoted_filename}",
            # Encourage browser/proxy caching for a short period to speed up re-opens.
            # This is a permissioned endpoint; keep it private and short-lived.
            "Cache-Control": "private, max-age=300",
            "Access-Control-Allow-Origin": "*",  # CORS 헤더 추가
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }

        if perf_enabled:
            try:
                headers["X-Proxy-Perf"] = "1"
                headers["X-Proxy-Variant"] = (variant or "original")
                headers["X-Proxy-IsPartial"] = "1" if is_partial else "0"
                if supports_range:
                    headers["X-Proxy-Range"] = f"{start}-{end}"
                    headers["X-Proxy-TotalSize"] = str(total_size or "")
                headers["X-Proxy-SizeProbeMs"] = str(int(max(0.0, (t_after_size - t_start) * 1000.0)))
                headers["X-Proxy-MinIOGetMs"] = str(int(max(0.0, (t_after_get - t_before_get) * 1000.0)))
            except Exception:
                pass
            try:
                print(
                    "[proxy-perf]",
                    {
                        "file_id": file_id,
                        "variant": (variant or "original"),
                        "is_partial": is_partial,
                        "range": f"{start}-{end}" if is_partial else None,
                        "size_probe_ms": int(max(0.0, (t_after_size - t_start) * 1000.0)),
                        "minio_get_ms": int(max(0.0, (t_after_get - t_before_get) * 1000.0)),
                        "total_size": int(total_size or 0) if supports_range else None,
                    },
                )
            except Exception:
                pass

        if supports_range:
            headers["Accept-Ranges"] = "bytes"

        if is_partial and supports_range:
            headers["Content-Range"] = f"bytes {start}-{end}/{total_size}"
            headers["Content-Length"] = str((end - start) + 1)
        elif supports_range:
            # Provide Content-Length for full responses as well. It helps pdf.js progress reporting
            # and can reduce buffering/guesswork in some environments.
            headers["Content-Length"] = str(total_size)

        return StreamingResponse(
            generate(),
            media_type=file_asset.mime_type or "application/pdf",
            headers=headers,
            status_code=206 if is_partial else 200,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to proxy file: {str(e)}")


@router.get("/files/{file_id}", response_model=ReviewOut)
def get_file_review(
    file_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """파일의 검토 정보를 조회합니다."""
    user = get_current_user(db, x_user_id)

    file_asset = db.query(FileAsset).filter(FileAsset.id == file_id).first()
    if not file_asset:
        raise HTTPException(status_code=404, detail="File not found")

    # 콘텐츠 파일만 검토 가능 (문제지, 해설지, 정오표)
    if file_asset.file_type not in ["문제지", "해설지", "정오표"]:
        raise HTTPException(status_code=400, detail="Only content files can be reviewed")

    review = db.query(Review).filter(Review.file_asset_id == file_id).first()
    
    if not review:
        # 검토가 없으면 생성
        review = Review(
            file_asset_id=file_id,
            status="pending",
        )
        db.add(review)
        db.commit()
        db.refresh(review)

    # 코멘트 조회
    comments = (
        db.query(ReviewComment)
        .filter(ReviewComment.review_id == review.id)
        .order_by(ReviewComment.created_at.asc())
        .all()
    )

    # 코멘트 작성자 정보 가져오기
    comment_out_list = []
    for comment in comments:
        author = db.query(User).filter(User.id == comment.author_id).first() if comment.author_id else None
        comment_out_list.append(
            ReviewCommentOut(
                id=comment.id,
                review_id=comment.review_id,
                author_id=comment.author_id,
                author_name=author.name if author else None,
                comment_type=comment.comment_type,
                text_content=comment.text_content,
                handwriting_image_url=comment.handwriting_image_url,
                page_number=comment.page_number,
                x_position=comment.x_position,
                y_position=comment.y_position,
                created_at=comment.created_at,
            )
        )

    reviewer = db.query(User).filter(User.id == review.reviewer_id).first() if review.reviewer_id else None
    file_asset = review.file_asset
    project = file_asset.project if file_asset else None

    return ReviewOut(
        id=review.id,
        file_asset_id=review.file_asset_id,
        project_id=file_asset.project_id if file_asset else None,
        file_name=file_asset.original_name if file_asset else None,
        project_name=project.name if project else None,
        project_year=project.year if project else None,
        status=review.status,
        reviewer_id=review.reviewer_id,
        reviewer_name=reviewer.name if reviewer else None,
        started_at=review.started_at,
        completed_at=review.completed_at,
        created_at=review.created_at,
        updated_at=review.updated_at,
        comments=comment_out_list,
    )


@router.get("/content-files", response_model=list[ReviewOut])
def list_content_files_for_review(
    project_id: int | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """검토 가능한 콘텐츠 파일 목록을 조회합니다. PDF 파일만 검토 대상입니다."""
    user = get_current_user(db, x_user_id)

    # 콘텐츠 파일만 조회 (문제지, 해설지, 정오표), PDF 확장자만 포함 (HWP 제외)
    query = (
        db.query(FileAsset)
        .filter(FileAsset.file_type.in_(["문제지", "해설지", "정오표"]))
        .filter(FileAsset.original_name.ilike("%.pdf"))
    )

    if project_id:
        query = query.filter(FileAsset.project_id == project_id)

    files = query.order_by(FileAsset.created_at.desc()).all()

    # 각 파일의 검토 정보 가져오기
    reviews = []
    for file_asset in files:
        review = db.query(Review).filter(Review.file_asset_id == file_asset.id).first()
        
        if status and review and review.status != status:
            continue
        if status == "pending" and not review:
            # pending 상태는 review가 없는 경우도 포함
            pass
        elif status and not review:
            continue

        if not review:
            review = Review(
                file_asset_id=file_asset.id,
                status="pending",
            )
            db.add(review)
            db.commit()
            db.refresh(review)

        reviewer = db.query(User).filter(User.id == review.reviewer_id).first() if review.reviewer_id else None
        file_asset = review.file_asset
        project = file_asset.project if file_asset else None

        reviews.append(
            ReviewOut(
                id=review.id,
                file_asset_id=review.file_asset_id,
                project_id=file_asset.project_id if file_asset else None,
                file_name=file_asset.original_name if file_asset else None,
                project_name=project.name if project else None,
                project_year=project.year if project else None,
                status=review.status,
                reviewer_id=review.reviewer_id,
                reviewer_name=reviewer.name if reviewer else None,
                started_at=review.started_at,
                completed_at=review.completed_at,
                created_at=review.created_at,
                updated_at=review.updated_at,
                comments=[],
            )
        )

    return reviews


@router.post("/files/{file_id}/start", response_model=ReviewOut)
def start_review(
    file_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """검토를 시작합니다."""
    user = get_current_user(db, x_user_id)

    file_asset = db.query(FileAsset).filter(FileAsset.id == file_id).first()
    if not file_asset:
        raise HTTPException(status_code=404, detail="File not found")

    review = db.query(Review).filter(Review.file_asset_id == file_id).first()
    
    if not review:
        review = Review(
            file_asset_id=file_id,
            status="in_progress",
            reviewer_id=user.id,
            started_at=datetime.utcnow(),
        )
    else:
        review.status = "in_progress"
        review.reviewer_id = user.id
        if not review.started_at:
            review.started_at = datetime.utcnow()
        review.updated_at = datetime.utcnow()

    db.add(review)
    db.commit()
    db.refresh(review)

    reviewer = db.query(User).filter(User.id == review.reviewer_id).first() if review.reviewer_id else None
    file_asset = review.file_asset
    project = file_asset.project if file_asset else None

    return ReviewOut(
        id=review.id,
        file_asset_id=review.file_asset_id,
        project_id=file_asset.project_id if file_asset else None,
        file_name=file_asset.original_name if file_asset else None,
        project_name=project.name if project else None,
        project_year=project.year if project else None,
        status=review.status,
        reviewer_id=review.reviewer_id,
        reviewer_name=reviewer.name if reviewer else None,
        started_at=review.started_at,
        completed_at=review.completed_at,
        created_at=review.created_at,
        updated_at=review.updated_at,
        comments=[],
    )


@router.post("/files/{file_id}/comments", response_model=ReviewCommentOut)
def add_review_comment(
    file_id: int,
    payload: ReviewCommentCreate,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """검토 코멘트를 추가합니다."""
    user = get_current_user(db, x_user_id)

    review = db.query(Review).filter(Review.file_asset_id == file_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    comment = ReviewComment(
        review_id=review.id,
        author_id=user.id,
        comment_type=payload.comment_type,
        text_content=payload.text_content,
        handwriting_image_url=payload.handwriting_image_url,
        page_number=payload.page_number,
        x_position=payload.x_position,
        y_position=payload.y_position,
    )

    db.add(comment)
    db.commit()
    db.refresh(comment)

    return ReviewCommentOut(
        id=comment.id,
        review_id=comment.review_id,
        author_id=comment.author_id,
        author_name=user.name,
        comment_type=comment.comment_type,
        text_content=comment.text_content,
        handwriting_image_url=comment.handwriting_image_url,
        page_number=comment.page_number,
        x_position=comment.x_position,
        y_position=comment.y_position,
        created_at=comment.created_at,
    )


@router.patch("/files/{file_id}/comments/{comment_id}", response_model=ReviewCommentOut)
def update_review_comment(
    file_id: int,
    comment_id: int,
    payload: ReviewCommentUpdate,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """작성자만 자신의 코멘트를 수정할 수 있습니다 (텍스트 코멘트만)."""
    user = get_current_user(db, x_user_id)

    review = db.query(Review).filter(Review.file_asset_id == file_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    comment = (
        db.query(ReviewComment)
        .filter(ReviewComment.review_id == review.id, ReviewComment.id == comment_id)
        .first()
    )
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    if comment.author_id != user.id:
        raise HTTPException(status_code=403, detail="Not allowed")

    if comment.comment_type != "text":
        raise HTTPException(status_code=400, detail="Only text comments can be edited")

    text = (payload.text_content or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text_content is required")

    comment.text_content = text
    db.add(comment)
    db.commit()
    db.refresh(comment)

    return ReviewCommentOut(
        id=comment.id,
        review_id=comment.review_id,
        author_id=comment.author_id,
        author_name=user.name,
        comment_type=comment.comment_type,
        text_content=comment.text_content,
        handwriting_image_url=comment.handwriting_image_url,
        page_number=comment.page_number,
        x_position=comment.x_position,
        y_position=comment.y_position,
        created_at=comment.created_at,
    )


@router.delete("/files/{file_id}/comments/{comment_id}", response_model=dict)
def delete_review_comment(
    file_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """작성자만 자신의 코멘트를 삭제할 수 있습니다."""
    user = get_current_user(db, x_user_id)

    review = db.query(Review).filter(Review.file_asset_id == file_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    comment = (
        db.query(ReviewComment)
        .filter(ReviewComment.review_id == review.id, ReviewComment.id == comment_id)
        .first()
    )
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    if comment.author_id != user.id:
        raise HTTPException(status_code=403, detail="Not allowed")

    db.delete(comment)
    db.commit()
    return {"ok": True}


@router.post("/files/{file_id}/handwriting", response_model=dict)
async def upload_handwriting_image(
    file_id: int,
    file: UploadFile = File(...),
    page_number: int | None = None,
    x_position: int | None = None,
    y_position: int | None = None,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """손글씨 이미지를 업로드합니다."""
    user = get_current_user(db, x_user_id)

    review = db.query(Review).filter(Review.file_asset_id == file_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    # 이미지 파일만 허용
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    original_name = file.filename or "handwriting.jpg"
    
    # 파일명 생성
    safe_name = f"review_{review.id}_{user.id}_{datetime.utcnow().timestamp()}.jpg"
    object_key = f"reviews/{review.id}/handwriting/{safe_name}"

    try:
        ensure_bucket(DEFAULT_BUCKET)
        up = upload_stream(
            project_id=review.file_asset.project_id,
            fileobj=file.file,
            original_filename=original_name,
            content_type=file.content_type,
            object_key=object_key,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await file.close()

    # URL 생성 (presigned URL - 7일)
    try:
        handwriting_url = presign_download_url(
            object_key=up.object_key,
            expires_minutes=60 * 24 * 7,
            download_filename=original_name,
            content_type=file.content_type,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "handwriting_image_url": handwriting_url,
        "page_number": page_number,
        "x_position": x_position,
        "y_position": y_position,
    }


@router.post("/files/{file_id}/stop", response_model=ReviewOut)
def stop_review(
    file_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """검토를 중지하고 대기중 상태로 되돌립니다."""
    user = get_current_user(db, x_user_id)

    review = db.query(Review).filter(Review.file_asset_id == file_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    if review.status != "in_progress":
        raise HTTPException(status_code=400, detail="Only in_progress reviews can be stopped")

    review.status = "pending"
    review.reviewer_id = None
    review.started_at = None
    review.completed_at = None
    review.updated_at = datetime.utcnow()

    db.add(review)
    db.commit()
    db.refresh(review)

    reviewer = db.query(User).filter(User.id == review.reviewer_id).first() if review.reviewer_id else None
    file_asset = review.file_asset
    project = file_asset.project if file_asset else None

    return ReviewOut(
        id=review.id,
        file_asset_id=review.file_asset_id,
        project_id=file_asset.project_id if file_asset else None,
        file_name=file_asset.original_name if file_asset else None,
        project_name=project.name if project else None,
        project_year=project.year if project else None,
        status=review.status,
        reviewer_id=review.reviewer_id,
        reviewer_name=reviewer.name if reviewer else None,
        started_at=review.started_at,
        completed_at=review.completed_at,
        created_at=review.created_at,
        updated_at=review.updated_at,
        comments=[],
    )


@router.get("/files/{file_id}/annotations", response_model=PDFAnnotationsData)
def get_pdf_annotations(
    file_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """PDF 주석 데이터를 MinIO에서 조회합니다."""
    user = get_current_user(db, x_user_id)

    file_asset = db.query(FileAsset).filter(FileAsset.id == file_id).first()
    if not file_asset:
        raise HTTPException(status_code=404, detail="File not found")

    project = file_asset.project
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ensure_can_manage_project(user, project)

    # MinIO에서 주석 데이터 로드 (원본 파일 옆 postfix JSON)
    object_key = derive_annotations_key(file_asset.file_key)
    try:
        data = get_json(object_key=object_key)
        # Backward-compat: older builds stored annotations under review namespace.
        if not data:
            review = db.query(Review).filter(Review.file_asset_id == file_id).first()
            if review:
                legacy_key = f"reviews/{review.id}/annotations.json"
                data = get_json(object_key=legacy_key)
        if not data:
            return PDFAnnotationsData(annotations=[])
        
        # 작성자 정보 추가
        annotations = []
        for ann_data in data.get("annotations", []):
            author_id = ann_data.get("author_id")
            author_name = None
            if author_id:
                author = db.query(User).filter(User.id == author_id).first()
                if author:
                    author_name = author.name
            
            annotations.append(
                PDFAnnotation(
                    id=ann_data.get("id", ""),
                    page=ann_data.get("page", 1),
                    x=ann_data.get("x", 0.0),
                    y=ann_data.get("y", 0.0),
                    text=ann_data.get("text", ""),
                    author_id=author_id,
                    author_name=author_name,
                    created_at=ann_data.get("created_at", ""),
                    updated_at=ann_data.get("updated_at", ""),
                )
            )
        
        return PDFAnnotationsData(annotations=annotations)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load annotations: {str(e)}")


@router.post("/files/{file_id}/annotations", response_model=dict)
def save_pdf_annotations(
    file_id: int,
    annotations_data: PDFAnnotationsData,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
    return_full: int | None = Query(default=None, description="Set to 1 to return full annotations payload"),
    perf: int | None = Query(default=None, description="Perf debug: set to 1 to include timing in response/logs"),
):
    """PDF 주석 데이터를 MinIO에 저장합니다."""
    user = get_current_user(db, x_user_id)

    file_asset = db.query(FileAsset).filter(FileAsset.id == file_id).first()
    if not file_asset:
        raise HTTPException(status_code=404, detail="File not found")

    project = file_asset.project
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ensure_can_manage_project(user, project)

    perf_enabled = perf == 1
    t0 = time.perf_counter() if perf_enabled else 0.0

    # Ensure review exists (workflow), but store JSON next to original key.
    review = db.query(Review).filter(Review.file_asset_id == file_id).first()
    if not review:
        review = Review(file_asset_id=file_id, status="pending")
        db.add(review)
        db.commit()
        db.refresh(review)

    # MinIO에 주석 데이터 저장 (원본 파일 옆 postfix JSON)
    object_key = derive_annotations_key(file_asset.file_key)
    try:
        # 현재 시간
        now = datetime.utcnow().isoformat()
        
        # 주석 데이터 준비 (작성자 정보는 ID만 저장)
        annotations_list = []
        for ann in annotations_data.annotations:
            ann_dict = {
                "id": ann.id,
                "page": ann.page,
                "x": ann.x,
                "y": ann.y,
                "text": ann.text,
                "author_id": user.id,
                "created_at": ann.created_at if ann.created_at else now,
                "updated_at": now,
            }
            annotations_list.append(ann_dict)
        
        data = {"annotations": annotations_list}
        upload_json(object_key=object_key, data=data)

        if return_full == 1:
            # Full payload (includes author_name enrichment).
            out = get_pdf_annotations(file_id, db, x_user_id)
            if perf_enabled:
                try:
                    t1 = time.perf_counter()
                    payload = None
                    try:
                        payload = out.model_dump()  # pydantic v2
                    except Exception:
                        payload = out.dict() if hasattr(out, "dict") else {"annotations": getattr(out, "annotations", [])}
                    return {
                        "ok": True,
                        "returned": "full",
                        "perf_ms": {"total": int(max(0.0, (t1 - t0) * 1000.0))},
                        **(payload or {}),
                    }
                except Exception:
                    pass
            return out

        # Minimal response for speed (caller typically doesn't need the full payload).
        t1 = time.perf_counter() if perf_enabled else 0.0
        out: dict = {"ok": True, "count": len(annotations_list)}
        if perf_enabled:
            out["perf_ms"] = {"total": int(max(0.0, (t1 - t0) * 1000.0))}
            try:
                print("[annotations-save-perf]", {"file_id": file_id, "count": len(annotations_list), **out["perf_ms"]})
            except Exception:
                pass
        return out
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save annotations: {str(e)}")


@router.post("/files/{file_id}/bake", response_model=dict)
def bake_review_pdf(
    file_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
    perf: int | None = Query(default=None, description="Perf debug: set to 1 to include timing in response/logs"),
):
    """
    Bake the current annotations JSON into a PDF and store it next to the original PDF.

    Storage (MinIO):
    - original: `file_asset.file_key` (unchanged)
    - baked:    `derive_baked_key(file_asset.file_key)` (overwrite; no history)
    - json:     `derive_annotations_key(file_asset.file_key)` (must already exist; overwrite via /annotations)
    """
    user = get_current_user(db, x_user_id)

    file_asset = db.query(FileAsset).filter(FileAsset.id == file_id).first()
    if not file_asset:
        raise HTTPException(status_code=404, detail="File not found")

    project = file_asset.project
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ensure_can_manage_project(user, project)

    perf_enabled = perf == 1
    t0 = time.perf_counter() if perf_enabled else 0.0

    # Load annotations JSON (sidecar next to original)
    ann_key = derive_annotations_key(file_asset.file_key)
    data = get_json(object_key=ann_key) or {}
    anns = data.get("annotations", [])
    if not isinstance(anns, list):
        anns = []
    t_ann = time.perf_counter() if perf_enabled else 0.0

    # Load original PDF bytes
    try:
        original_pdf_bytes = _read_object_bytes(file_asset.file_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load original PDF: {str(e)}")
    t_pdf = time.perf_counter() if perf_enabled else 0.0

    # Bake
    try:
        baked_bytes = _build_baked_pdf_bytes(original_pdf_bytes=original_pdf_bytes, annotations=anns)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to bake PDF: {str(e)}")
    t_bake = time.perf_counter() if perf_enabled else 0.0

    # Upload baked next to original (postfix)
    baked_key = derive_baked_key(file_asset.file_key)
    try:
        up = upload_stream(
            project_id=file_asset.project_id,
            fileobj=io.BytesIO(baked_bytes),
            original_filename=file_asset.original_name or f"baked-{file_id}.pdf",
            content_type="application/pdf",
            object_key=baked_key,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    t_up = time.perf_counter() if perf_enabled else 0.0

    # Cache the size to make subsequent Range proxy requests fast.
    _OBJECT_SIZE_CACHE[up.object_key] = (len(baked_bytes), time.time() + _OBJECT_SIZE_CACHE_TTL_SECONDS)

    out: dict = {"file_id": file_id, "object_key": up.object_key}
    if perf_enabled:
        try:
            out["perf_ms"] = {
                "ann_load": int(max(0.0, (t_ann - t0) * 1000.0)),
                "pdf_read": int(max(0.0, (t_pdf - t_ann) * 1000.0)),
                "bake": int(max(0.0, (t_bake - t_pdf) * 1000.0)),
                "upload": int(max(0.0, (t_up - t_bake) * 1000.0)),
                "total": int(max(0.0, (t_up - t0) * 1000.0)),
            }
        except Exception:
            pass
        try:
            print("[bake-perf]", {"file_id": file_id, "ann_count": len(anns), **(out.get("perf_ms") or {})})
        except Exception:
            pass
    return out

@router.post("/files/{file_id}/annotations/add", response_model=PDFAnnotation)
def add_pdf_annotation(
    file_id: int,
    annotation: PDFAnnotationCreate,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """PDF에 새 주석을 추가합니다."""
    user = get_current_user(db, x_user_id)

    file_asset = db.query(FileAsset).filter(FileAsset.id == file_id).first()
    if not file_asset:
        raise HTTPException(status_code=404, detail="File not found")

    project = file_asset.project
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ensure_can_manage_project(user, project)

    # Ensure review exists (workflow), but store JSON next to original key.
    review = db.query(Review).filter(Review.file_asset_id == file_id).first()
    if not review:
        review = Review(file_asset_id=file_id, status="pending")
        db.add(review)
        db.commit()
        db.refresh(review)

    # 기존 주석 로드
    object_key = derive_annotations_key(file_asset.file_key)
    data = get_json(object_key=object_key) or {}
    annotations_list = data.get("annotations", [])

    # 새 주석 추가
    now = datetime.utcnow().isoformat()
    new_annotation = {
        "id": str(uuid.uuid4()),
        "page": annotation.page,
        "x": annotation.x,
        "y": annotation.y,
        "text": annotation.text,
        "author_id": user.id,
        "created_at": now,
        "updated_at": now,
    }
    annotations_list.append(new_annotation)

    # 저장
    upload_json(object_key=object_key, data={"annotations": annotations_list})

    return PDFAnnotation(
        id=new_annotation["id"],
        page=new_annotation["page"],
        x=new_annotation["x"],
        y=new_annotation["y"],
        text=new_annotation["text"],
        author_id=user.id,
        author_name=user.name,
        created_at=new_annotation["created_at"],
        updated_at=new_annotation["updated_at"],
    )


@router.patch("/files/{file_id}/status", response_model=ReviewOut)
def update_review_status(
    file_id: int,
    payload: ReviewStatusUpdate,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
):
    """검토 상태를 업데이트합니다."""
    user = get_current_user(db, x_user_id)

    review = db.query(Review).filter(Review.file_asset_id == file_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    if payload.status not in ["in_progress", "request_revision", "approved"]:
        raise HTTPException(status_code=400, detail="Invalid status")

    review.status = payload.status
    review.updated_at = datetime.utcnow()

    if payload.status == "approved":
        review.completed_at = datetime.utcnow()
    elif payload.status == "request_revision":
        review.completed_at = None  # 수정 요청 시 완료 시각 초기화

    db.add(review)
    db.commit()
    db.refresh(review)

    reviewer = db.query(User).filter(User.id == review.reviewer_id).first() if review.reviewer_id else None
    file_asset = review.file_asset
    project = file_asset.project if file_asset else None

    return ReviewOut(
        id=review.id,
        file_asset_id=review.file_asset_id,
        project_id=file_asset.project_id if file_asset else None,
        file_name=file_asset.original_name if file_asset else None,
        project_name=project.name if project else None,
        project_year=project.year if project else None,
        status=review.status,
        reviewer_id=review.reviewer_id,
        reviewer_name=reviewer.name if reviewer else None,
        started_at=review.started_at,
        completed_at=review.completed_at,
        created_at=review.created_at,
        updated_at=review.updated_at,
        comments=[],
    )
