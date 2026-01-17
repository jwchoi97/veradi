from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Header, UploadFile, File
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from ..mariadb.database import SessionLocal
from ..mariadb.models import FileAsset, Review, ReviewComment, User, Project
from ..schemas import ReviewOut, ReviewCommentOut, ReviewCommentCreate, ReviewStatusUpdate
from ..authz import ensure_can_manage_project
from .auth import get_current_user
from ..minio.service import upload_stream, presign_download_url, DEFAULT_BUCKET
from ..minio.client import ensure_bucket
from ..authz import ensure_can_manage_project

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
    """파일 뷰어용 URL을 조회합니다 (inline disposition)."""
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
        url = presign_download_url(
            object_key=file_asset.file_key,
            expires_minutes=60,  # 뷰어용이므로 더 긴 시간
            download_filename=file_asset.original_name,
            content_type=file_asset.mime_type,
            inline=True,  # inline disposition 사용
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"url": url, "expires_minutes": 60}


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
