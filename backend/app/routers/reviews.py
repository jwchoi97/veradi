from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Header, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from urllib.parse import quote
import io

from ..mariadb.database import SessionLocal
from ..mariadb.models import FileAsset, Review, ReviewComment, User, Project
from ..schemas import ReviewOut, ReviewCommentOut, ReviewCommentCreate, ReviewCommentUpdate, ReviewStatusUpdate
from ..authz import ensure_can_manage_project
from .auth import get_current_user
from ..minio.service import upload_stream, presign_download_url, upload_json, get_json, DEFAULT_BUCKET
from ..minio.client import ensure_bucket, minio_client
from ..schemas import PDFAnnotation, PDFAnnotationsData, PDFAnnotationCreate
import json
import uuid

router = APIRouter(prefix="/reviews", tags=["reviews"])


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

    # 백엔드 프록시 URL 반환 (CORS 문제 해결)
    # 프론트엔드의 baseURL이 /api이므로 /reviews만 반환
    return {"url": f"/reviews/files/{file_id}/proxy", "expires_minutes": 60}


@router.get("/files/{file_id}/proxy")
def proxy_file_for_viewer(
    file_id: int,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
    range_header: str | None = Header(default=None, alias="Range"),
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
        ensure_bucket(DEFAULT_BUCKET)
        stat = minio_client.stat_object(bucket_name=DEFAULT_BUCKET, object_name=file_asset.file_key)
        total_size = int(getattr(stat, "size", 0) or 0)

        # Range 요청 지원 (pdf.js가 부분 다운로드를 사용함)
        start = 0
        end = total_size - 1 if total_size > 0 else 0
        is_partial = False

        if range_header:
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

        length = (end - start) + 1 if total_size > 0 else -1
        response = minio_client.get_object(
            bucket_name=DEFAULT_BUCKET,
            object_name=file_asset.file_key,
            offset=start if is_partial else 0,
            length=length if is_partial else None,
        )
        
        # 파일 스트림을 반환
        def generate():
            try:
                while True:
                    chunk = response.read(8192)  # 8KB chunks
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
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",  # CORS 헤더 추가
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }

        if is_partial and total_size > 0:
            headers["Content-Range"] = f"bytes {start}-{end}/{total_size}"
            headers["Content-Length"] = str(length)

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
    """검토 가능한 콘텐츠 파일 목록을 조회합니다."""
    user = get_current_user(db, x_user_id)

    # 콘텐츠 파일만 조회 (문제지, 해설지, 정오표)
    query = (
        db.query(FileAsset)
        .filter(FileAsset.file_type.in_(["문제지", "해설지", "정오표"]))
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

    review = db.query(Review).filter(Review.file_asset_id == file_id).first()
    if not review:
        return PDFAnnotationsData(annotations=[])

    # MinIO에서 주석 데이터 로드
    object_key = f"reviews/{review.id}/annotations.json"
    try:
        data = get_json(object_key=object_key)
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


@router.post("/files/{file_id}/annotations", response_model=PDFAnnotationsData)
def save_pdf_annotations(
    file_id: int,
    annotations_data: PDFAnnotationsData,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None),
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

    # MinIO에 주석 데이터 저장
    object_key = f"reviews/{review.id}/annotations.json"
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
        
        # 저장된 데이터 다시 로드하여 반환 (작성자 이름 포함)
        return get_pdf_annotations(file_id, db, x_user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save annotations: {str(e)}")


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

    # 기존 주석 로드
    object_key = f"reviews/{review.id}/annotations.json"
    data = get_json(object_key=object_key)
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
